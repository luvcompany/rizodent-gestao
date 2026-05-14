// Shared helper to resolve Meta credentials per tenant with safe fallback.
//
// Architecture (NEW):
//   - Tenant `meta_app_version = 'v1'` → uses LEGACY env vars (Rizodent only).
//     Behavior identical to before this refactor.
//   - Tenant `meta_app_version = 'v2'` (default for all new clients) → uses the
//     SHARED "developer" Meta App env vars (META_APP_ID_V2, …). Per-tenant
//     row in `tenant_meta_credentials` only holds account-level data
//     (System User token, phone_number_id, waba_id) and the enabled toggle.
//
// Resolution order for the tenant:
//   1. Path slug:    /functions/v1/<fn-name>/<tenant-slug>
//   2. Payload hint: WhatsApp phone_number_id
//   3. Explicit:     opts.tenantId
//   4. Fallback:     legacy `integrations` table (kept for legacy WA setups)
//   5. Fallback:     global env (acts as v1 / Rizodent default)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);

export interface WhatsAppCreds {
  source: "tmc-v2" | "tmc-v1" | "integrations" | "env";
  tenant_id: string | null;
  app_version: "v1" | "v2";
  app_id: string;
  app_secret: string;
  token: string;
  phone_number_id: string;
  waba_id: string;
  verify_token: string;
}

export interface InstagramCreds {
  source: "tmc-v2" | "tmc-v1" | "env";
  tenant_id: string | null;
  app_version: "v1" | "v2";
  meta_app_id: string;
  meta_app_secret: string;
  instagram_app_secret: string;
  verify_token: string;
  redirect_uri: string;
}

const TTL_MS = 60_000;
type CacheEntry<T> = { value: T; expires: number };
const wabaCache = new Map<string, CacheEntry<WhatsAppCreds>>();
const igCache = new Map<string, CacheEntry<InstagramCreds>>();
const versionCache = new Map<string, CacheEntry<"v1" | "v2">>();

// ---------- env helpers ----------

function envWhatsAppV1(): WhatsAppCreds {
  return {
    source: "env",
    tenant_id: null,
    app_version: "v1",
    app_id: Deno.env.get("META_APP_ID") ?? "",
    app_secret: Deno.env.get("WHATSAPP_APP_SECRET") ?? Deno.env.get("META_APP_SECRET") ?? "",
    token: Deno.env.get("WHATSAPP_TOKEN") ?? "",
    phone_number_id: Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "",
    waba_id: Deno.env.get("WABA_ID") ?? "",
    verify_token: Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "",
  };
}

function envInstagramV1(): InstagramCreds {
  return {
    source: "env",
    tenant_id: null,
    app_version: "v1",
    meta_app_id: Deno.env.get("META_APP_ID") ?? "",
    meta_app_secret: Deno.env.get("META_APP_SECRET") ?? "",
    instagram_app_secret: Deno.env.get("INSTAGRAM_APP_SECRET") ?? Deno.env.get("META_APP_SECRET") ?? "",
    verify_token: Deno.env.get("INSTAGRAM_VERIFY_TOKEN") ?? Deno.env.get("INSTAGRAM_LITE_VERIFY_TOKEN") ?? "",
    redirect_uri: Deno.env.get("INSTAGRAM_REDIRECT_URI") ?? "",
  };
}

/** App-level credentials for the shared "developer" app. Token + phone_number_id come from the tenant row. */
function envWhatsAppV2Base(): Pick<WhatsAppCreds, "app_id" | "app_secret" | "verify_token"> {
  return {
    app_id: Deno.env.get("META_APP_ID_V2") ?? "",
    app_secret: Deno.env.get("META_APP_SECRET_V2") ?? "",
    verify_token: Deno.env.get("WHATSAPP_VERIFY_TOKEN_V2") ?? "",
  };
}

function envInstagramV2(): InstagramCreds {
  return {
    source: "tmc-v2",
    tenant_id: null,
    app_version: "v2",
    meta_app_id: Deno.env.get("META_APP_ID_V2") ?? "",
    meta_app_secret: Deno.env.get("META_APP_SECRET_V2") ?? "",
    instagram_app_secret: Deno.env.get("META_APP_SECRET_V2") ?? "",
    verify_token: Deno.env.get("INSTAGRAM_VERIFY_TOKEN_V2") ?? "",
    redirect_uri: Deno.env.get("INSTAGRAM_REDIRECT_URI_V2") ?? "",
  };
}

// ---------- tenant lookups ----------

export function extractSlugFromUrl(req: Request, fnName: string): string | null {
  try {
    const path = new URL(req.url).pathname.replace(/\/+$/, "");
    const parts = path.split("/").filter(Boolean);
    const idx = parts.indexOf(fnName);
    if (idx >= 0 && idx < parts.length - 1) {
      const slug = parts[idx + 1];
      if (slug && slug.length > 0 && slug !== "v1") return slug;
    }
    return null;
  } catch {
    return null;
  }
}

async function tenantIdFromSlug(slug: string): Promise<string | null> {
  const { data } = await adminClient.rpc("get_tenant_by_slug", { _slug: slug });
  const row = Array.isArray(data) ? data[0] : data;
  return row?.id ?? null;
}

async function tenantIdFromPhoneNumberId(phoneNumberId: string): Promise<string | null> {
  const { data } = await adminClient.rpc("get_tenant_by_whatsapp_phone_number_id", {
    _phone_number_id: phoneNumberId,
  });
  if (typeof data === "string") return data;
  return null;
}

async function getTenantAppVersion(tenantId: string): Promise<"v1" | "v2"> {
  const cached = versionCache.get(tenantId);
  if (cached && cached.expires > Date.now()) return cached.value;
  const { data } = await adminClient
    .from("tenants")
    .select("meta_app_version")
    .eq("id", tenantId)
    .maybeSingle();
  const v: "v1" | "v2" = ((data as any)?.meta_app_version === "v1") ? "v1" : "v2";
  versionCache.set(tenantId, { value: v, expires: Date.now() + TTL_MS });
  return v;
}

// ---------- per-tenant DB reads ----------

async function readTmcWhatsAppV2(tenantId: string): Promise<WhatsAppCreds | null> {
  const { data } = await adminClient
    .from("tenant_meta_credentials")
    .select("whatsapp_token, whatsapp_phone_number_id, whatsapp_waba_id, whatsapp_enabled")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data || !data.whatsapp_enabled) return null;
  if (!data.whatsapp_token || !data.whatsapp_phone_number_id) return null;
  const base = envWhatsAppV2Base();
  return {
    source: "tmc-v2",
    tenant_id: tenantId,
    app_version: "v2",
    app_id: base.app_id,
    app_secret: base.app_secret,
    token: data.whatsapp_token,
    phone_number_id: data.whatsapp_phone_number_id,
    waba_id: data.whatsapp_waba_id || "",
    verify_token: base.verify_token,
  };
}

async function readLegacyIntegrationByPhoneId(phoneNumberId: string): Promise<WhatsAppCreds | null> {
  const { data } = await adminClient
    .from("integrations")
    .select("config, status, tenant_id")
    .like("key", "whatsapp_%");
  const match = (data || []).find((i: any) => (i.config || {}).phone_number_id === phoneNumberId);
  if (!match || match.status === "disabled") return null;
  const cfg = (match.config || {}) as Record<string, string>;
  if (!cfg.token) return null;
  return {
    source: "integrations",
    tenant_id: match.tenant_id ?? null,
    app_version: "v1",
    app_id: cfg.app_id || Deno.env.get("META_APP_ID") || "",
    app_secret: Deno.env.get("WHATSAPP_APP_SECRET") ?? Deno.env.get("META_APP_SECRET") ?? "",
    token: cfg.token,
    phone_number_id: cfg.phone_number_id,
    waba_id: cfg.waba_id || "",
    verify_token: cfg.webhook_verify_token || Deno.env.get("WHATSAPP_VERIFY_TOKEN") || "",
  };
}

// ---------- public resolvers ----------

export async function resolveWhatsAppCreds(opts: {
  req?: Request;
  fnName?: string;
  phoneNumberId?: string | null;
  tenantId?: string | null;
}): Promise<WhatsAppCreds> {
  let tenantId = opts.tenantId ?? null;

  if (!tenantId && opts.req && opts.fnName) {
    const slug = extractSlugFromUrl(opts.req, opts.fnName);
    if (slug) tenantId = await tenantIdFromSlug(slug);
  }
  if (!tenantId && opts.phoneNumberId) {
    tenantId = await tenantIdFromPhoneNumberId(opts.phoneNumberId);
  }

  if (tenantId) {
    const cached = wabaCache.get(tenantId);
    if (cached && cached.expires > Date.now()) return cached.value;

    const version = await getTenantAppVersion(tenantId);
    if (version === "v2") {
      const tmc = await readTmcWhatsAppV2(tenantId);
      if (tmc) {
        wabaCache.set(tenantId, { value: tmc, expires: Date.now() + TTL_MS });
        return tmc;
      }
      // v2 tenant but no row yet → still return env-v2 base (token blank) so callers fail with a clear error.
      // Do NOT silently fall back to Rizodent (v1) creds — that would cross tenants.
      const base = envWhatsAppV2Base();
      return {
        source: "tmc-v2",
        tenant_id: tenantId,
        app_version: "v2",
        app_id: base.app_id,
        app_secret: base.app_secret,
        token: "",
        phone_number_id: "",
        waba_id: "",
        verify_token: base.verify_token,
      };
    }
    // v1 tenant → use legacy env (Rizodent)
    const v1 = envWhatsAppV1();
    return { ...v1, tenant_id: tenantId, source: "tmc-v1" };
  }

  // No tenant resolved → try legacy integrations match by phone_number_id, else env v1.
  if (opts.phoneNumberId) {
    const legacy = await readLegacyIntegrationByPhoneId(opts.phoneNumberId);
    if (legacy) return legacy;
  }
  return envWhatsAppV1();
}

export async function resolveInstagramCreds(opts: {
  req?: Request;
  fnName?: string;
  tenantId?: string | null;
}): Promise<InstagramCreds> {
  let tenantId = opts.tenantId ?? null;

  if (!tenantId && opts.req && opts.fnName) {
    const slug = extractSlugFromUrl(opts.req, opts.fnName);
    if (slug) tenantId = await tenantIdFromSlug(slug);
  }

  if (tenantId) {
    const cached = igCache.get(tenantId);
    if (cached && cached.expires > Date.now()) return cached.value;

    const version = await getTenantAppVersion(tenantId);
    const value = version === "v2"
      ? { ...envInstagramV2(), tenant_id: tenantId }
      : { ...envInstagramV1(), tenant_id: tenantId, source: "tmc-v1" as const };
    igCache.set(tenantId, { value, expires: Date.now() + TTL_MS });
    return value;
  }

  return envInstagramV1();
}

/** Constant-time string comparison for verify tokens. */
export function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

/**
 * Returns true if the given token matches EITHER the v1 (Rizodent) or v2
 * (shared developer app) verify token for this channel. Used by webhooks.
 */
export function verifyTokenAcceptsBoth(channel: "whatsapp" | "instagram", incoming: string): boolean {
  if (!incoming) return false;
  if (channel === "whatsapp") {
    const v1 = Deno.env.get("WHATSAPP_VERIFY_TOKEN") || "";
    const v2 = Deno.env.get("WHATSAPP_VERIFY_TOKEN_V2") || "";
    return safeEqual(incoming, v1) || safeEqual(incoming, v2);
  }
  const v1 = Deno.env.get("INSTAGRAM_VERIFY_TOKEN") || Deno.env.get("INSTAGRAM_LITE_VERIFY_TOKEN") || "";
  const v2 = Deno.env.get("INSTAGRAM_VERIFY_TOKEN_V2") || "";
  return safeEqual(incoming, v1) || safeEqual(incoming, v2);
}

/** Build the public webhook URL a tenant should paste into Meta. */
export function buildWebhookUrl(fnName: string, slug: string): string {
  const base = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
  return `${base}/functions/v1/${fnName}/${slug}`;
}
