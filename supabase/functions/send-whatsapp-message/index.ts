import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveCaller, assertLeadInTenant, assertNumberAccess, assertMessageInTenant } from "../_shared/authz.ts";
import { assertAllowedMediaUrl } from "../_shared/mediaUrl.ts";

// Teto de mídia aceito pela Meta (16 MB no maior tipo).
const MAX_MEDIA_BYTES = 16 * 1024 * 1024;
import { motivoMidiaIncompleta } from "../_shared/mediaIntegrity.ts";
import { escopoDoLead } from "../_shared/wabaEscopo.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Usamos o bucket privado chat-media (o "avatars" restringe a apenas imagens,
// então uploads de vídeo/PDF de header de template falhavam silenciosamente).
// Geramos uma signed URL de longa duração para o Meta baixar a mídia no envio.
const PUBLIC_TEMPLATE_MEDIA_BUCKET = "chat-media";
const PUBLIC_TEMPLATE_MEDIA_PREFIX = "whatsapp-template-media";
const TEMPLATE_MEDIA_SIGNED_TTL = 60 * 60 * 24 * 30; // 30 dias (o envio reassina)

const isHttpUrl = (value: string | null | undefined) => Boolean(value && /^https?:\/\//i.test(value));

const sanitizePathSegment = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "template";

const extensionFromMime = (mimeType: string) => {
  const mimeMap: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  };

  return mimeMap[mimeType.toLowerCase()] || "bin";
};

const TEMPLATE_SELECT = "id, name, body_text, header_type, header_content, status, updated_at, created_at";

const cleanTemplateName = (name: string) => name.replace(/_[a-z0-9]{4,10}$/i, "");

const getTemplatePlaceholderIndexes = (content: string | null | undefined): number[] => {
  if (!content) return [];

  const indexes = new Set<number>();

  // Only detect {{N}} style placeholders (Meta's official format)
  for (const match of content.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0) indexes.add(value);
  }

  return [...indexes].sort((a, b) => a - b);
};

const hasOfficialTemplatePlaceholders = (content: string | null | undefined) =>
  getTemplatePlaceholderIndexes(content).length > 0;

// Sempre escopado ao tenant do lead: nomes de template não são globais, então
// buscar só por `name` podia devolver (e enviar) o template de outro tenant.
async function resolveTemplateForSend(
  supabase: any,
  templateName: string,
  tenantId: string | null,
  wabaId: string | null,
) {
  // Escopo de WABA: o template TEM de existir na WABA do número por onde a
  // mensagem vai sair. Template de outra WABA com o mesmo nome é outro template.
  const withTenant = (q: any) => {
    let out = tenantId ? q.eq("tenant_id", tenantId) : q;
    if (wabaId) out = out.eq("waba_id", wabaId);
    return out;
  };

  // limit(1) determinístico: com duas WABAs o maybeSingle() estourava
  // ("multiple rows") e o envio de template morria sem explicação.
  const { data: exactRows } = await withTenant(
    supabase
      .from("crm_whatsapp_templates")
      .select(TEMPLATE_SELECT)
      .eq("name", templateName),
  )
    .order("updated_at", { ascending: false })
    .limit(1);
  const exactTemplate = (exactRows || [])[0] || null;

  if (exactTemplate?.body_text && hasOfficialTemplatePlaceholders(exactTemplate.body_text)) {
    return exactTemplate;
  }

  const baseName = cleanTemplateName(templateName);
  const { data: relatedTemplates } = await withTenant(
    supabase
      .from("crm_whatsapp_templates")
      .select(TEMPLATE_SELECT)
      .eq("status", "APPROVED")
      .like("name", `${baseName}_%`),
  )
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false });

  const preferredTemplate = (relatedTemplates || []).find((candidate: any) =>
    cleanTemplateName(candidate.name) === baseName && hasOfficialTemplatePlaceholders(candidate.body_text)
  );

  if (preferredTemplate && preferredTemplate.name !== exactTemplate?.name) {
    console.log(
      `[send-whatsapp] Switching template ${templateName} -> ${preferredTemplate.name} to use the official body placeholders.`,
    );
    return preferredTemplate;
  }

  return exactTemplate || null;
}

const buildTemplateFallbacks = (
  lead: { name?: string | null; phone?: string | null; source?: string | null; servico_interesse?: string | null } | null,
  appointmentDate?: string | null,
) => {
  const safeLeadName = lead?.name?.trim() || "cliente";
  const safeDate = appointmentDate || "data a confirmar";
  const safeService = lead?.servico_interesse?.trim() || "consulta";
  return [safeLeadName, safeDate, safeService, lead?.phone?.trim() || safeLeadName, lead?.source?.trim() || safeLeadName];
};

const buildMediaHeaderComponent = (headerType: string, link: string) => {
  if (headerType === "IMAGE") {
    return { type: "header", parameters: [{ type: "image", image: { link } }] };
  }

  if (headerType === "VIDEO") {
    return { type: "header", parameters: [{ type: "video", video: { link } }] };
  }

  if (headerType === "DOCUMENT") {
    return { type: "header", parameters: [{ type: "document", document: { link } }] };
  }

  return null;
};

async function ensurePublicTemplateMediaLink(
  supabase: any,
  templateName: string,
  headerType: string,
  originalValue: string,
) {
  if (!originalValue) return null;
  if (!isHttpUrl(originalValue)) return originalValue;
  // Já é uma URL do nosso Storage (público ou assinado) — Meta consegue baixar.
  if (originalValue.includes("/storage/v1/object/public/")) {
    return originalValue; // pública não expira
  }
  if (originalValue.includes("/storage/v1/object/sign/")) {
    // Não confiar na assinatura guardada: ela expira e derruba todos os
    // templates de uma vez. Assina de novo, curto, a cada envio.
    const depois = originalValue.split("/storage/v1/object/sign/")[1] || "";
    const semQuery = depois.split("?")[0];
    const partes = semQuery.split("/");
    const bucket = partes.shift()!;
    const caminho = decodeURIComponent(partes.join("/"));
    const { data, error } = await supabase.storage.from(bucket)
      .createSignedUrl(caminho, 60 * 60 * 24); // 24h basta: a Meta baixa na hora
    if (error || !data?.signedUrl) {
      throw new Error(`Não consegui assinar a mídia do template (${caminho}): ${error?.message ?? "sem URL"}`);
    }
    return data.signedUrl;
  }


  // (SSRF) `header_content` vem do banco e é editável por quem gerencia
  // templates: valida contra a allowlist antes de qualquer fetch.
  const guardHeader = assertAllowedMediaUrl(originalValue);
  if (!guardHeader.ok) {
    throw new Error(`Mídia do template não permitida: ${guardHeader.error}`);
  }
  const response = await fetch(guardHeader.url, { redirect: "error", signal: AbortSignal.timeout(30000) });
  if (!response.ok) {
    throw new Error(`Failed to download template media (${response.status})`);
  }
  const declaredHeaderLen = Number(response.headers.get("content-length") || 0);
  if (declaredHeaderLen && declaredHeaderLen > MAX_MEDIA_BYTES) {
    throw new Error("Mídia do template maior que o limite de 16 MB.");
  }

  const mediaBlob = await response.blob();
  if (mediaBlob.size > MAX_MEDIA_BYTES) {
    throw new Error("Mídia do template maior que o limite de 16 MB.");
  }

  // NUNCA cachear download parcial: arquivo truncado fica no bucket, o envio
  // falha sempre (Meta 131053) e a auto-cura não conserta (URL já é do Storage).
  const esperado = Number(response.headers.get("content-length") || 0);
  const recebido = mediaBlob.size;
  if (esperado > 0 && recebido !== esperado) {
    throw new Error(
      `Download incompleto da mídia do template: recebido ${recebido} de ${esperado} bytes. ` +
      `Nada foi cacheado — envie o arquivo original por /templates/upload-media com file_b64.`
    );
  }
  if (recebido < 1024) {
    throw new Error(`Mídia do template veio vazia ou inválida (${recebido} bytes).`);
  }
  const contentType = mediaBlob.type || (headerType === "VIDEO" ? "video/mp4" : headerType === "DOCUMENT" ? "application/pdf" : "image/jpeg");
  // 2ª camada: validação ESTRUTURAL (fonte pode declarar e entregar o mesmo
  // valor truncado, passando pela checagem de Content-Length).
  const motivo = motivoMidiaIncompleta(new Uint8Array(await mediaBlob.arrayBuffer()), contentType);
  if (motivo) {
    throw new Error(`${motivo}. Nada foi cacheado — reenvie o arquivo original por /templates/upload-media com file_b64.`);
  }
  const extension = extensionFromMime(contentType);
  const filePath = `${PUBLIC_TEMPLATE_MEDIA_PREFIX}/${sanitizePathSegment(templateName)}-${Date.now()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(PUBLIC_TEMPLATE_MEDIA_BUCKET)
    .upload(filePath, mediaBlob, {
      contentType,
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`Failed to cache template media: ${uploadError.message}`);
  }

  // Bucket privado: Meta baixa via signed URL de longa duração.
  const { data: signed, error: signErr } = await supabase.storage
    .from(PUBLIC_TEMPLATE_MEDIA_BUCKET)
    .createSignedUrl(filePath, TEMPLATE_MEDIA_SIGNED_TTL);

  if (signErr || !signed?.signedUrl) {
    throw new Error(`Failed to sign template media URL: ${signErr?.message || "unknown"}`);
  }
  return signed.signedUrl;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const apiKeyHeader = req.headers.get("apikey") || "";
    const token = authHeader.replace("Bearer ", "");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceRoleKey,
    );

    const caller = await resolveCaller(req, supabase);
    if (!caller.ok) {
      console.warn(`[send-whatsapp-message] auth failed: ${caller.error}`);
      return new Response(JSON.stringify({ error: caller.error }), {
        status: caller.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }



    const {
      lead_id,
      to,
      message,
      type = "text",
      media_url,
      template_name,
      template_language,
      template_components,
      reply_to_wamid,
      reply_to_message_id,
      reaction_emoji,
      reaction_to_message_id,
      audio_voice = false,
      interactive_type,
      body,
      buttons,
      button_text,
      sections,
      header,
      footer,
      skip_mark_as_read = false,
      // Texto real gravado no chat no lugar de "📋 Template: x" (a recepção
      // precisa ler o lembrete enviado, não o nome do template). Aceito SÓ de
      // chamador service_role: vindo do app, permitiria gravar no histórico um
      // texto diferente do que a Meta entregou.
      log_content,
    } = await req.json();

    if (!lead_id || !to) {
      return new Response(JSON.stringify({ error: "Missing lead_id or to" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Tenant ownership check (IDOR guard) — service-role and superadmin bypass.
    const tenantCheck = await assertLeadInTenant(supabase, lead_id, caller);
    if (!tenantCheck.ok) {
      console.warn(`[send-whatsapp-message] tenant guard: ${tenantCheck.error} lead=${lead_id} user=${caller.userId ?? "service"}`);
      return new Response(JSON.stringify({ error: tenantCheck.error }), {
        status: tenantCheck.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    // Credencial NUNCA vem de env: token e phone_number_id só valem quando saem
    // JUNTOS da mesma config de integração (senão sai pelo número errado).
    let whatsappToken = "";
    let phoneNumberId = "";

    const { data: leadData } = await supabase
      .from("crm_leads")
      .select("pipeline_id, tenant_id, whatsapp_number_id")
      .eq("id", lead_id)
      .maybeSingle();
    const leadTenantId: string | null = (leadData as any)?.tenant_id ?? null;

    // Visibilidade por número (papel recepcao): quem não tem acesso ao número do
    // lead não envia por ele. Lead sem carimbo (NULL) libera — caso Rizodent hoje.
    const numCheck = await assertNumberAccess(req, (leadData as any)?.whatsapp_number_id ?? null, caller);
    if (!numCheck.ok) {
      console.warn(`[send-whatsapp-message] number guard: ${numCheck.error} lead=${lead_id} user=${caller.userId ?? "service"}`);
      return new Response(JSON.stringify({ error: numCheck.error }), {
        status: numCheck.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ISOLAMENTO POR CLIENTE: as credenciais WhatsApp DEVEM pertencer
    // ao mesmo tenant do lead. Sem fallback "qualquer canal ativo".
    if (!leadTenantId) {
      return new Response(JSON.stringify({ error: "Lead sem tenant_id; envio bloqueado" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ===== REGRA ESTRUTURAL: o número de saída vem do CARIMBO DO LEAD =====
    // "Cada número é um mundo": o lead carimbado pertence àquele número e a
    // resposta TEM de sair por ele. Sem fallback para "qualquer integração do
    // tenant" — era isso que fazia mover o lead de funil trocar o número de
    // saída e a resposta de bot sair pelo número errado.
    let resolvedCredentials = false;
    const leadWaNumberId: string | null = (leadData as any)?.whatsapp_number_id ?? null;

    if (leadWaNumberId) {
      // (a) Lead carimbado: whatsapp_numbers -> integração whatsapp_<phone_number_id>.
      const { data: waNum } = await supabase
        .from("whatsapp_numbers")
        .select("phone_number_id, token")
        .eq("id", leadWaNumberId)
        .eq("tenant_id", leadTenantId)
        .eq("is_active", true)   // is_active existe para desligar um número: respeitar
        .maybeSingle();

      if (!waNum?.phone_number_id) {
        console.warn(`[send-whatsapp-message] lead ${lead_id} carimbado com número ${leadWaNumberId} sem cadastro ativo`);
        return new Response(JSON.stringify({ error: "Número do lead sem credenciais" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: intgNumero } = await supabase
        .from("integrations")
        .select("config, status")
        .eq("tenant_id", leadTenantId)
        .eq("key", `whatsapp_${waNum.phone_number_id}`)
        .maybeSingle();

      if ((intgNumero as any)?.status === "disabled") {
        console.warn(`[send-whatsapp-message] integração whatsapp_${waNum.phone_number_id} desativada (lead ${lead_id})`);
        return new Response(JSON.stringify({ error: "Integração desativada" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const cfgNumero = ((intgNumero as any)?.config ?? {}) as any;
      const tokenNumero = cfgNumero.access_token || cfgNumero.token || waNum.token;
      if (!tokenNumero) {
        console.warn(`[send-whatsapp-message] número ${leadWaNumberId} sem token (lead ${lead_id})`);
        return new Response(JSON.stringify({ error: "Número do lead sem credenciais" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      phoneNumberId = cfgNumero.phone_number_id || waNum.phone_number_id;
      whatsappToken = tokenNumero;
      resolvedCredentials = true;
      console.log(`[send-whatsapp-message] credenciais do número carimbado no lead (${phoneNumberId})`);
    } else {
      // (b) Lead do mundo legado: canal do funil e, na falta dele, whatsapp_config.
      if (leadData?.pipeline_id) {
        const { data: funnelChannel } = await supabase
          .from("funnel_channels")
          .select("channel_config")
          .eq("channel_type", "whatsapp")
          .eq("pipeline_id", leadData.pipeline_id)
          .eq("tenant_id", leadTenantId)
          .maybeSingle();

        const integrationKey = (funnelChannel?.channel_config as any)?.integration_key;
        if (integrationKey) {
          const { data: integration } = await supabase
            .from("integrations")
            .select("config, status, tenant_id")
            .eq("key", integrationKey)
            .eq("tenant_id", leadTenantId)
            .maybeSingle();

          if (integration?.status === "disabled") {
            return new Response(JSON.stringify({ error: "Integração desativada" }), {
              status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          if (integration?.config) {
            const cfg = integration.config as any;
            const resolvedToken = cfg.access_token || cfg.token;
            if (resolvedToken && cfg.phone_number_id) {
              whatsappToken = resolvedToken;
              phoneNumberId = cfg.phone_number_id;
              resolvedCredentials = true;
            }
          }
        }
      }

      if (!resolvedCredentials) {
        const { data: legacy } = await supabase
          .from("integrations")
          .select("config, status")
          .eq("tenant_id", leadTenantId)
          .eq("key", "whatsapp_config")
          .maybeSingle();

        if ((legacy as any)?.status === "disabled") {
          return new Response(JSON.stringify({ error: "Integração desativada" }), {
            status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const cfg = ((legacy as any)?.config ?? {}) as any;
        const legacyToken = cfg.access_token || cfg.token;
        if (legacyToken && cfg.phone_number_id) {
          whatsappToken = legacyToken;
          phoneNumberId = cfg.phone_number_id;
          resolvedCredentials = true;
        }
      }
    }

    // WABA efetiva deste envio (para casar o template no mundo certo).
    const escopoEnvio = await escopoDoLead(supabase, {
      whatsapp_number_id: (leadData as any)?.whatsapp_number_id ?? null,
      tenant_id: leadTenantId,
    });
    const wabaDoEnvio = escopoEnvio.wabaId;

    if (!resolvedCredentials || !whatsappToken || !phoneNumberId) {
      return new Response(JSON.stringify({
        error: "Sem credenciais WhatsApp para o cliente deste lead",
        tenant_id: leadTenantId,
      }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    // (IDOR) Todo id de mensagem vindo do corpo tem de ser do MESMO lead/tenant
    // do envio — senão dava para ler/reagir a mensagens de outra conversa.
    const assertBodyMessage = async (messageId: string) => {
      const check = await assertMessageInTenant(supabase, messageId, caller);
      if (!check.ok) return check;
      const { data: row } = await supabase.from("messages").select("lead_id").eq("id", messageId).maybeSingle();
      if (!row || row.lead_id !== lead_id) {
        return { ok: false as const, status: 403, error: "Mensagem não pertence a esta conversa" };
      }
      return { ok: true as const };
    };
    for (const mid of [reply_to_message_id, reaction_to_message_id].filter(Boolean) as string[]) {
      const c = await assertBodyMessage(mid);
      if (!c.ok) {
        console.warn(`[send-whatsapp-message] message guard: ${c.error} msg=${mid} lead=${lead_id}`);
        return new Response(JSON.stringify({ error: c.error }), {
          status: c.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    let resolvedWamid = reply_to_wamid || null;
    if (!resolvedWamid && reply_to_message_id) {
      const { data: origMsg } = await supabase
        .from("messages")
        .select("whatsapp_message_id")
        .eq("id", reply_to_message_id)
        .single();
      resolvedWamid = origMsg?.whatsapp_message_id || null;
    }

    if (type === "reaction") {
      let reactionWamid = null;
      if (reaction_to_message_id) {
        const { data: reactMsg } = await supabase
          .from("messages")
          .select("whatsapp_message_id")
          .eq("id", reaction_to_message_id)
          .single();
        reactionWamid = reactMsg?.whatsapp_message_id || null;
      }

      if (!reactionWamid) {
        return new Response(JSON.stringify({ error: "Cannot react: original message has no WhatsApp ID" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const reactionBody = {
        messaging_product: "whatsapp",
        to,
        type: "reaction",
        reaction: {
          message_id: reactionWamid,
          emoji: reaction_emoji || "👍",
        },
      };

      const waResponse = await fetch(
        `https://graph.facebook.com/v25.0/${phoneNumberId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${whatsappToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(reactionBody),
        }
      );
      const waData = await waResponse.json();

      if (!waResponse.ok) {
        return new Response(JSON.stringify({ error: "WhatsApp reaction error", details: waData }), {
          status: waResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: targetMsg } = await supabase
        .from("messages")
        .select("reactions")
        .eq("id", reaction_to_message_id)
        .single();

      const existingReactions = Array.isArray(targetMsg?.reactions) ? targetMsg.reactions : [];
      const filtered = existingReactions.filter((r: any) => r.from !== "me");
      const updatedReactions = [...filtered, { emoji: reaction_emoji || "👍", from: "me" }];

      await supabase
        .from("messages")
        .update({ reactions: updatedReactions })
        .eq("id", reaction_to_message_id);

      return new Response(JSON.stringify({ success: true, whatsapp: waData }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let finalType = type;
    let sentTemplateName = template_name || null;
    let waBody: any = { messaging_product: "whatsapp", to };

    if (resolvedWamid) {
      waBody.context = { message_id: resolvedWamid };
    }

    if (type === "interactive") {
      waBody.type = "interactive";
      const interactiveBody = body || message || "Escolha uma opção:";

      if (interactive_type === "list") {
        const listInteractive: any = {
          type: "list",
          body: { text: interactiveBody },
          action: {
            button: button_text || "Ver opções",
            sections: (sections || []).map((s: any) => ({
              title: (s.title || "Opções").slice(0, 24),
              rows: (s.rows || []).map((r: any) => ({
                id: r.id || r.title?.slice(0, 20) || "opt",
                title: (r.title || "").slice(0, 24),
                description: r.description ? r.description.slice(0, 72) : undefined,
              })),
            })),
          },
        };
        if (header) listInteractive.header = { type: "text", text: String(header).slice(0, 60) };
        if (footer) listInteractive.footer = { text: String(footer).slice(0, 60) };
        waBody.interactive = listInteractive;
      } else {
        waBody.interactive = {
          type: "button",
          body: { text: interactiveBody },
          action: {
            buttons: (buttons || []).slice(0, 3).map((b: any) => ({
              type: "reply",
              reply: {
                id: b.reply?.id || b.id || "btn",
                title: (b.reply?.title || b.title || "").slice(0, 20),
              },
            })),
          },
        };
      }
    } else if (type === "template") {
      waBody.type = "template";

      let resolvedTemplateName = template_name;
      let resolvedComponents = Array.isArray(template_components) ? [...template_components] : [];

      if (template_name) {
        const [tplRow, tplLead, nextAppt] = await Promise.all([
          resolveTemplateForSend(supabase, template_name, leadTenantId, wabaDoEnvio),
          supabase
            .from("crm_leads")
            .select("name, phone, source, servico_interesse")
            .eq("id", lead_id)
            .maybeSingle()
            .then(({ data }) => data),
          supabase
            .from("crm_appointments")
            .select("scheduled_date, scheduled_time")
            .eq("lead_id", lead_id)
            .in("status", ["confirmed", "pending"])
            .order("scheduled_date", { ascending: true })
            .limit(1)
            .maybeSingle()
            .then(({ data }) => data),
        ]);

        if (!tplRow) {
          console.warn(`[send-whatsapp] template "${template_name}" inexistente na WABA ${wabaDoEnvio ?? "(legada)"} (lead ${lead_id})`);
          return new Response(JSON.stringify({
            error: "Template não existe na WABA deste número",
            template_name,
            waba_id: wabaDoEnvio,
          }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        if (tplRow) {
          resolvedTemplateName = tplRow.name;
          const headerType = (tplRow.header_type || "").toUpperCase();
          const bodyText = tplRow.body_text || "";
          const placeholderIndexes = getTemplatePlaceholderIndexes(bodyText);

          let formattedApptDate: string | null = null;
          if (nextAppt?.scheduled_date) {
            const [y, m, d] = nextAppt.scheduled_date.split("-");
            const timePart = nextAppt.scheduled_time ? ` às ${nextAppt.scheduled_time.slice(0, 5)}` : "";
            formattedApptDate = `${d}/${m}/${y}${timePart}`;
          }
          const fallbackValues = buildTemplateFallbacks(tplLead || null, formattedApptDate);

          if (["IMAGE", "VIDEO", "DOCUMENT"].includes(headerType) && tplRow.header_content) {
            resolvedComponents = resolvedComponents.filter((component: any) => String(component?.type || "").toLowerCase() !== "header");

            // Tenta cachear a mídia num bucket público estável. Se falhar (URL do
            // Meta expirada, bucket com limite, RLS bloqueando etc.), NÃO derrubar
            // o envio — cai de volta para a URL original do Meta. Se essa também
            // não funcionar, o erro do Meta é capturado adiante e vira mensagem
            // com status=failed (visível na conversa), em vez de sumir silencioso.
            let stableHeaderLink: string | null = tplRow.header_content;
            try {
              stableHeaderLink = await ensurePublicTemplateMediaLink(
                supabase,
                resolvedTemplateName,
                headerType,
                tplRow.header_content,
              );

              if (stableHeaderLink && stableHeaderLink !== tplRow.header_content) {
                // Update pela PK da linha resolvida (não por `name`, que se
                // repete entre tenants).
                await supabase
                  .from("crm_whatsapp_templates")
                  .update({ header_content: stableHeaderLink, updated_at: new Date().toISOString() })
                  .eq("id", tplRow.id);
              }
            } catch (mediaErr) {
              console.warn(
                `[send-whatsapp] Falha ao cachear mídia do template ${resolvedTemplateName}: ${mediaErr instanceof Error ? mediaErr.message : String(mediaErr)} — usando URL original.`,
              );
              stableHeaderLink = tplRow.header_content;
            }

            const headerComponent = stableHeaderLink ? buildMediaHeaderComponent(headerType, stableHeaderLink) : null;
            if (headerComponent) {
              resolvedComponents.unshift(headerComponent);
            }
          }

          if (placeholderIndexes.length > 0) {
            const bodyIndex = resolvedComponents.findIndex((component: any) => String(component?.type || "").toLowerCase() === "body");
            const existingBody = bodyIndex >= 0 ? resolvedComponents[bodyIndex] : null;
            const existingParams = Array.isArray(existingBody?.parameters) ? existingBody.parameters : [];
            const shouldRebuildBody =
              bodyIndex === -1 ||
              existingParams.length !== placeholderIndexes.length ||
              existingParams.some((parameter: any) => {
                const textValue = String(parameter?.text || "").trim().toLowerCase();
                return !textValue || textValue === "cliente" || textValue.includes("{{");
              });

            if (shouldRebuildBody) {
              const bodyComponent = {
                type: "body",
                parameters: placeholderIndexes.map((_, index) => ({
                  type: "text",
                  text: (fallbackValues[index] || fallbackValues[0]).trim() || "cliente",
                })),
              };

              if (bodyIndex >= 0) {
                resolvedComponents[bodyIndex] = bodyComponent;
              } else {
                resolvedComponents.push(bodyComponent);
              }
            }
          }

          console.log(`[send-whatsapp] Resolved ${resolvedComponents.length} component(s) for template ${resolvedTemplateName}`, JSON.stringify(resolvedComponents));
        }
      }

      waBody.template = {
        name: resolvedTemplateName,
        language: { code: template_language || "pt_BR" },
        ...(resolvedComponents.length > 0 ? { components: resolvedComponents } : {}),
      };
      sentTemplateName = resolvedTemplateName || sentTemplateName;
    } else if (type === "text") {
      if (!message) {
        return new Response(JSON.stringify({ error: "Missing message for text type" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      waBody.type = "text";
      waBody.text = { body: message };
    } else if (media_url) {
      console.log(`[send-whatsapp] Downloading media: ${media_url}, type: ${type}`);

      let fileBlob: Blob;
      const chatMediaMarker = "/storage/v1/object/";
      const isChatMedia = media_url.includes(chatMediaMarker) && media_url.includes("chat-media");

      if (isChatMedia) {
        const pathMatch = media_url.match(/chat-media\/(.+?)(?:\?|$)/);
        const storagePath = pathMatch ? decodeURIComponent(pathMatch[1]) : null;

        if (storagePath) {
          console.log(`[send-whatsapp] Downloading from private bucket, path: ${storagePath}`);
          const { data: fileData, error: downloadError } = await supabase.storage
            .from("chat-media")
            .download(storagePath);

          if (downloadError || !fileData) {
            console.error(`[send-whatsapp] Failed to download from storage: ${JSON.stringify(downloadError)}`);
            return new Response(JSON.stringify({ error: "Failed to download file from storage", details: downloadError }), {
              status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          fileBlob = fileData;
        } else {
          const { data: signedData } = await supabase.storage.from("chat-media").createSignedUrl(media_url, 300);
          const fileResponse = await fetch(signedData?.signedUrl || media_url);
          if (!fileResponse.ok) {
            return new Response(JSON.stringify({ error: "Failed to download file from storage", status: fileResponse.status }), {
              status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          fileBlob = await fileResponse.blob();
        }
      } else {


        // (SSRF) URL externa: só https em host allowlistado (Storage do projeto
        // ou CDN da Meta), sem redirect para fora, com timeout e teto de 16 MB.
        const guard = assertAllowedMediaUrl(media_url);
        if (!guard.ok) {
          console.warn(`[send-whatsapp-message] media_url bloqueada: ${guard.error}`);
          return new Response(JSON.stringify({ error: `media_url não permitida: ${guard.error}` }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const fileResponse = await fetch(guard.url, { redirect: "error", signal: AbortSignal.timeout(30000) });
        if (!fileResponse.ok) {
          console.error(`[send-whatsapp] Failed to download file: ${fileResponse.status}`);
          return new Response(JSON.stringify({ error: "Failed to download file from storage", status: fileResponse.status }), {
            status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const declaredLen = Number(fileResponse.headers.get("content-length") || 0);
        if (declaredLen && declaredLen > MAX_MEDIA_BYTES) {
          return new Response(JSON.stringify({ error: "Mídia maior que o limite de 16 MB." }), {
            status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        fileBlob = await fileResponse.blob();
        if (fileBlob.size > MAX_MEDIA_BYTES) {
          return new Response(JSON.stringify({ error: "Mídia maior que o limite de 16 MB." }), {
            status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      let filename = "file";
      try {
        const parsedUrl = new URL(media_url);
        filename = decodeURIComponent(parsedUrl.pathname.split("/").pop() || "file");
      } catch {
        const cleanUrl = media_url.split("?")[0];
        const urlParts = cleanUrl.split("/");
        filename = urlParts[urlParts.length - 1] || "file";
      }

      const ext = filename.split(".").pop()?.toLowerCase() || "";

      const contentTypeMap: Record<string, string> = {
        ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg",
        webm: type === "audio" ? "audio/ogg" : "video/webm",
        mp3: "audio/mpeg", m4a: "audio/mp4",
        wav: "audio/wav", aac: "audio/aac",
        mp4: type === "video" ? "video/mp4" : "audio/mp4",
        jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
        pdf: "application/pdf", doc: "application/msword",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        xls: "application/vnd.ms-excel",
        xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      };
      const contentType = contentTypeMap[ext] || fileBlob.type || "application/octet-stream";

      const audioExtensions = new Set(["ogg", "oga", "opus", "mp3", "m4a", "wav", "aac", "webm", "amr"]);
      const isAudioFile = type === "audio" || audioExtensions.has(ext) || contentType.toLowerCase().startsWith("audio/");
      if (isAudioFile && type !== "audio") {
        console.log(`[send-whatsapp] Correcting type from "${type}" to "audio" based on file: ${filename}`);
      }
      finalType = isAudioFile ? "audio" : type;
      const resolvedType = finalType;

      const uploadFilename = resolvedType === "audio" ? filename.replace(/\.\w+$/, ".ogg") : filename;
      const uploadContentType = resolvedType === "audio" ? "audio/ogg" : contentType;

      console.log(`[send-whatsapp] Uploading to Meta: filename=${uploadFilename}, contentType=${uploadContentType}, size=${fileBlob.size}, resolvedType=${resolvedType}`);

      const formData = new FormData();
      formData.append("messaging_product", "whatsapp");
      formData.append("file", new File([fileBlob], uploadFilename, { type: uploadContentType }));
      formData.append("type", uploadContentType);

      const uploadResponse = await fetch(
        `https://graph.facebook.com/v25.0/${phoneNumberId}/media`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${whatsappToken}` },
          body: formData,
        }
      );
      const uploadData = await uploadResponse.json();

      console.log(`[send-whatsapp] Meta upload response: ${JSON.stringify(uploadData)}`);

      if (!uploadResponse.ok || !uploadData.id) {
        console.error(`[send-whatsapp] Meta media upload failed: ${JSON.stringify(uploadData)}`);
        return new Response(JSON.stringify({ error: "Meta media upload failed", details: uploadData }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const mediaId = uploadData.id;

      waBody.type = resolvedType;
      if (resolvedType === "image") {
        waBody.image = { id: mediaId, caption: message || undefined };
      } else if (resolvedType === "audio") {
        waBody.audio = audio_voice ? { id: mediaId, voice: true } : { id: mediaId };
      } else if (resolvedType === "video") {
        waBody.video = { id: mediaId, caption: message || undefined };
      } else if (resolvedType === "document") {
        waBody.document = { id: mediaId, caption: message || undefined, filename };
      } else if (resolvedType === "sticker") {
        waBody.sticker = { id: mediaId };
      } else {
        return new Response(JSON.stringify({ error: `Unsupported media type: ${resolvedType}` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      return new Response(JSON.stringify({ error: "Missing media_url for non-text message" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[send-whatsapp] Sending to META phoneId=${phoneNumberId} tokenLen=${whatsappToken.length} type=${type} payload=${JSON.stringify(waBody)}`);

    const waResponse = await fetch(
      `https://graph.facebook.com/v25.0/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${whatsappToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(waBody),
      }
    );

    const waData = await waResponse.json();

    if (!waResponse.ok) {
      const metaError = waData?.error?.message || waData?.error?.error_user_msg || JSON.stringify(waData?.error || waData);
      const metaErrorCode = waData?.error?.code || waResponse.status;
      console.error(`[send-whatsapp] META API error (${metaErrorCode}) status=${waResponse.status}: ${metaError} | full=${JSON.stringify(waData)}`);


      // Translate common META errors to user-friendly Portuguese
      let friendlyError = metaError;
      if (metaError.includes("Re-engage") || metaError.includes("24 hour")) {
        friendlyError = "Janela de 24h expirada. Use um template para reabrir a conversa.";
      } else if (metaError.includes("not a valid WhatsApp") || metaError.includes("Recipient phone number not in allowed")) {
        friendlyError = "Número não registrado no WhatsApp.";
      } else if (metaError.includes("template") && metaError.includes("not found")) {
        friendlyError = "Template não encontrado ou não aprovado pela META.";
      } else if (metaError.includes("rate limit") || metaError.includes("throttl")) {
        friendlyError = "Limite de envio atingido. Tente novamente em alguns minutos.";
      } else if (metaError.includes("spam") || metaError.includes("blocked")) {
        friendlyError = "Mensagem bloqueada pela META (possível spam ou bloqueio do contato).";
      }
      if (String(metaErrorCode) === "131053" || metaError.includes("Media upload error")) {
        friendlyError = "131053 — a Meta não conseguiu processar o vídeo do template (arquivo pode estar corrompido ou incompleto no Storage)";
      }

      // Still insert the message as failed so user can see it in chat
      const dbContent = (caller.isServiceRole ? log_content : null) || (type === "template" ? `📋 Template: ${sentTemplateName || "template"}` : type === "interactive" ? (body || message || "[menu]") : (message || null));
      const dbType = type === "template" || type === "interactive" ? "text" : finalType;
      const { data: failedMsg } = await supabase.from("messages").insert({
        lead_id,
        direction: "outbound",
        type: dbType,
        content: dbContent,
        media_url: media_url || null,
        status: "failed",
        error_reason: friendlyError,
        reply_to_message_id: reply_to_message_id || null,
        ...(leadTenantId ? { tenant_id: leadTenantId } : {}),
      }).select().single();

      return new Response(JSON.stringify({ ok: false, error: friendlyError, error_code: metaErrorCode, message: failedMsg }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sentWamid = waData?.messages?.[0]?.id || null;
    const initialStatus = waData?.messages?.[0]?.message_status || "accepted";
    const dbContent = (caller.isServiceRole ? log_content : null) || (type === "template" ? `📋 Template: ${sentTemplateName || "template"}` : type === "interactive" ? (body || message || "[menu]") : (message || null));
    const dbType = type === "template" || type === "interactive" ? "text" : finalType;
    const { data: msg, error: insertError } = await supabase.from("messages").insert({
      lead_id,
      direction: "outbound",
      type: dbType,
      content: dbContent,
      media_url: media_url || null,
      status: initialStatus,
      whatsapp_message_id: sentWamid,
      reply_to_message_id: reply_to_message_id || null,
      ...(leadTenantId ? { tenant_id: leadTenantId } : {}),
    }).select().single();

    if (insertError) {
      return new Response(JSON.stringify({ error: "DB insert error", details: insertError }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date().toISOString();
    // When a bot has "Marcar como lida" disabled, we skip updating last_outbound_at
    // so the conversation continues to appear as "aguardando resposta" in the CRM.
    const leadUpdate: Record<string, any> = {
      last_message: message || `[${finalType}]`,
      last_message_at: now,
    };
    if (!skip_mark_as_read) {
      leadUpdate.last_outbound_at = now;
    }
    await supabase.from("crm_leads").update(leadUpdate).eq("id", lead_id);

    return new Response(JSON.stringify({ success: true, message: msg, whatsapp: waData }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
