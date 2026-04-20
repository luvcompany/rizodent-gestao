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

    console.log("[oauth] Step 1 - Code received:", code?.substring(0, 10));

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
    console.log("[oauth] Step 2 - Short token received:", !!shortData?.access_token);
    if (!shortResp.ok || !shortData.access_token) {
      console.error("[oauth] short-lived token error", shortData);
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
    console.log("[oauth] Step 3 - Long token received:", !!longData?.access_token);
    if (!longResp.ok || !longData.access_token) {
      console.error("[oauth] long-lived token error", longData);
      return new Response(JSON.stringify({ error: "Failed long-lived token", details: longData }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const longLivedToken = longData.access_token;

    // 3. Get Pages with Instagram business account info
    const pagesResponse = await fetch(
      `${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,name,username}&access_token=${longLivedToken}`
    );
    const pagesData = await pagesResponse.json();

    console.log("[oauth] Pages API full response:", JSON.stringify(pagesData));
    console.log("[oauth] Long token preview:", longLivedToken?.substring(0, 30));

    // Check for API error from Meta
    if (pagesData.error) {
      console.error("[oauth] Meta API error:", pagesData.error);
      return new Response(JSON.stringify({ error: "Meta API error", details: pagesData.error }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if response is not OK (HTTP error)
    if (!pagesResponse.ok) {
      console.error("[oauth] pages HTTP error", pagesData);
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

      // IMPORTANT: use the page-specific access token (data[i].access_token)
      const igUrl = `${GRAPH}/${pageId}?fields=instagram_business_account{id,name,username,profile_picture_url}&access_token=${pageToken}`;
      const igResp = await fetch(igUrl);
      const igData = await igResp.json();
      const igAccount = igData?.instagram_business_account;
      console.log(`[oauth] Step 5 - Instagram account for page ${pageId}:`, JSON.stringify(igData));

      if (!igAccount?.id) {
        console.warn(`[oauth] Warning: No Instagram Business Account found for page ${pageId} (${pageName})`);
        continue;
      }

      const igAccountId = igAccount.id;

      console.log("[oauth] Step 6 - Saving account:", {
        instagram_account_id: igAccountId,
        page_id: pageId,
        name: pageName,
      });

      const { data, error: upsertError } = await supabase
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

      if (upsertError) {
        console.error("[oauth] Step 6 ERROR:", upsertError.message, upsertError.details);
      } else {
        console.log("[oauth] Step 6 SUCCESS - Account saved");
        upserted.push(data);
      }

      // Subscribe the Page to webhook fields so Instagram events are delivered
      try {
        const subFields = "messages,messaging_postbacks,message_reactions,message_reads,feed,mention";
        const subResp = await fetch(`${GRAPH}/${pageId}/subscribed_apps`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            subscribed_fields: subFields,
            access_token: pageToken,
          }),
        });
        const subData = await subResp.json();
        console.log(`[oauth] subscribed_apps page=${pageId} ok=${subResp.ok}`, subData);
      } catch (e) {
        console.error(`[oauth] subscribed_apps failed page=${pageId}`, e);
      }
    }

    console.log(`[oauth] ${upserted.length} contas conectadas (state=${state})`);

    // 5. Redirect to frontend
    const frontendUrl = Deno.env.get("FRONTEND_URL") ?? "";
    const redirectLocation = `${frontendUrl}${frontendUrl.includes("?") ? "&" : "?"}instagram=connected`;
    return new Response(null, {
      status: 302,
      headers: { ...corsHeaders, Location: redirectLocation },
    });
  } catch (err) {
    console.error("[oauth] error", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
