// WhatsApp OAuth callback (redirect-based, sem FB JS SDK).
// Espelha instagram-oauth-callback: valida state, troca code por token,
// descobre WABAs via debug_token, para cada número: subscribed_apps + register (best-effort)
// e upsert em `integrations` com key `whatsapp_es_{phone_number_id}`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { resolveWhatsAppCreds } from "../_shared/tenantCredentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const META_APP_ID = Deno.env.get("META_APP_ID") ?? "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const REDIRECT_URI = Deno.env.get("WHATSAPP_REDIRECT_URI") ?? "";
const FRONTEND_URL = Deno.env.get("FRONTEND_URL") ?? "https://crclin.com.br";
const API_VERSION = "v21.0";
// Coexistência entrou depois da v21 — as chamadas específicas dela (status do
// número, sync) exigem versão mais nova. Mantida à parte para não mexer no
// fluxo clássico, que roda em produção nesta versão.
const COEX_API_VERSION = "v25.0";

const supabase = createClient(supabaseUrl, serviceRoleKey);

function popupResponse(
  channel: "instagram" | "whatsapp",
  status: "connected" | "error",
  count = 0,
): Response {
  let base = "https://crclin.com.br";
  try {
    base = new URL(FRONTEND_URL || "https://crclin.com.br").origin;
  } catch {
    base = "https://crclin.com.br";
  }
  const qs = new URLSearchParams({ channel, status, count: String(count) });
  return Response.redirect(`${base}/oauth-close?${qs.toString()}`, 302);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");
  

  if (errorParam) {
    console.error("[wa-oauth-callback] error from Meta:", errorParam, url.searchParams.get("error_description"));
    return popupResponse("whatsapp", "error");
  }
  if (!code || !state) {
    return new Response(JSON.stringify({ error: "Missing code or state" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Valida state — consumo ATÔMICO (delete ... returning)
  const { data: stateRows, error: stateErr } = await supabase
    .from("whatsapp_oauth_states")
    .delete()
    .eq("state", state)
    .select("tenant_id, user_id, expires_at, coexistence");
  const stateRow = (stateRows || [])[0];
  if (stateErr || !stateRow) {
    console.warn("[wa-oauth-callback] invalid state:", state, stateErr);
    return popupResponse("whatsapp", "error");
  }
  if (new Date(stateRow.expires_at).getTime() < Date.now()) {
    return popupResponse("whatsapp", "error");
  }

  // NÃO confia no tenant_id gravado pelo front: confere com o profile do usuário
  // e exige papel crc/gerente/superadmin.
  const { data: prof } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", stateRow.user_id)
    .maybeSingle();
  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", stateRow.user_id);
  const roleList = (roles || []).map((r: any) => r.role);
  const isSuperadmin = roleList.includes("superadmin");
  if (!isSuperadmin) {
    if (!prof?.tenant_id || prof.tenant_id !== stateRow.tenant_id) {
      console.warn("[wa-oauth-callback] tenant mismatch para user", stateRow.user_id);
      return popupResponse("whatsapp", "error");
    }
    if (!roleList.some((r: string) => r === "crc" || r === "gerente")) {
      console.warn("[wa-oauth-callback] papel sem permissão:", roleList);
      return popupResponse("whatsapp", "error");
    }
  }

  const tenantId: string = stateRow.tenant_id;
  const isCoexistence: boolean = (stateRow as any)?.coexistence === true;

  // APP META POR TENANT: cada cliente pode ter o seu app. Envs continuam como
  // fallback (Rizodent inalterada). O app REALMENTE usado é gravado no config.
  let appId = META_APP_ID;
  let appSecret = META_APP_SECRET;
  let redirectUri = REDIRECT_URI;
  try {
    const creds = await resolveWhatsAppCreds({ tenantId });
    if (creds.app_id) appId = creds.app_id;
    if (creds.app_secret) appSecret = creds.app_secret;
  } catch (e) {
    console.log("[wa-oauth-callback] creds por tenant indisponíveis, usando env:", (e as any)?.message);
  }
  {
    const { data: integ } = await supabase
      .from("integrations")
      .select("config")
      .eq("tenant_id", tenantId)
      .eq("key", "whatsapp_config")
      .maybeSingle();
    const cfg = ((integ as any)?.config ?? {}) as Record<string, string>;
    if (cfg.app_id) appId = cfg.app_id;
    if (cfg.app_secret) appSecret = cfg.app_secret;
    if (cfg.redirect_uri) redirectUri = cfg.redirect_uri;
  }
  if (!appId || !appSecret || !redirectUri) {
    console.error("[wa-oauth-callback] tenant sem app_id/app_secret/redirect_uri configurados");
    return popupResponse("whatsapp", "error");
  }

  // Verify token POR TENANT: nunca copiar o global do ambiente para dados do
  // cliente (quem lê a integração de um tenant passaria a poder validar o
  // webhook de qualquer outro). O whatsapp-webhook continua aceitando o global.
  let tenantVerifyToken = "";
  {
    const { data: cred } = await supabase
      .from("tenant_meta_credentials")
      .select("whatsapp_verify_token")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    tenantVerifyToken = String((cred as any)?.whatsapp_verify_token || "");
  }




  try {
    // 1) Troca code por access_token
    const tokUrl = new URL(`https://graph.facebook.com/${API_VERSION}/oauth/access_token`);
    tokUrl.searchParams.set("client_id", appId);
    tokUrl.searchParams.set("client_secret", appSecret);
    tokUrl.searchParams.set("redirect_uri", redirectUri);
    tokUrl.searchParams.set("code", code);
    const tokRes = await fetch(tokUrl.toString());
    const tokJson: any = await tokRes.json().catch(() => ({}));
    if (!tokRes.ok || !tokJson?.access_token) {
      console.error("[wa-oauth-callback] token exchange failed:", tokJson);
      return popupResponse("whatsapp", "error");
    }
    const access_token: string = tokJson.access_token;

    // 2) Descobre WABAs via debug_token
    const appAccessToken = `${appId}|${appSecret}`;
    const dbgUrl = new URL(`https://graph.facebook.com/${API_VERSION}/debug_token`);
    dbgUrl.searchParams.set("input_token", access_token);
    dbgUrl.searchParams.set("access_token", appAccessToken);
    const dbgRes = await fetch(dbgUrl.toString());
    const dbgJson: any = await dbgRes.json().catch(() => ({}));
    if (!dbgRes.ok) {
      console.error("[wa-oauth-callback] debug_token failed:", dbgJson);
      return popupResponse("whatsapp", "error");
    }
    const granular: Array<{ scope: string; target_ids?: string[] }> = dbgJson?.data?.granular_scopes ?? [];
    const wabaIds = new Set<string>();
    for (const g of granular) {
      if (g.scope === "whatsapp_business_management" || g.scope === "whatsapp_business_messaging") {
        for (const tid of g.target_ids ?? []) wabaIds.add(tid);
      }
    }
    console.log(`[wa-oauth-callback] discovered ${wabaIds.size} WABA(s):`, [...wabaIds]);

    if (wabaIds.size === 0) {
      return popupResponse("whatsapp", "error");
    }

    let connected = 0;
    for (const waba_id of wabaIds) {

      // 3) Liga o app a esta WABA. ATENÇÃO: quais CAMPOS de webhook chegam é
      // configuração do APP (App Dashboard > WhatsApp > Configuração), não deste
      // POST — a Subscribed Apps API só aceita override_callback_uri/verify_token.
      // O array abaixo é mantido por compatibilidade e documenta a intenção, mas
      // "smb_message_echoes" PRECISA estar marcado no painel da Meta, senão as
      // mensagens enviadas pelo celular nunca chegam ao CRM.
      try {
        const subRes = await fetch(
          `https://graph.facebook.com/${API_VERSION}/${encodeURIComponent(waba_id)}/subscribed_apps`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${access_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              subscribed_fields: [
                "messages",
                "message_template_status_update",
                "account_update",
                "calls",
                "smb_message_echoes",
              ],
            }),
          },
        );
        if (!subRes.ok) {
          const t = await subRes.text().catch(() => "");
          console.warn(`[wa-oauth-callback] subscribed_apps failed for ${waba_id}:`, subRes.status, t);
        } else {
          console.log(`[wa-oauth-callback] subscribed_apps OK for ${waba_id} (fields incl. calls)`);
        }
      } catch (e) {
        console.warn(`[wa-oauth-callback] subscribed_apps error for ${waba_id}:`, e);
      }


      // 4) Lista números da WABA
      const phRes = await fetch(
        `https://graph.facebook.com/${API_VERSION}/${encodeURIComponent(waba_id)}/phone_numbers?access_token=${encodeURIComponent(access_token)}`,
      );
      const phJson: any = await phRes.json().catch(() => ({}));
      if (!phRes.ok) {
        console.warn(`[wa-oauth-callback] phone_numbers failed for ${waba_id}:`, phJson);
        continue;
      }
      const numbers: Array<{ id: string; display_phone_number?: string; verified_name?: string }> = phJson?.data ?? [];

      for (const num of numbers) {
        const phone_number_id = num.id;
        const display_name = num.verified_name || num.display_phone_number || `WhatsApp ${phone_number_id.slice(-4)}`;

        // A INTENÇÃO do usuário (botão de coexistência) não é garantia: o fluxo
        // aqui é redirect puro e a Meta documenta `extras` no FB.login(). Se o
        // parâmetro for ignorado, o onboarding sai CLÁSSICO e o número seria
        // removido do app do celular — o oposto do que a recepção precisa.
        // Por isso o estado real vem da Meta antes de qualquer ação destrutiva.
        let numberOnBizApp = false;
        let statusCheckOk = false;
        try {
          const stRes = await fetch(
            `https://graph.facebook.com/${COEX_API_VERSION}/${encodeURIComponent(phone_number_id)}?fields=is_on_biz_app,platform_type&access_token=${encodeURIComponent(access_token)}`,
          );
          const stJson: any = await stRes.json().catch(() => ({}));
          if (stRes.ok) {
            statusCheckOk = true;
            numberOnBizApp = stJson?.is_on_biz_app === true;
            console.log(`[wa-oauth-callback] ${phone_number_id} is_on_biz_app=${numberOnBizApp} platform_type=${stJson?.platform_type ?? "?"}`);
          } else {
            console.warn(`[wa-oauth-callback] status check failed for ${phone_number_id}:`, stJson);
          }
        } catch (e) {
          console.warn(`[wa-oauth-callback] status check error for ${phone_number_id}:`, e);
        }
        if (isCoexistence && statusCheckOk && !numberOnBizApp) {
          console.error(`[wa-oauth-callback] ATENÇÃO: pedido coexistência para ${phone_number_id}, mas a Meta reporta is_on_biz_app=false. Tratando como onboarding clássico.`);
        }
        // Coexistência REAL (confirmada pela Meta) manda pular o /register: o
        // número já está registrado pelo app e registrar de novo o derruba.
        // Se a CONSULTA falhou e o pedido era coexistência, NÃO registrar: um
        // /register indevido derruba o número do app do celular. A conexão fica
        // marcada como pendente de verificação.
        const pendenteVerificacao = isCoexistence && !statusCheckOk;
        const skipRegister = numberOnBizApp || pendenteVerificacao;

        // Register (best-effort).
        if (skipRegister) {
          console.log(`[wa-oauth-callback] pulando /register de ${phone_number_id} (onBizApp=${numberOnBizApp} pendente=${pendenteVerificacao})`);
        } else
        try {
          const regRes = await fetch(
            `https://graph.facebook.com/${API_VERSION}/${encodeURIComponent(phone_number_id)}/register`,
            {
              method: "POST",
              headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
              body: JSON.stringify({ messaging_product: "whatsapp", pin: "000000" }),
            },
          );
          if (!regRes.ok) {
            const t = await regRes.text().catch(() => "");
            console.warn(`[wa-oauth-callback] register failed for ${phone_number_id}:`, regRes.status, t);
          }
        } catch (e) {
          console.warn(`[wa-oauth-callback] register error for ${phone_number_id}:`, e);
        }

        // Upsert em integrations (não sobrescreve entradas manuais — key distinta)
        const key = `whatsapp_es_${phone_number_id}`;
        const config = {
          access_token,
          token: access_token,
          phone_number_id,
          waba_id,
          app_id: appId,
          api_version: API_VERSION,
          display_name,
          ...(tenantVerifyToken ? { webhook_verify_token: tenantVerifyToken } : {}),
          // A Meta não confirmou is_on_biz_app: o /register foi pulado por
          // segurança e a coexistência precisa ser verificada manualmente.
          ...(pendenteVerificacao ? { coexistence_pending_verification: true } : {}),
          source: "embedded_signup",
        };

        const { data: existing } = await supabase
          .from("integrations")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("key", key)
          .maybeSingle();

        if (existing?.id) {
          const { error: updErr } = await supabase
            .from("integrations")
            .update({ config, status: "connected", updated_at: new Date().toISOString() })
            .eq("id", existing.id);
          if (updErr) console.error("[wa-oauth-callback] update failed", updErr);
          else connected += 1;
        } else {
          const { error: insErr } = await supabase
            .from("integrations")
            .insert({ tenant_id: tenantId, key, config, status: "connected" });
          if (insErr) console.error("[wa-oauth-callback] insert failed", insErr);
          else connected += 1;
        }

        // Cadastra o número em whatsapp_numbers — chave da visibilidade por
        // unidade (permissão por número). SÓ no fluxo de coexistência: no fluxo
        // clássico, popular essa tabela ativaria o resolvedor de "número padrão"
        // do whatsapp-call-signaling (que hoje cai em integrations) e poderia
        // trocar o número de origem das ligações dos tenants existentes.
        // Best-effort: falha aqui não invalida a conexão já gravada.
        if (numberOnBizApp) {
          try {
            const { data: existingNum } = await supabase
              .from("whatsapp_numbers")
              .select("id, tenant_id")
              .eq("phone_number_id", phone_number_id)
              .maybeSingle();
            const numRow = {
              tenant_id: tenantId,
              phone_number_id,
              display_name,
              phone_e164: num.display_phone_number ?? null,
              waba_id,
              token: access_token,
              app_id: appId,
              ...(tenantVerifyToken ? { verify_token: tenantVerifyToken } : {}),
              is_active: true,
              is_coexistence: true,
            };
            if (existingNum?.id) {
              // phone_number_id é UNIQUE GLOBAL: se a linha pertence a outro
              // tenant, não sequestrar — só logar.
              if (existingNum.tenant_id && existingNum.tenant_id !== tenantId) {
                console.warn(`[wa-oauth-callback] ${phone_number_id} já cadastrado no tenant ${existingNum.tenant_id}; não sobrescrito.`);
              } else {
                const { error: updNumErr } = await supabase
                  .from("whatsapp_numbers").update(numRow).eq("id", existingNum.id);
                if (updNumErr) console.error(`[wa-oauth-callback] whatsapp_numbers update failed for ${phone_number_id}:`, updNumErr.message);
              }
            } else {
              const { error: insNumErr } = await supabase.from("whatsapp_numbers").insert(numRow);
              if (insNumErr) console.error(`[wa-oauth-callback] whatsapp_numbers insert failed for ${phone_number_id}:`, insNumErr.message);
            }
          } catch (e) {
            console.warn(`[wa-oauth-callback] whatsapp_numbers upsert error for ${phone_number_id}:`, e);
          }
        }
      }
    }

    console.log(`[wa-oauth-callback] connected ${connected} number(s) for tenant ${tenantId}`);
    if (connected === 0) {
      return popupResponse("whatsapp", "error");
    }
    return popupResponse("whatsapp", "connected", connected);
  } catch (err) {
    console.error("[wa-oauth-callback] unexpected error:", err);
    return popupResponse("whatsapp", "error");
  }
});
