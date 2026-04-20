import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GRAPH = "https://graph.facebook.com/v25.0";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    if (!code) {
      return new Response(JSON.stringify({ error: "Missing code parameter" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const META_APP_ID = Deno.env.get("META_APP_ID")!;
    const META_APP_SECRET = Deno.env.get("META_APP_SECRET")!;
    const INSTAGRAM_REDIRECT_URI = Deno.env.get("INSTAGRAM_REDIRECT_URI")!;

    // 1. Exchange code -> short-lived token
    const shortUrl = new URL(`${GRAPH}/oauth/access_token`);
    shortUrl.searchParams.set("client_id", META_APP_ID);
    shortUrl.searchParams.set("client_secret", META_APP_SECRET);
    shortUrl.searchParams.set("redirect_uri", INSTAGRAM_REDIRECT_URI);
    shortUrl.searchParams.set("code", code);

    const shortResp = await fetch(shortUrl.toString());
    const shortData = await shortResp.json();
    if (!shortResp.ok || !shortData.access_token) {
      console.error("[oauth-callback] short-lived token error", shortData);
      return new Response(JSON.stringify({ error: "Failed short-lived token", details: shortData }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const shortLivedToken = shortData.access_token;

    // 2. Exchange short -> long-lived token (60 days)
    const longUrl = new URL(`${GRAPH}/oauth/access_token`);
    longUrl.searchParams.set("grant_type", "fb_exchange_token");
    longUrl.searchParams.set("client_id", META_APP_ID);
    longUrl.searchParams.set("client_secret", META_APP_SECRET);
    longUrl.searchParams.set("fb_exchange_token", shortLivedToken);

    const longResp = await fetch(longUrl.toString());
    const longData = await longResp.json();
    if (!longResp.ok || !longData.access_token) {
      console.error("[oauth-callback] long-lived token error", longData);
      return new Response(JSON.stringify({ error: "Failed long-lived token", details: longData }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const longLivedToken = longData.access_token;

    // 3. Get Pages
    const pagesResp = await fetch(`${GRAPH}/me/accounts?access_token=${longLivedToken}`);
    const pagesData = await pagesResp.json();
    if (!pagesResp.ok) {
      console.error("[oauth-callback] pages error", pagesData);
      return new Response(JSON.stringify({ error: "Failed to fetch pages", details: pagesData }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
    const upserted: any[] = [];

    for (const page of pagesData.data ?? []) {
      const pageId = page.id;
      const pageName = page.name;
      const pageToken = page.access_token;

      const igResp = await fetch(
        `${GRAPH}/${pageId}?fields=instagram_business_account&access_token=${pageToken}`,
      );
      const igData = await igResp.json();
      const igAccountId = igData?.instagram_business_account?.id;
      if (!igAccountId) continue;

      const { data, error } = await supabase
        .from("instagram_accounts")
        .upsert(
          {
            name: pageName,
            instagram_account_id: igAccountId,
            page_id: pageId,
            page_access_token: pageToken,
            long_lived_token_expires_at: expiresAt,
            is_active: true,
          },
          { onConflict: "instagram_account_id" },
        )
        .select()
        .single();

      if (error) console.error("[oauth-callback] upsert error", error);
      else upserted.push(data);
    }

    console.log(`[oauth-callback] ${upserted.length} contas conectadas (state=${state})`);

    // 5. Redirect to frontend
    const frontendUrl = Deno.env.get("FRONTEND_URL") ?? "";
    const redirectLocation = `${frontendUrl}${frontendUrl.includes("?") ? "&" : "?"}instagram=connected`;
    return new Response(null, {
      status: 302,
      headers: { ...corsHeaders, Location: redirectLocation },
    });
  } catch (err) {
    console.error("[oauth-callback] error", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
