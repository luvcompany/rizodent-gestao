// Shared helper to resolve Meta credentials per tenant with safe fallback.
//
// Resolution order:
//   1. Path slug:    /functions/v1/<fn-name>/<tenant-slug>
//   2. Payload hint: WhatsApp phone_number_id, IG account id (caller passes it)
//   3. DB row:       tenant_meta_credentials (per tenant)
//   4. Fallback:     legacy `integrations` table (existing per-tenant WhatsApp setup)
//   5. Fallback:     global Deno.env (current Rizodent behavior — never breaks)
//
// All edge functions can adopt this incrementally. Until a tenant has a row in
// tenant_meta_credentials with the matching channel enabled, behavior is
// identical to today.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);

export interface WhatsAppCreds {
  source: "tmc" | "integrations" | "env";
  tenant_id: string | null;
  app_id: string;
  app_secret: string;
  token: string;
  phone_number_id: string;
  waba_id: string;
  verify_token: string;
}

export interface InstagramCreds {
  source: "tmc" | "env";
  tenant_id: string | null;
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

function envWhatsApp(): WhatsAppCreds {
  return {
    source: "env",
    tenant_id: null,
    app_id: Deno.env.get("META_APP_ID") ?? "",
    app_secret: Deno.env.get("WHATSAPP_APP_SECRET") ?? Deno.env.get("META_APP_SECRET") ?? "",
    token: Deno.env.get("WHATSAPP_TOKEN") ?? "",
    phone_number_id: Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "",
    waba_id: Deno.env.get("WABA_ID") ?? "",
    verify_token: Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "",
  };
}

function envInstagram(): InstagramCreds {
  return {
    source: "env",
    tenant_id: null,
    meta_app_id: Deno.env.get("META_APP_ID") ?? "",
    meta_app_secret: Deno.env.get("META_APP_SECRET") ?? "",
    instagram_app_secret: Deno.env.get("INSTAGRAM_APP_SECRET") ?? Deno.env.get("META_APP_SECRET") ?? "",
    verify_token: Deno.env.get("INSTAGRAM_VERIFY_TOKEN") ?? Deno.env.get("INSTAGRAM_LITE_VERIFY_TOKEN") ?? "",
    redirect_uri: Deno.env.get("INSTAGRAM_REDIRECT_URI") ?? "",
  };
}

/** Extract tenant slug from request URL: /functions/v1/<fn>/<slug> */
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

async function readTmcWhatsApp(tenantId: string): Promise<WhatsAppCreds | null> {
  const { data, error } = await adminClient
    .from("tenant_meta_credentials")
    .select("whatsapp_app_id, whatsapp_app_secret, whatsapp_token, whatsapp_phone_number_id, whatsapp_waba_id, whatsapp_verify_token, whatsapp_enabled, meta_app_id, meta_app_secret")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error || !data || !data.whatsapp_enabled) return null;
  if (!data.whatsapp_token || !data.whatsapp_phone_number_id) return null;
  return {
    source: "tmc",
    tenant_id: tenantId,
    app_id: data.whatsapp_app_id || data.meta_app_id || "",
    app_secret: data.whatsapp_app_secret || data.meta_app_secret || "",
    token: data.whatsapp_token,
    phone_number_id: data.whatsapp_phone_number_id,
    waba_id: data.whatsapp_waba_id || "",
    verify_token: data.whatsapp_verify_token || "",
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
    app_id: cfg.app_id || Deno.env.get("META_APP_ID") || "",
    app_secret: Deno.env.get("WHATSAPP_APP_SECRET") ?? Deno.env.get("META_APP_SECRET") ?? "",
    token: cfg.token,
    phone_number_id: cfg.phone_number_id,
    waba_id: cfg.waba_id || "",
    verify_token: cfg.webhook_verify_token || Deno.env.get("WHATSAPP_VERIFY_TOKEN") || "",
  };
}

async function readTmcInstagram(tenantId: string): Promise<InstagramCreds | null> {
  const { data, error } = await adminClient
    .from("tenant_meta_credentials")
    .select("meta_app_id, meta_app_secret, instagram_app_secret, instagram_verify_token, instagram_redirect_uri, instagram_enabled")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error || !data || !data.instagram_enabled) return null;
  if (!data.meta_app_id || !data.meta_app_secret) return null;
  return {
    source: "tmc",
    tenant_id: tenantId,
    meta_app_id: data.meta_app_id,
    meta_app_secret: data.meta_app_secret,
    instagram_app_secret: data.instagram_app_secret || data.meta_app_secret,
    verify_token: data.instagram_verify_token || "",
    redirect_uri: data.instagram_redirect_uri || Deno.env.get("INSTAGRAM_REDIRECT_URI") || "",
  };
}

/**
 * Resolve WhatsApp credentials given the request and (optionally) the
 * incoming phone_number_id from the webhook payload. Always succeeds —
 * falls back to env so existing flows never break.
 */
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
    const tmc = await readTmcWhatsApp(tenantId);
    if (tmc) {
      wabaCache.set(tenantId, { value: tmc, expires: Date.now() + TTL_MS });
      return tmc;
    }
  }

  if (opts.phoneNumberId) {
    const legacy = await readLegacyIntegrationByPhoneId(opts.phoneNumberId);
    if (legacy) return legacy;
  }

  return envWhatsApp();
}

/** Same idea for Instagram. */
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
    const tmc = await readTmcInstagram(tenantId);
    if (tmc) {
      igCache.set(tenantId, { value: tmc, expires: Date.now() + TTL_MS });
      return tmc;
    }
  }

  return envInstagram();
}

/** Constant-time string comparison for verify tokens. */
export function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

/** Build the public webhook URL a tenant should paste into Meta. */
export function buildWebhookUrl(fnName: string, slug: string): string {
  const base = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
  return `${base}/functions/v1/${fnName}/${slug}`;
}
