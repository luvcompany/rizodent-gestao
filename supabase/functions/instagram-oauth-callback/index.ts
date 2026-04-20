import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const META_APP_ID = Deno.env.get("META_APP_ID") ?? "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const REDIRECT_URI = Deno.env.get("INSTAGRAM_REDIRECT_URI") ?? "";
const FRONTEND_URL = (Deno.env.get("FRONTEND_URL") ?? "").replace(/\/+$/, "");

const supabase = createClient(supabaseUrl, serviceRoleKey);

function frontendBase(_req: Request): string {
  return FRONTEND_URL;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");
  const base = frontendBase(req) || (state && state.startsWith("http") ? "" : "");

  if (errorParam) {
    console.error("[instagram-oauth-callback] error from Meta:", errorParam, url.searchParams.get("error_description"));
    return Response.redirect(`${base}/crm/integracoes?instagram=error`, 302);
  }
  if (!code) {
    return new Response(JSON.stringify({ error: "Missing 'code' query parameter" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!META_APP_ID || !META_APP_SECRET || !REDIRECT_URI) {
    console.error("[instagram-oauth-callback] Missing META secrets");
    return new Response(JSON.stringify({ error: "Server not configured (missing META secrets)" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // 1) Short-lived token
    const stUrl = new URL("https://graph.facebook.com/v25.0/oauth/access_token");
    stUrl.searchParams.set("client_id", META_APP_ID);
    stUrl.searchParams.set("client_secret", META_APP_SECRET);
    stUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    stUrl.searchParams.set("code", code);

    const stRes = await fetch(stUrl.toString());
    const stJson = await stRes.json();
    if (!stRes.ok || !stJson?.access_token) {
      console.error("[instagram-oauth-callback] short-lived token error:", stJson);
      return Response.redirect(`${base}/crm/integracoes?instagram=error`, 302);
    }
    const shortToken: string = stJson.access_token;

    // 2) Long-lived token (60 days)
    const llUrl = new URL("https://graph.facebook.com/v25.0/oauth/access_token");
    llUrl.searchParams.set("grant_type", "fb_exchange_token");
    llUrl.searchParams.set("client_id", META_APP_ID);
    llUrl.searchParams.set("client_secret", META_APP_SECRET);
    llUrl.searchParams.set("fb_exchange_token", shortToken);

    const llRes = await fetch(llUrl.toString());
    const llJson = await llRes.json();
    if (!llRes.ok || !llJson?.access_token) {
      console.error("[instagram-oauth-callback] long-lived token error:", llJson);
      return Response.redirect(`${base}/crm/integracoes?instagram=error`, 302);
    }
    const longToken: string = llJson.access_token;
    const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();

    // 3) Fetch Pages
    const pagesRes = await fetch(
      `https://graph.facebook.com/v25.0/me/accounts?access_token=${encodeURIComponent(longToken)}`,
    );
    const pagesJson = await pagesRes.json();
    if (!pagesRes.ok) {
      console.error("[instagram-oauth-callback] me/accounts error:", pagesJson);
      return Response.redirect(`${base}/crm/integracoes?instagram=error`, 302);
    }

    const pages: Array<{ id: string; name: string; access_token: string }> = pagesJson?.data ?? [];
    let connected = 0;

    for (const page of pages) {
      const igRes = await fetch(
        `https://graph.facebook.com/v25.0/${page.id}?fields=instagram_business_account&access_token=${encodeURIComponent(page.access_token)}`,
      );
      const igJson = await igRes.json();
      const igId: string | undefined = igJson?.instagram_business_account?.id;
      if (!igId) continue;

      const { error: upErr } = await supabase
        .from("instagram_accounts")
        .upsert(
          {
            name: page.name,
            instagram_account_id: igId,
            page_id: page.id,
            page_access_token: page.access_token,
            long_lived_token_expires_at: expiresAt,
            is_active: true,
          },
          { onConflict: "instagram_account_id" },
        );
      if (upErr) {
        console.error("[instagram-oauth-callback] upsert error:", upErr);
      } else {
        connected += 1;
      }
    }

    console.log(`[instagram-oauth-callback] connected ${connected} account(s)`);
    return Response.redirect(`${base}/crm/integracoes?instagram=connected&count=${connected}`, 302);
  } catch (err) {
    console.error("[instagram-oauth-callback] unexpected error:", err);
    return Response.redirect(`${base}/crm/integracoes?instagram=error`, 302);
  }
});
