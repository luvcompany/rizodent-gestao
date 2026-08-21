// Returns the Meta App info that the current tenant needs to configure in Meta
// Developers (callback URLs + app id). Restrito a crc/gerente/superadmin.
//
// SEGURANÇA: esta função NÃO devolve mais os verify tokens GLOBAIS do ambiente
// (WHATSAPP_VERIFY_TOKEN / INSTAGRAM_VERIFY_TOKEN e variantes _V2) — eles são
// compartilhados entre tenants e vazá-los permitiria a um cliente assinar/
// validar webhooks de outro. Devolvemos apenas o verify token gravado na
// integração DO PRÓPRIO tenant (config.webhook_verify_token), quando existir.

import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveCaller } from "../_shared/authz.ts";

// CORS com a MESMA allowlist do tenant-login (nada de "*" numa rota que devolve
// credenciais de integração).
const ALLOWED_ORIGINS = [
  "https://crclin.com.br",
  "https://www.crclin.com.br",
  "https://app.crclin.com.br",
  "https://rizodent-gestao.lovable.app",
];
const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/[a-z0-9-]+\.lovable\.app$/i,
  /^https:\/\/[a-z0-9-]+\.lovableproject\.com$/i,
  /^https:\/\/[a-z0-9-]+\.lovable\.dev$/i,
];
function buildCors(req: Request) {
  const origin = req.headers.get("origin") || "";
  const isAllowed = ALLOWED_ORIGINS.includes(origin) ||
    ALLOWED_ORIGIN_PATTERNS.some((re) => re.test(origin));
  return {
    "Access-Control-Allow-Origin": isAllowed ? origin : ALLOWED_ORIGINS[0],
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

// Comparação em tempo constante (evita distinguir tokens por timing).
function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Defesa em profundidade: se o token gravado no tenant for (ainda) igual a um
// token GLOBAL do ambiente, não devolvemos nada.
function isGlobalToken(value: string): boolean {
  const globais = [
    Deno.env.get("WHATSAPP_VERIFY_TOKEN") || "",
    Deno.env.get("WHATSAPP_VERIFY_TOKEN_V2") || "",
    Deno.env.get("INSTAGRAM_VERIFY_TOKEN") || "",
    Deno.env.get("INSTAGRAM_VERIFY_TOKEN_V2") || "",
  ];
  return globais.some((g) => safeEqual(value, g));
}

const ALLOWED_ROLES = new Set(["crc", "gerente", "superadmin"]);


Deno.serve(async (req) => {
  const corsHeaders = buildCors(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });


  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const caller = await resolveCaller(req, admin);
  if (!caller.ok) return json({ error: caller.error }, caller.status);
  if (caller.isServiceRole) return json({ error: "forbidden" }, 403);

  // Somente papéis administrativos do tenant veem as credenciais de integração.
  const { data: roleRows } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", caller.userId);
  const hasRole = (roleRows || []).some((r: any) => ALLOWED_ROLES.has(String(r.role)));
  if (!hasRole) return json({ error: "forbidden" }, 403);

  const tenantId = caller.tenantId;
  if (!tenantId) return json({ error: "no_tenant" }, 400);

  const { data: tenant } = await admin
    .from("tenants")
    .select("slug, meta_app_version")
    .eq("id", tenantId)
    .maybeSingle();
  const slug = (tenant as any)?.slug || null;
  const version: "v1" | "v2" = ((tenant as any)?.meta_app_version === "v1") ? "v1" : "v2";

  const base = SUPABASE_URL.replace(/\/+$/, "");
  // v2 tenants share a SINGLE global callback URL ("/crclin") configured once
  // in the shared Meta developer app. Tenant routing is resolved from the
  // webhook payload (phone_number_id / ig_user_id). v1 (Rizodent legacy) keeps
  // the bare URL with no suffix.
  const suffix = version === "v2" ? "/crclin" : "";

  // Verify token do PRÓPRIO tenant (nunca o global do ambiente).
  const { data: integrations } = await admin
    .from("integrations")
    .select("key, config")
    .eq("tenant_id", tenantId);
  const ownVerifyToken = (key: string): string => {
    for (const i of integrations || []) {
      if (!String((i as any).key || "").startsWith(key)) continue;
      const t = ((i as any).config || {})?.webhook_verify_token;
      if (t) return String(t);
    }
    return "";
  };

  const payload = {
    tenant_id: tenantId,
    tenant_slug: slug,
    meta_app_version: version,
    whatsapp: {
      callback_url: `${base}/functions/v1/whatsapp-webhook${suffix}`,
      verify_token: ownVerifyToken("whatsapp"),
    },
    instagram: {
      callback_url: `${base}/functions/v1/instagram-lite-webhook${suffix}`,
      oauth_redirect_uri: version === "v2"
        ? (Deno.env.get("INSTAGRAM_REDIRECT_URI_V2") || `${base}/functions/v1/instagram-oauth-callback`)
        : (Deno.env.get("INSTAGRAM_REDIRECT_URI") || `${base}/functions/v1/instagram-oauth-callback${suffix}`),
      verify_token: ownVerifyToken("instagram"),
      app_id: version === "v2"
        ? Deno.env.get("META_APP_ID_V2") || ""
        : Deno.env.get("META_APP_ID") || "",
      config_id: version === "v2"
        ? Deno.env.get("META_CONFIG_ID_V2") || ""
        : Deno.env.get("META_CONFIG_ID") || "",
    },
  };

  return json(payload);
});
