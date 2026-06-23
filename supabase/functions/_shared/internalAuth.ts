// Shared auth helpers for internal/service-only edge functions.
// Replaces the previous hardcoded CRON_TOKEN and anon-key bypass.
//
// Allowed callers:
//  - pg_cron jobs: send `x-cron-secret: <token>` where the token lives in
//    public._internal_secrets and is fetched via the RPC verify_internal_secret.
//  - Internal function-to-function calls: send `Authorization: Bearer <SERVICE_ROLE_KEY>`.
//  - (optionally for bot-engine) Logged-in users: a valid Supabase user JWT.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

type AuthOpts = {
  /** Name of the secret in public._internal_secrets to validate against the x-cron-secret header. */
  cronSecretName?: string;
  /** If true, accept a valid Supabase user JWT in the Authorization header. */
  allowUserJwt?: boolean;
};

export type InternalAuthResult =
  | { ok: true; via: "service_role" | "cron" | "user_jwt"; userId?: string }
  | { ok: false; reason: string };

/**
 * Authorize an internal edge-function call.
 * Pass a service-role Supabase client (created with SUPABASE_SERVICE_ROLE_KEY).
 */
export async function authorizeInternal(
  req: Request,
  supabase: SupabaseClient,
  opts: AuthOpts = {},
): Promise<InternalAuthResult> {
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const cronHeader = req.headers.get("x-cron-secret") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  // 1. Service-role bearer (internal function-to-function calls)
  if (serviceKey && bearer && bearer === serviceKey) {
    return { ok: true, via: "service_role" };
  }

  // 2. Cron secret (pg_cron). Validated against public._internal_secrets via RPC.
  if (cronHeader && opts.cronSecretName) {
    try {
      const { data, error } = await supabase.rpc("verify_internal_secret", {
        _name: opts.cronSecretName,
        _token: cronHeader,
      });
      if (!error && data === true) {
        return { ok: true, via: "cron" };
      }
    } catch (_) {
      // fall through to user JWT or reject
    }
  }

  // 3. Optional: accept a valid Supabase user JWT (for endpoints that the frontend hits directly).
  if (opts.allowUserJwt && bearer) {
    try {
      const { data, error } = await supabase.auth.getClaims(bearer);
      if (!error && data?.claims?.sub) {
        return { ok: true, via: "user_jwt", userId: String(data.claims.sub) };
      }
    } catch (_) {
      // ignore — treat as unauthorized
    }
  }

  return { ok: false, reason: "Unauthorized" };
}

export function unauthorizedResponse(corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
