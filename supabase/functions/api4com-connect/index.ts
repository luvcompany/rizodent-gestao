// @ts-nocheck
// Conecta a conta Api4Com de UMA clínica (tenant): faz login (email+senha),
// obtém um token permanente, registra o webhook e guarda tudo no servidor.
// O token NUNCA é devolvido ao frontend.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const API4COM_BASE = "https://api.api4com.com/api/v1";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Gateway curto e seguro (o UUID inteiro pode estourar limites de coluna na Api4Com).
// A conta é dedicada à clínica, então um id curto por tenant basta.
function safeGateway(tenantId: string) {
  return "crclin-" + String(tenantId).replace(/-/g, "").slice(0, 12);
}

// Registra (upsert) a integração de webhook na Api4Com. Auth: token PURO no header
// Authorization (sem "Bearer"), conforme a doc do Webphone. IMPORTANTE: NÃO usamos
// webhookConstraint — a conta é dedicada à clínica, então queremos TODAS as chamadas
// (inclusive as feitas pela extensão, que não carregam nosso gateway no metadata).
// Como a API deles às vezes responde 500 a formatos que não espera, tentamos algumas
// variações de corpo e ficamos com a primeira que der certo.
async function registerWebhook(apiToken: string, supaUrl: string, tenantId: string, webhookSecret: string) {
  const gateway = safeGateway(tenantId);
  const webhookUrl = `${supaUrl}/functions/v1/api4com-webhook?secret=${webhookSecret}&gw=${encodeURIComponent(gateway)}`;
  const meta = { webhookUrl, webhookVersion: "1.8", webhookTypes: ["channel-answer", "channel-hangup"] };

  const variants: any[] = [
    { gateway, webhook: true, metadata: meta },
    { gateway, webhook: true, metadata: { ...meta, api_token: webhookSecret } },
    { id: 0, gateway, webhook: true, metadata: { ...meta, api_token: webhookSecret } },
    { gateway, webhook: true, metadata: JSON.stringify({ ...meta, api_token: webhookSecret }) },
  ];

  const errors: string[] = [];
  for (let i = 0; i < variants.length; i++) {
    try {
      const res = await fetch(`${API4COM_BASE}/integrations`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: apiToken },
        body: JSON.stringify(variants[i]),
      });
      if (res.ok) return { ok: true, status: res.status, detail: null as string | null, gateway };
      const body = await res.text().catch(() => "");
      errors.push(`v${i}: HTTP ${res.status}: ${body.slice(0, 220)}`);
    } catch (e: any) {
      errors.push(`v${i}: fetch error: ${String(e?.message ?? e).slice(0, 220)}`);
    }
  }
  return { ok: false, status: 0, detail: errors.join(" | ").slice(0, 900), gateway };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
    const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const jwt = auth.slice(7);

    const userClient = createClient(SUPA_URL, ANON, { global: { headers: { Authorization: auth } } });
    const { data: claims, error: claimsErr } = await userClient.auth.getClaims(jwt);
    if (claimsErr || !claims?.claims) return json({ error: "Unauthorized" }, 401);
    const uid = claims.claims.sub as string;

    const admin = createClient(SUPA_URL, SR);
    const { data: prof } = await admin.from("profiles").select("tenant_id").eq("id", uid).maybeSingle();
    const tenantId = prof?.tenant_id;
    if (!tenantId) return json({ error: "Usuário sem clínica." }, 403);
    // Só admin da clínica pode conectar a telefonia.
    const { data: roleRow } = await admin.from("user_roles").select("role").eq("user_id", uid)
      .in("role", ["gerente", "crc", "superadmin"]).maybeSingle();
    if (!roleRow) return json({ error: "Sem permissão para configurar a telefonia." }, 403);

    const body = await req.json().catch(() => ({}));
    const action = body.action || "status";

    if (action === "status") {
      const { data: cfg } = await admin.from("api4com_config")
        .select("account_email, connected_at, webhook_registered, webhook_last_error").eq("tenant_id", tenantId).maybeSingle();
      return json({
        connected: !!cfg?.connected_at,
        email: cfg?.account_email ?? null,
        webhook_registered: !!cfg?.webhook_registered,
        webhook_error: cfg?.webhook_last_error ?? null,
      });
    }

    if (action === "disconnect") {
      await admin.from("api4com_config").delete().eq("tenant_id", tenantId);
      return json({ ok: true, connected: false });
    }

    // Reprocessa o registro do webhook usando o token JÁ guardado (sem pedir a senha).
    if (action === "register_webhook") {
      const { data: cfg } = await admin.from("api4com_config")
        .select("api_token, gateway, webhook_secret").eq("tenant_id", tenantId).maybeSingle();
      if (!cfg?.api_token) return json({ error: "Conecte a conta Api4Com primeiro." }, 400);
      const webhookSecret = cfg.webhook_secret || crypto.randomUUID().replace(/-/g, "");
      const wh = await registerWebhook(cfg.api_token, SUPA_URL, tenantId, webhookSecret);
      await admin.from("api4com_config").update({
        gateway: wh.gateway, webhook_secret: webhookSecret,
        webhook_registered: wh.ok, webhook_last_error: wh.detail,
        updated_at: new Date().toISOString(),
      }).eq("tenant_id", tenantId);
      if (!wh.ok) return json({ ok: false, webhook_registered: false, error: wh.detail || "Falha ao registrar o webhook." }, 200);
      return json({ ok: true, webhook_registered: true });
    }

    if (action === "connect") {
      const email = String(body.email || "").trim();
      const password = String(body.password || "");
      if (!email || !password) return json({ error: "Informe o e-mail e a senha da sua conta Api4Com." }, 400);

      // 1) Login → token
      const loginRes = await fetch(`${API4COM_BASE}/users/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const loginData = await loginRes.json().catch(() => ({}));
      if (!loginRes.ok || !loginData?.id) {
        return json({ error: "Login na Api4Com falhou. Confira e-mail e senha. (" + (loginData?.error?.message || loginRes.status) + ")" }, 400);
      }
      let apiToken: string = loginData.id;

      // 2) Token permanente (ttl -1) — best effort; se falhar, usa o token do login.
      try {
        const permRes = await fetch(`${API4COM_BASE}/users/accessTokens`, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: apiToken },
          body: JSON.stringify({ ttl: -1 }),
        });
        const permData = await permRes.json().catch(() => ({}));
        if (permRes.ok && permData?.id) apiToken = permData.id;
      } catch (_) { /* mantém o token do login */ }

      // 3) Segredo do webhook (o gateway é definido dentro de registerWebhook)
      const webhookSecret = crypto.randomUUID().replace(/-/g, "");

      // 4) Registrar webhook (captura o motivo em caso de falha)
      const wh = await registerWebhook(apiToken, SUPA_URL, tenantId, webhookSecret);

      // 5) Salvar config (token só no servidor)
      const { error: upErr } = await admin.from("api4com_config").upsert({
        tenant_id: tenantId, account_email: email, api_token: apiToken,
        gateway: wh.gateway, webhook_secret: webhookSecret,
        webhook_registered: wh.ok, webhook_last_error: wh.detail,
        connected_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }, { onConflict: "tenant_id" });
      if (upErr) return json({ error: "Falha ao salvar a configuração: " + upErr.message }, 500);

      return json({ ok: true, connected: true, webhook_registered: wh.ok, webhook_error: wh.detail });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (e: any) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
