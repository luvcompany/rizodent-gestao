// Checa na Meta o estado de cada número de WhatsApp conectado e grava em
// integrations.health_* — usado para pausar envios e mostrar o selo de status.
// Chamado pelo cron (x-cron-secret) a cada 5 min ou pelo botão "Verificar agora".
// Corpo opcional: { phone_number_id } checa só aquele número.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { authorizeInternal, unauthorizedResponse } from "../_shared/internalAuth.ts";
import { e164DaMeta, manterErroDoEnvio } from "../_shared/saudeWhatsapp.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const GRAPH = "https://graph.facebook.com/v25.0";

const responder = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function checar(token: string, phoneId: string, wabaId?: string) {
  const r = await fetch(`${GRAPH}/${phoneId}?fields=status,quality_rating,messaging_limit_tier,code_verification_status,name_status,display_phone_number,platform_type`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const code = String(d?.error?.code ?? r.status);
    const reason = code === "190" ? "Token expirado ou inválido" : `Erro da Meta: ${d?.error?.message ?? r.status}`;
    return {
      saude: { health_status: "error", health_reason: reason, meta_status: null as string | null, quality_rating: null as string | null },
      platform_type: null as string | null,
      waba_ok: null as boolean | null,
      display_phone_number: null as string | null,
    };
  }
  const status = String(d.status ?? "").toUpperCase();
  const quality = String(d.quality_rating ?? "").toUpperCase() || null;
  let health = "ok";
  let reason: string | null = null;
  if (["DISCONNECTED", "BANNED", "RESTRICTED", "FLAGGED", "DELETED", "UNVERIFIED", "OFFLINE"].includes(status) || (status && status !== "CONNECTED" && status !== "PENDING")) {
    health = "error";
    reason = status === "BANNED" ? "Número banido pela Meta"
      : status === "RESTRICTED" ? "Conta restrita pela Meta"
      : "Desconectado da Meta";
  } else if (quality === "RED") {
    health = "warning"; reason = "Qualidade baixa (vermelha)";
  } else if (quality === "YELLOW" || status === "FLAGGED") {
    health = "warning"; reason = "Qualidade em alerta (amarela)";
  }
  // Conta (WABA) consultada e sem banimento/reprovação: prova usada para
  // apagar um erro "conta bloqueada" gravado pelo envio.
  let wabaOk: boolean | null = null;
  if (health !== "error" && wabaId) {
    const w = await fetch(`${GRAPH}/${wabaId}?fields=account_review_status,ban_state`, { headers: { Authorization: `Bearer ${token}` } });
    const wd = await w.json().catch(() => ({}));
    if (w.ok && wd?.ban_state && wd.ban_state !== "DEFAULT") {
      health = "error"; reason = "Conta do WhatsApp bloqueada na Meta"; wabaOk = false;
    } else if (w.ok && wd?.account_review_status === "REJECTED") {
      health = "error"; reason = "Conta reprovada na revisão da Meta"; wabaOk = false;
    } else if (w.ok) {
      wabaOk = true;
    }
  }
  return {
    saude: { health_status: health, health_reason: reason, meta_status: (status || null) as string | null, quality_rating: quality },
    platform_type: (d.platform_type ? String(d.platform_type).toUpperCase() : null) as string | null,
    waba_ok: wabaOk,
    display_phone_number: (d.display_phone_number ? String(d.display_phone_number) : null) as string | null,
  };
}

// Inscreve o app dono do token na conta do WhatsApp (subscribed_apps), se ainda não estiver.
async function garantirAssinatura(token: string, wabaId: string): Promise<string | null> {
  try {
    const appR = await fetch(`${GRAPH}/app?fields=id`, { headers: { Authorization: `Bearer ${token}` } });
    const app = await appR.json();
    const subR = await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, { headers: { Authorization: `Bearer ${token}` } });
    const sub = await subR.json();
    const inscrito = (sub?.data ?? []).some((d: any) => String(d?.whatsapp_business_api_data?.id) === String(app?.id));
    if (inscrito) return null;
    const r = await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    return `assinatura de mensagens ${r.ok ? "ativada" : "falhou: " + (await r.text())}`;
  } catch (e) {
    return `assinatura de mensagens falhou: ${e}`;
  }
}

/**
 * Clínica de quem chamou pelo app (botão "Verificar agora"). null = sem
 * clínica: sem perfil, perfil sem tenant, bloqueado ou sem papel (quem não tem
 * linha em user_roles não pertence a clínica nenhuma — AGENTS.md). Lança se a
 * consulta falhar.
 */
async function clinicaDoUsuario(supabase: any, userId: string): Promise<string | null> {
  // A chave de profiles é `id` (= auth.users.id); não existe profiles.user_id.
  // Antes o filtro era por user_id: a consulta falhava, ninguém tinha clínica e
  // quem não era superadmin recebia "ok" com a lista vazia sem checar nada.
  const { data: prof, error } = await supabase
    .from("profiles").select("tenant_id, is_blocked").eq("id", userId).maybeSingle();
  if (error) throw error;
  if (!prof?.tenant_id || prof.is_blocked === true) return null;
  const { data: papeis, error: papelErr } = await supabase
    .from("user_roles").select("role").eq("user_id", userId).limit(1);
  if (papelErr) throw papelErr;
  return (papeis ?? []).length > 0 ? String(prof.tenant_id) : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const auth = await authorizeInternal(req, supabase, { cronSecretName: "automation_cron_token", allowUserJwt: true });
  if (!auth.ok) return unauthorizedResponse(corsHeaders);

  // Corpo opcional { phone_number_id }: checa só aquele número (selo "Verificar agora").
  const corpo = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const pnidPedido = String((corpo as any)?.phone_number_id ?? "").trim();
  if (pnidPedido && !/^[0-9]+$/.test(pnidPedido)) {
    return responder({ error: "Identificador do número (phone_number_id) inválido." }, 400);
  }

  try {
    let q = supabase
      .from("integrations")
      .select("id, tenant_id, key, config, status, health_status, health_reason, health_checked_at")
      .like("key", "whatsapp_%")
      .neq("status", "disabled");
    if (pnidPedido) q = q.filter("config->>phone_number_id", "eq", pnidPedido);
    if (auth.via === "user_jwt") {
      let tenantId: string | null;
      try {
        tenantId = await clinicaDoUsuario(supabase, auth.userId!);
      } catch (e) {
        console.error("[wa-health] perfil:", e);
        return responder({ error: "Não foi possível conferir o seu acesso agora. Tente de novo em instantes." }, 403);
      }
      if (tenantId) {
        q = q.eq("tenant_id", tenantId);
      } else {
        // Sem clínica vinculada: só o superadmin (Luv Agency) pode checar todos.
        const { data: isSuper, error: superErr } = await supabase.rpc("has_role", { _user_id: auth.userId!, _role: "superadmin" });
        if (superErr || isSuper !== true) {
          return responder({ error: "Seu usuário não está vinculado a uma clínica: não é possível verificar os números de WhatsApp." }, 403);
        }
      }
    }
    const { data: rows, error } = await q;
    if (error) throw error;
    if (pnidPedido && (rows ?? []).length === 0) {
      return responder({ error: "Número de WhatsApp não encontrado nesta clínica (ou com a integração desativada)." }, 404);
    }
    const out: any[] = [];
    for (const row of rows ?? []) {
      const cfg = (row.config ?? {}) as any;
      const token = cfg.access_token || cfg.token;
      if (!token || !cfg.phone_number_id) continue;
      const pnid = String(cfg.phone_number_id);
      try {
        const leitura = await checar(token, pnid, cfg.waba_id);
        // Garante que a conta do WhatsApp entrega as mensagens recebidas para o nosso app.
        if (cfg.waba_id) {
          const assinatura = await garantirAssinatura(token, String(cfg.waba_id));
          if (assinatura) console.log(`[wa-health] ${row.key}: ${assinatura}`);
        }
        // Telefone do número ainda vazio: grava o que a Meta exibe (+55DDDNÚMERO).
        const e164 = e164DaMeta(leitura.display_phone_number);
        if (e164) {
          const { error: telErr } = await supabase
            .from("whatsapp_numbers")
            .update({ phone_e164: e164 })
            .eq("tenant_id", row.tenant_id)
            .eq("phone_number_id", pnid)
            .is("phone_e164", null);
          if (telErr) console.error(`[wa-health] ${row.key}: telefone não gravado:`, telErr.message);
        }
        // Erro de conta gravado pelo envio (133010/131031/"not registered"…)
        // nas últimas 6 h: CONNECTED não prova que o número voltou a enviar.
        // Sem prova de registro, mantém o erro (e a hora dele, para a janela
        // vencer) e só atualiza o que é informativo.
        if (manterErroDoEnvio(row as any, { ...leitura.saude, platform_type: leitura.platform_type, waba_ok: leitura.waba_ok }, Date.now())) {
          await supabase.from("integrations")
            .update({ meta_status: leitura.saude.meta_status, quality_rating: leitura.saude.quality_rating })
            .eq("id", row.id);
          console.log(`[wa-health] ${row.key}: mantido o erro do envio (${row.health_reason}); meta_status=${leitura.saude.meta_status} platform_type=${leitura.platform_type}`);
          out.push({
            key: row.key,
            health_status: "error",
            health_reason: row.health_reason,
            meta_status: leitura.saude.meta_status,
            quality_rating: leitura.saude.quality_rating,
            mantido: "erro de conta gravado pelo envio, sem prova de registro na Meta",
          });
          continue;
        }
        const extra: Record<string, unknown> = {};
        // Número novo que a Meta já confirma conectado passa a valer sem precisar "Testar".
        if (leitura.saude.meta_status === "CONNECTED" && row.status === "disconnected") extra.status = "connected";
        await supabase.from("integrations").update({ ...leitura.saude, ...extra, health_checked_at: new Date().toISOString() }).eq("id", row.id);
        out.push({ key: row.key, ...leitura.saude });
      } catch (e) {
        console.error(`[wa-health] ${row.key}:`, e);
      }
    }
    return responder({ ok: true, checked: out });
  } catch (e: any) {
    console.error("[wa-health]", e);
    return responder({ error: e?.message ?? String(e) }, 500);
  }
});
