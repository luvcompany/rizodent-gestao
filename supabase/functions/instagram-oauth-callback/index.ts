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

  // FRONTEND_URL já vem no formato: https://rizodent-gestao.lovable.app/crm/integracoes
  const baseUrl = Deno.env.get("FRONTEND_URL") ?? "";
  const buildRedirect = (params: Record<string, string>) => {
    const sep = baseUrl.includes("?") ? "&" : "?";
    const qs = new URLSearchParams(params).toString();
    return `${baseUrl}${sep}${qs}`;
  };

  try {
    // STEP 1 - Receber o code
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    console.log("[oauth] Step 1 - Code received:", code?.substring(0, 10), "state:", state);

    if (!code) {
      console.error("[oauth] Step 1 - Missing code");
      return Response.redirect(buildRedirect({ error: "missing_code" }), 302);
    }

    const META_APP_ID = Deno.env.get("META_APP_ID")!;
    const META_APP_SECRET = Deno.env.get("META_APP_SECRET")!;
    const INSTAGRAM_REDIRECT_URI = Deno.env.get("INSTAGRAM_REDIRECT_URI")!;

    // STEP 2 - Trocar code por token curto
    const tokenUrl = new URL(`${GRAPH}/oauth/access_token`);
    tokenUrl.searchParams.set("client_id", META_APP_ID);
    tokenUrl.searchParams.set("client_secret", META_APP_SECRET);
    tokenUrl.searchParams.set("redirect_uri", INSTAGRAM_REDIRECT_URI);
    tokenUrl.searchParams.set("code", code);

    const shortTokenRes = await fetch(tokenUrl.toString());
    const shortTokenData = await shortTokenRes.json();
    console.log("[oauth] Step 2 - Short token response:", JSON.stringify(shortTokenData));

    if (shortTokenData.error) {
      console.error("[oauth] Step 2 error:", JSON.stringify(shortTokenData.error));
      return Response.redirect(buildRedirect({ error: "token_exchange_failed" }), 302);
    }
    const shortToken = shortTokenData.access_token;

    // STEP 3 - Trocar por token longo
    const longTokenUrl = new URL(`${GRAPH}/oauth/access_token`);
    longTokenUrl.searchParams.set("grant_type", "fb_exchange_token");
    longTokenUrl.searchParams.set("client_id", META_APP_ID);
    longTokenUrl.searchParams.set("client_secret", META_APP_SECRET);
    longTokenUrl.searchParams.set("fb_exchange_token", shortToken);

    const longTokenRes = await fetch(longTokenUrl.toString());
    const longTokenData = await longTokenRes.json();
    console.log("[oauth] Step 3 - Long token response:", JSON.stringify(longTokenData));

    if (longTokenData.error) {
      console.error("[oauth] Step 3 error:", JSON.stringify(longTokenData.error));
      return Response.redirect(buildRedirect({ error: "long_token_failed" }), 302);
    }
    const longToken = longTokenData.access_token;

    // STEP 4 - Buscar páginas do Facebook com token longo
    const pagesUrl = `${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,name,username,profile_picture_url}&access_token=${longToken}`;
    const pagesRes = await fetch(pagesUrl);
    const pagesData = await pagesRes.json();
    console.log("[oauth] Step 4 - Pages response status:", pagesRes.status);
    console.log("[oauth] Step 4 - Pages full response:", JSON.stringify(pagesData));

    if (pagesData.error) {
      console.error("[oauth] Step 4 error:", JSON.stringify(pagesData.error));
      return Response.redirect(buildRedirect({ error: "pages_fetch_failed" }), 302);
    }

    if (!pagesData.data || pagesData.data.length === 0) {
      console.warn("[oauth] Step 4 - No pages found");
      return Response.redirect(buildRedirect({ error: "no_pages_found" }), 302);
    }

    // STEP 5 - Salvar contas Instagram vinculadas
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let savedCount = 0;
    for (const page of pagesData.data) {
      console.log("[oauth] Step 5 - Processing page:", page.id, page.name);
      console.log("[oauth] Step 5 - Has instagram:", !!page.instagram_business_account);

      if (!page.instagram_business_account) {
        console.log("[oauth] Step 5 - Skipping page without instagram:", page.name);
        continue;
      }

      const igAccount = page.instagram_business_account;

      const { error } = await supabase
        .from("instagram_accounts")
        .upsert(
          {
            instagram_account_id: igAccount.id,
            name: igAccount.username || igAccount.name || page.name,
            page_id: page.id,
            page_access_token: page.access_token,
            long_lived_token_expires_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
            is_active: true,
          },
          { onConflict: "instagram_account_id" },
        );

      if (error) {
        console.error("[oauth] Step 5 - Save error for", igAccount.id, ":", error.message);
      } else {
        console.log("[oauth] Step 5 - Saved account:", igAccount.id, igAccount.username);
        savedCount++;
      }
    }

    console.log("[oauth] Done -", savedCount, "accounts saved");
    return Response.redirect(
      buildRedirect({ instagram: "connected", accounts: String(savedCount) }),
      302,
    );
  } catch (err) {
    console.error("[oauth] Fatal error:", err);
    return Response.redirect(buildRedirect({ error: "fatal_error" }), 302);
  }
});
