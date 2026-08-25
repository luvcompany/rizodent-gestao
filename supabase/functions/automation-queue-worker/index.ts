// Dedicated worker that drains crm_automation_queue.
// Runs every minute via cron. Processes pending items (send_template / send_bot / etc.)
// in parallel chunks while respecting WhatsApp gateway rate limits.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { authorizeInternal, unauthorizedResponse } from "../_shared/internalAuth.ts";
import { mesmoMundo, mundoDaEtapa, type MundoDaEtapa } from "../_shared/mundoNumero.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_LIMIT = 60;
const PARALLEL = 3;
const CHUNK_GAP_MS = 800;
const MAX_RATE_LIMIT_RETRIES = 5;

// Ações que ENVIAM mensagem ao paciente — só podem sair no horário comercial.
// move_stage / add_tag / notify_* são internas e podem rodar a qualquer hora.
const MESSAGE_ACTIONS = new Set(["send_template", "send_bot", "send_audio", "send_file"]);

// Ações de mensagem LIVRE (não-template): o WhatsApp/Instagram só permite enviar
// dentro da janela de 24h desde a última resposta do lead. Fora da janela, o envio
// falha (erro 131047). O TEMPLATE é o único que passa fora da janela — por isso não
// entra aqui. send_bot também NÃO entra: o bot pode começar com um template e tem
// seu próprio guard por-mensagem (no bot-engine). Guard: não tentamos estas ações
// se a janela estiver fechada.
const FREEFORM_ACTIONS = new Set(["send_audio", "send_file"]);
const WINDOW_MS = 24 * 60 * 60 * 1000;

// Descobre o tipo de mídia (mime salvo no upload; se faltar, pela extensão da URL),
// para o WhatsApp receber vídeo como VÍDEO (toca no chat) em vez de documento.
function detectMediaType(url: string, mime?: string): "video" | "image" | "audio" | "document" {
  const m = String(mime || "").toLowerCase();
  const ext = String(url || "").split("?")[0].split(".").pop()?.toLowerCase() || "";
  if (m.startsWith("video/") || ["mp4", "mov", "3gp"].includes(ext)) return "video";
  if (m.startsWith("image/") || ["jpg", "jpeg", "png", "webp"].includes(ext)) return "image";
  if (m.startsWith("audio/") || ["ogg", "opus", "mp3", "m4a", "aac", "wav"].includes(ext)) return "audio";
  return "document";
}

// Janela comercial (BR = UTC-3): seg–sáb 08:00–20:00 local.
// Retorna ISO do próximo horário permitido, ou null se JÁ estamos na janela.
function nextCommercialFireAt(now: Date = new Date()): string | null {
  const BR_OFFSET_MS = -3 * 60 * 60 * 1000; // UTC-3
  const brNow = new Date(now.getTime() + BR_OFFSET_MS);
  const dow = brNow.getUTCDay(); // 0=Dom..6=Sáb
  const hour = brNow.getUTCHours();
  const inWindow = dow >= 1 && dow <= 6 && hour >= 8 && hour < 20;
  if (inWindow) return null;
  const next = new Date(brNow);
  if (dow >= 1 && dow <= 6 && hour < 8) {
    // Hoje mais tarde — cai para as 08:00 de hoje
  } else {
    // Depois das 20:00, ou domingo: avança até o próximo seg–sáb
    next.setUTCDate(next.getUTCDate() + 1);
    while (next.getUTCDay() === 0) next.setUTCDate(next.getUTCDate() + 1);
  }
  next.setUTCHours(8, 0, 0, 0);
  return new Date(next.getTime() - BR_OFFSET_MS).toISOString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  // Restrict to cron / service-role callers only
  const auth = await authorizeInternal(req, supabase, { cronSecretName: "automation_cron_token" });
  if (!auth.ok) {
    console.warn("[queue-worker] Unauthorized");
    return unauthorizedResponse(corsHeaders);
  }


  // Mundo (número de WhatsApp) de cada etapa, resolvido uma vez por execução.
  const mundoCache = new Map<string, MundoDaEtapa>();

  const stats = { processed: 0, sent: 0, failed: 0, skipped: 0, deferred: 0, window_closed: 0, cancelled: 0, retried: 0 };

  try {
    // 1. Recover items stuck in "processing" for > 10 min back to pending
    await supabase
      .from("crm_automation_queue")
      .update({ status: "pending", updated_at: new Date().toISOString() })
      .eq("status", "processing")
      .lt("updated_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());

    // 2. Fetch a batch of pending items ready to send
    const nowIso = new Date().toISOString();
    const { data: items, error: fetchErr } = await supabase
      .from("crm_automation_queue")
      .select("id, lead_id, action_type, action_config, automation_id, scheduled_at, error_message")
      .eq("status", "pending")
      .lte("scheduled_at", nowIso)
      .order("scheduled_at", { ascending: true })
      .limit(BATCH_LIMIT);

    if (fetchErr) throw fetchErr;

    const queue = items || [];
    console.log(`[queue-worker] fetched=${queue.length}`);

    const processOne = async (item: any) => {
      stats.processed++;

      // GUARD DE HORÁRIO COMERCIAL: envios de mensagem fora da janela (seg–sáb
      // 08–20 BR) são REAGENDADOS para o próximo dia útil às 08:00, em vez de
      // sair na madrugada. Cobre o re-enqueue do watchdog (que roda 00:00 BR) e
      // qualquer outra fonte. Ações internas (move_stage etc.) não são afetadas.
      if (MESSAGE_ACTIONS.has(item.action_type)) {
        const nextWindow = nextCommercialFireAt();
        if (nextWindow) {
          await supabase
            .from("crm_automation_queue")
            .update({ scheduled_at: nextWindow, updated_at: new Date().toISOString() })
            .eq("id", item.id)
            .eq("status", "pending");
          console.log(`[queue-worker] item ${item.id} (${item.action_type}) fora do horário — reagendado para ${nextWindow}`);
          stats.deferred++;
          return;
        }
      }

      // Reserve atomically: only proceed if we can flip pending -> processing
      const { data: reserved, error: reserveErr } = await supabase
        .from("crm_automation_queue")
        .update({ status: "processing", updated_at: new Date().toISOString() })
        .eq("id", item.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();

      if (reserveErr || !reserved) {
        stats.skipped++;
        return;
      }

      try {
        const { data: lead } = await supabase
          .from("crm_leads")
          .select("phone, is_blocked, last_inbound_at, automation_paused, whatsapp_number_id, tenant_id")
          .eq("id", item.lead_id)
          .maybeSingle();

        if (!lead) throw new Error("lead not found");
        if (lead.is_blocked) {
          await supabase
            .from("crm_automation_queue")
            .update({
              status: "cancelled",
              error_message: "lead bloqueado — automação ignorada",
              updated_at: new Date().toISOString(),
            })
            .eq("id", item.id);
          stats.cancelled++;
          console.log(`[queue-worker] item ${item.id} cancelado — lead ${item.lead_id} bloqueado`);
          return;
        }

        // RE-VALIDAÇÃO EM RUNTIME: entre o enfileiramento e a execução o mundo pode
        // ter mudado — automação desativada, lead pausado, ou lead que passou a
        // pertencer a outro número (outro funil/closer). Executar nesse caso mandaria
        // mensagem pelo número errado.
        if (lead.automation_paused === true) {
          await supabase
            .from("crm_automation_queue")
            .update({
              status: "cancelled",
              error_message: "automações pausadas para este lead",
              updated_at: new Date().toISOString(),
            })
            .eq("id", item.id);
          stats.cancelled++;
          console.log(`[queue-worker] item ${item.id} cancelado — lead ${item.lead_id} com automações pausadas`);
          return;
        }

        if (item.automation_id) {
          const { data: auto } = await supabase
            .from("crm_automations")
            .select("id, is_active, stage_id, tenant_id")
            .eq("id", item.automation_id)
            .maybeSingle();

          const cancelar = async (motivo: string) => {
            await supabase
              .from("crm_automation_queue")
              .update({ status: "cancelled", error_message: motivo, updated_at: new Date().toISOString() })
              .eq("id", item.id);
            stats.cancelled++;
            console.log(`[queue-worker] item ${item.id} cancelado — ${motivo}`);
          };

          if (!auto || (auto as any).is_active === false) {
            await cancelar("automação desativada ou removida");
            return;
          }
          if ((auto as any).tenant_id && lead.tenant_id && (auto as any).tenant_id !== lead.tenant_id) {
            await cancelar("automação e lead de clientes diferentes");
            return;
          }

          const mundo = await mundoDaEtapa(supabase, (auto as any).stage_id ?? null, mundoCache);
          if ((auto as any).stage_id && !mesmoMundo(lead.whatsapp_number_id, mundo.numberId)) {
            await cancelar("lead pertence a outro número de WhatsApp");
            return;
          }
        }

        await sendAction(
          supabase,
          supabaseUrl,
          serviceKey,
          item.action_type,
          (item.action_config || {}) as Record<string, any>,
          item.lead_id,
          lead.phone,
          item.automation_id ?? null,
        );


        await supabase
          .from("crm_automation_queue")
          .update({
            status: "sent",
            error_message: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", item.id);
        stats.sent++;
      } catch (e: any) {
        const msg = (e?.message || String(e)).substring(0, 1000);
        console.error(`[queue-worker] item ${item.id} failed:`, msg);

        // 429 rate-limit do Edge Runtime / gateway — reagenda em vez de descartar
        const rateMatch = msg.match(/Rate limit exceeded[^]*?Retry after (\d+)\s*ms/i);
        if (rateMatch) {
          const retryMs = Math.min(parseInt(rateMatch[1], 10) || 30000, 5 * 60 * 1000);
          const prevMsg = (item.error_message as string) || "";
          const prevAttempt = parseInt((prevMsg.match(/retry #(\d+)\/\d+/) || [])[1] || "0", 10);
          const nextAttempt = prevAttempt + 1;

          if (nextAttempt <= MAX_RATE_LIMIT_RETRIES) {
            const jitter = 500 + Math.floor(Math.random() * 1000);
            const nextAt = new Date(Date.now() + retryMs + jitter).toISOString();
            await supabase
              .from("crm_automation_queue")
              .update({
                status: "pending",
                scheduled_at: nextAt,
                error_message: `retry #${nextAttempt}/${MAX_RATE_LIMIT_RETRIES} — rate limit; próximo envio em ${nextAt}`,
                updated_at: new Date().toISOString(),
              })
              .eq("id", item.id);
            stats.retried++;
            console.log(`[queue-worker] item ${item.id} 429 — retry #${nextAttempt} em ${retryMs + jitter}ms`);
            return;
          }
        }

        await supabase
          .from("crm_automation_queue")
          .update({
            status: "failed",
            error_message: msg,
            updated_at: new Date().toISOString(),
          })
          .eq("id", item.id);
        stats.failed++;
      }
    };

    // Process in parallel chunks with a small gap between chunks
    for (let i = 0; i < queue.length; i += PARALLEL) {
      const slice = queue.slice(i, i + PARALLEL);
      await Promise.allSettled(slice.map(processOne));
      if (i + PARALLEL < queue.length) {
        await new Promise((r) => setTimeout(r, CHUNK_GAP_MS));
      }
    }

    console.log(`[queue-worker] done`, stats);
    return new Response(JSON.stringify({ success: true, ...stats }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[queue-worker] fatal:", error);
    return new Response(JSON.stringify({ error: error.message, ...stats }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Tenant do LEAD + validação fail-closed dos ids vindos de action_config.
// O worker executa o caminho DIFERIDO (crm_automation_queue), então precisa da
// mesma trava de tenant do automation-engine: um action_config com id de outra
// clínica não pode mover etapa, disparar bot nem enviar template.
async function tenantDoLead(supabase: any, leadId: string): Promise<string | null> {
  const { data } = await supabase.from("crm_leads").select("tenant_id").eq("id", leadId).maybeSingle();
  return (data as any)?.tenant_id ?? null;
}

async function assertIdNoTenant(
  supabase: any,
  table: string,
  id: string,
  leadId: string,
): Promise<void> {
  const tenantId = await tenantDoLead(supabase, leadId);
  if (!tenantId) throw new Error(`lead ${leadId} sem tenant — ação com ${table} ${id} bloqueada`);
  const { data } = await supabase.from(table).select("id").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!data) throw new Error(`${table} ${id} não pertence ao tenant do lead ${leadId} — ação bloqueada`);
}

async function sendAction(
  supabase: any,
  supabaseUrl: string,
  serviceKey: string,
  actionType: string,
  config: Record<string, any>,
  leadId: string,
  phone: string | null,
) {
  switch (actionType) {
    case "send_template": {
      if (!config.template_id) throw new Error("missing template_id");
      if (!phone) throw new Error("lead has no phone");
      await assertIdNoTenant(supabase, "crm_whatsapp_templates", config.template_id, leadId);
      const { data: tpl } = await supabase
        .from("crm_whatsapp_templates")
        .select("name, language")
        .eq("id", config.template_id)
        .maybeSingle();
      if (!tpl) throw new Error(`template ${config.template_id} not found`);

      const resp = await fetch(`${supabaseUrl}/functions/v1/send-whatsapp-message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
        },
        body: JSON.stringify({
          lead_id: leadId,
          to: phone,
          type: "template",
          template_name: tpl.name,
          template_language: tpl.language,
        }),
      });
      const txt = await resp.text();
      if (!resp.ok) throw new Error(`send-whatsapp-message ${resp.status}: ${txt.substring(0, 400)}`);
      return;
    }
    case "send_bot": {
      if (!config.bot_id) throw new Error("missing bot_id");
      await assertIdNoTenant(supabase, "bots", config.bot_id, leadId);

      const resp = await fetch(`${supabaseUrl}/functions/v1/bot-engine`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
        },
        body: JSON.stringify({ leadId, botId: config.bot_id, trigger: "automation" }),
      });
      const txt = await resp.text();
      if (!resp.ok) throw new Error(`bot-engine ${resp.status}: ${txt.substring(0, 400)}`);
      return;
    }
    case "send_audio": {
      if (!config.audio_url || !phone) throw new Error("missing audio_url or phone");
      const resp = await fetch(`${supabaseUrl}/functions/v1/send-whatsapp-message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
        },
        body: JSON.stringify({ lead_id: leadId, to: phone, type: "audio", media_url: config.audio_url }),
      });
      const txt = await resp.text();
      if (!resp.ok) throw new Error(`send_audio ${resp.status}: ${txt.substring(0, 400)}`);
      return;
    }
    case "send_file": {
      if (!config.file_url || !phone) throw new Error("missing file_url or phone");
      // Envia pelo TIPO real da mídia: vídeo toca no chat, imagem aparece, áudio
      // vira mensagem de voz. Só cai em "document" quando não é mídia reconhecida.
      const mediaType = detectMediaType(config.file_url as string, config.file_mime as string);
      const resp = await fetch(`${supabaseUrl}/functions/v1/send-whatsapp-message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
        },
        body: JSON.stringify({
          lead_id: leadId,
          to: phone,
          type: mediaType,
          media_url: config.file_url,
          ...(mediaType === "document"
            ? { filename: config.filename || config.file_name || "arquivo" }
            : {}),
        }),
      });
      const txt = await resp.text();
      if (!resp.ok) throw new Error(`send_file ${resp.status}: ${txt.substring(0, 400)}`);
      return;
    }
    case "add_tag": {
      // A UI salva em `tag_name`; aceitamos ambos (o engine já fazia isso).
      const tag = (config.tag ?? config.tag_name) as string;
      if (!tag) return;
      const { data: lead } = await supabase.from("crm_leads").select("tags").eq("id", leadId).maybeSingle();
      const existing = (lead?.tags || []) as string[];
      if (!existing.includes(tag)) {
        await supabase.from("crm_leads").update({ tags: [...existing, tag] }).eq("id", leadId);
      }
      return;
    }
    case "notify_owner": {
      const { data: lead } = await supabase
        .from("crm_leads")
        .select("assigned_to, name")
        .eq("id", leadId)
        .maybeSingle();
      if (lead?.assigned_to) {
        await supabase.from("crm_notifications").insert({
          user_id: lead.assigned_to,
          lead_id: leadId,
          title: config.notification_title || "Automação disparada",
          body: config.notification_body || `Automação acionada para o lead ${lead.name}`,
          type: "automation",
        });
      }
      return;
    }
    case "move_stage": {
      if (!config.target_stage_id) return;
      await assertIdNoTenant(supabase, "crm_stages", config.target_stage_id, leadId);

      await supabase
        .from("crm_leads")
        .update({ stage_id: config.target_stage_id, updated_at: new Date().toISOString() })
        .eq("id", leadId);
      return;
    }
    default:
      // Unknown action types: do not error so the queue isn't blocked
      console.warn(`[queue-worker] unknown action_type=${actionType}`);
      return;
  }
}
