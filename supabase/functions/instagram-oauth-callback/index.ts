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

    const frontendBase = Deno.env.get("FRONTEND_URL") ?? "";

    // 2.5. Verify token has required permissions
    const permResponse = await fetch(
      `${GRAPH}/me/permissions?access_token=${longLivedToken}`
    );
    const permData = await permResponse.json();
    console.log("[oauth] Token permissions:", JSON.stringify(permData));

    const hasPagesShowList = permData.data?.some(
      (p: any) => p.permission === "pages_show_list" && p.status === "granted"
    );

    if (!hasPagesShowList) {
      console.error("[oauth] Missing pages_show_list permission");
      return new Response(null, {
        status: 302,
        headers: {
          ...corsHeaders,
          Location: `${frontendBase}/integrations?error=missing_permissions`,
        },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
    const upserted: any[] = [];

    // Collected IG accounts: { id, name, username, page_id?, page_token? }
    type IgCandidate = { id: string; name?: string; username?: string; page_id?: string; page_token?: string };
    const igCandidates: IgCandidate[] = [];

    // OPTION 1: /me/instagram_accounts (direct)
    try {
      const r = await fetch(
        `${GRAPH}/me/instagram_accounts?fields=id,name,username,profile_picture_url&access_token=${longLivedToken}`
      );
      const igAccountsData = await r.json();
      console.log("[oauth] IG accounts direct:", JSON.stringify(igAccountsData));
      for (const a of igAccountsData?.data ?? []) {
        if (a?.id) igCandidates.push({ id: a.id, name: a.name, username: a.username });
      }
    } catch (e) {
      console.error("[oauth] IG direct fetch failed", e);
    }

    // OPTION 2: businesses -> instagram_business_accounts (fallback)
    if (igCandidates.length === 0) {
      try {
        const r = await fetch(
          `${GRAPH}/me?fields=businesses{instagram_business_accounts{id,name,username,profile_picture_url}}&access_token=${longLivedToken}`
        );
        const businessData = await r.json();
        console.log("[oauth] IG accounts via business:", JSON.stringify(businessData));
        for (const b of businessData?.businesses?.data ?? []) {
          for (const a of b?.instagram_business_accounts?.data ?? []) {
            if (a?.id) igCandidates.push({ id: a.id, name: a.name, username: a.username });
          }
        }
      } catch (e) {
        console.error("[oauth] IG via business fetch failed", e);
      }
    }

    // OPTION 3: /me/accounts -> page.instagram_business_account (legacy fallback)
    let pagesData: any = { data: [] };
    if (igCandidates.length === 0) {
      try {
        const pagesResponse = await fetch(
          `${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,name,username}&access_token=${longLivedToken}`
        );
        pagesData = await pagesResponse.json();
        console.log("[oauth] Pages API full response:", JSON.stringify(pagesData));

        if (pagesData.error) {
          console.error("[oauth] Meta API error:", pagesData.error);
        }

        for (const page of pagesData.data ?? []) {
          const igUrl = `${GRAPH}/${page.id}?fields=instagram_business_account{id,name,username,profile_picture_url}&access_token=${page.access_token}`;
          const igResp = await fetch(igUrl);
          const igData = await igResp.json();
          const igAccount = igData?.instagram_business_account;
          console.log(`[oauth] Page ${page.id} IG:`, JSON.stringify(igData));
          if (igAccount?.id) {
            igCandidates.push({
              id: igAccount.id,
              name: igAccount.name,
              username: igAccount.username,
              page_id: page.id,
              page_token: page.access_token,
            });
          }
        }
      } catch (e) {
        console.error("[oauth] /me/accounts fetch failed", e);
      }
    }

    console.log(`[oauth] Total IG candidates: ${igCandidates.length}`);

    for (const cand of igCandidates) {
      const accountName = cand.username || cand.name || cand.id;
      const tokenToStore = cand.page_token || longLivedToken;

      console.log("[oauth] Saving IG account:", { instagram_account_id: cand.id, name: accountName, has_page_id: !!cand.page_id });

      const { data, error: upsertError } = await supabase
        .from("instagram_accounts")
        .upsert(
          {
            name: accountName,
            instagram_account_id: cand.id,
            page_id: cand.page_id ?? null,
            page_access_token: tokenToStore,
            long_lived_token_expires_at: expiresAt,
            is_active: true,
          },
          { onConflict: "instagram_account_id" },
        )
        .select()
        .single();

      if (upsertError) {
        console.error("[oauth] Upsert ERROR:", upsertError.message, upsertError.details);
      } else {
        console.log("[oauth] Account saved");
        upserted.push(data);
      }

      // Subscribe page webhooks if we have a page (only via legacy path)
      if (cand.page_id && cand.page_token) {
        try {
          const subFields = "messages,messaging_postbacks,message_reactions,message_reads,feed,mention";
          const subResp = await fetch(`${GRAPH}/${cand.page_id}/subscribed_apps`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ subscribed_fields: subFields, access_token: cand.page_token }),
          });
          const subData = await subResp.json();
          console.log(`[oauth] subscribed_apps page=${cand.page_id} ok=${subResp.ok}`, subData);
        } catch (e) {
          console.error(`[oauth] subscribed_apps failed page=${cand.page_id}`, e);
        }
      }
    }

    console.log(`[oauth] ${upserted.length} contas conectadas (state=${state})`);

    // 5. Redirect to frontend
    const frontendUrl = Deno.env.get("FRONTEND_URL") ?? "";
    let redirectLocation: string;

    if (igCandidates.length === 0) {
      console.warn("[oauth] No Instagram accounts found via any method");
      redirectLocation = `${frontendUrl}/integrations?error=no_instagram_accounts`;
    } else if (upserted.length === 0) {
      console.warn("[oauth] IG candidates found but upsert failed for all");
      redirectLocation = `${frontendUrl}/integrations?error=save_failed`;
    } else {
      redirectLocation = `${frontendUrl}${frontendUrl.includes("?") ? "&" : "?"}instagram=connected`;
    }
    
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
