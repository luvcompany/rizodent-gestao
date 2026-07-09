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
const FRONTEND_URL = Deno.env.get("FRONTEND_URL") ?? "https://crclin.com.br";

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
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");
  

  if (errorParam) {
    console.error("[instagram-oauth-callback] error from Meta:", errorParam, url.searchParams.get("error_description"));
    return popupResponse("instagram", "error");
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

  // Valida `state` contra tabela de estados temporários (CSRF + vínculo a tenant)
  if (!state) {
    return new Response(JSON.stringify({ error: "Missing 'state' query parameter" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const { data: stateRow, error: stateErr } = await supabase
    .from("instagram_oauth_states")
    .select("tenant_id, user_id, expires_at")
    .eq("state", state)
    .maybeSingle();
  if (stateErr || !stateRow) {
    console.warn("[instagram-oauth-callback] invalid state:", state, stateErr);
    return new Response(JSON.stringify({ error: "Invalid or expired state" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (new Date(stateRow.expires_at).getTime() < Date.now()) {
    await supabase.from("instagram_oauth_states").delete().eq("state", state);
    return new Response(JSON.stringify({ error: "Expired state" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const tenantId: string = stateRow.tenant_id;
  // Consumir o state (one-shot)
  await supabase.from("instagram_oauth_states").delete().eq("state", state);


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
      return popupResponse("instagram", "error");
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
      return popupResponse("instagram", "error");
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
      return popupResponse("instagram", "error");
    }

    const pages: Array<{ id: string; name: string; access_token: string }> = pagesJson?.data ?? [];
    console.log(`[instagram-oauth-callback] me/accounts returned ${pages.length} page(s):`, JSON.stringify(pages.map((p) => ({ id: p.id, name: p.name }))));

    if (pages.length === 0) {
      console.warn("[instagram-oauth-callback] No Pages returned. User may not have granted page access or has no Pages. Full response:", JSON.stringify(pagesJson));
    }

    let connected = 0;
    const skipped: Array<{ page: string; reason: string }> = [];

    for (const page of pages) {
      const igUrl = `https://graph.facebook.com/v25.0/${page.id}?fields=instagram_business_account{id,username,name,profile_picture_url}&access_token=${encodeURIComponent(page.access_token)}`;
      const igRes = await fetch(igUrl);
      const igJson = await igRes.json();
      console.log(`[instagram-oauth-callback] Page "${page.name}" (${page.id}) IG response:`, JSON.stringify(igJson));

      const igId: string | undefined = igJson?.instagram_business_account?.id;
      if (!igId) {
        const reason = igJson?.error?.message || "no instagram_business_account linked to this Page";
        skipped.push({ page: page.name, reason });
        console.warn(`[instagram-oauth-callback] Skipping page "${page.name}": ${reason}`);
        continue;
      }

      const igName: string = igJson?.instagram_business_account?.username
        || igJson?.instagram_business_account?.name
        || page.name;

      const { error: upErr } = await supabase
        .from("instagram_accounts")
        .upsert(
          {
            name: igName,
            instagram_account_id: igId,
            page_id: page.id,
            page_access_token: page.access_token,
            long_lived_token_expires_at: expiresAt,
            is_active: true,
            tenant_id: tenantId,
          },
          { onConflict: "instagram_account_id" },
        );
      if (upErr) {
        console.error("[instagram-oauth-callback] upsert error:", upErr);
      } else {
        connected += 1;

        // (a) Also register in ig_accounts so the Instagram Lite webhook receives DMs/comments.
        // Use ignoreDuplicates: do NOT overwrite existing rows (preserves working Lite tokens).
        const { error: igAccErr } = await supabase
          .from("ig_accounts")
          .upsert(
            {
              ig_user_id: igId,
              username: igName,
              access_token: page.access_token,
              active: true,
              tenant_id: tenantId,
              token_expires_at: expiresAt,
            },
            { onConflict: "ig_user_id", ignoreDuplicates: true },
          );
        if (igAccErr) {
          console.warn(`[instagram-oauth-callback] ig_accounts upsert warn for ${igId}:`, igAccErr);
        }

        // (b) Subscribe the Page to receive Instagram messaging + comments webhooks.
        try {
          const subUrl = new URL(`https://graph.facebook.com/v25.0/${page.id}/subscribed_apps`);
          subUrl.searchParams.set("access_token", page.access_token);
          subUrl.searchParams.set(
            "subscribed_fields",
            [
              "messages",
              "messaging_postbacks",
              "messaging_seen",
              "message_reactions",
              "instagram_manage_messages",
              "instagram_manage_comments",
              "comments",
              "mentions",
              "feed",
            ].join(","),
          );
          const subRes = await fetch(subUrl.toString(), { method: "POST" });
          const subJson = await subRes.json().catch(() => ({}));
          if (!subRes.ok) {
            console.warn(`[instagram-oauth-callback] subscribed_apps failed for page ${page.id}:`, subJson);
          } else {
            console.log(`[instagram-oauth-callback] subscribed_apps OK for page ${page.id}`);
          }
        } catch (subErr) {
          console.warn(`[instagram-oauth-callback] subscribed_apps error for page ${page.id}:`, subErr);
        }
      }
    }


    console.log(`[instagram-oauth-callback] connected ${connected} account(s), skipped ${skipped.length}`);
    if (skipped.length > 0) {
      console.log(`[instagram-oauth-callback] skipped details:`, JSON.stringify(skipped));
    }

    if (connected === 0) {
      return popupResponse("instagram", "error");
    }
    return popupResponse("instagram", "connected", connected);
  } catch (err) {
    console.error("[instagram-oauth-callback] unexpected error:", err);
    return popupResponse("instagram", "error");
  }
});
