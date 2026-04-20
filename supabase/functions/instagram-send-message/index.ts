import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GRAPH_VERSION = "v25.0";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(
      authHeader.replace("Bearer ", ""),
    );
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    console.log("[ig-send] Request received", { body });

    const {
      instagram_account_id,
      recipient_id,
      message,
      message_type = "dm",
      comment_id,
    } = body ?? {};

    if (!instagram_account_id || !message) {
      console.error("[ig-send] Missing required fields", { instagram_account_id, has_message: !!message });
      return new Response(
        JSON.stringify({ error: "instagram_account_id and message are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (message_type === "dm" && !recipient_id) {
      return new Response(JSON.stringify({ error: "recipient_id required for dm" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (message_type === "comment" && !comment_id) {
      return new Response(JSON.stringify({ error: "comment_id required for comment reply" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: account, error: accountError } = await adminClient
      .from("instagram_accounts")
      .select("instagram_account_id, page_access_token, name, is_active")
      .eq("instagram_account_id", instagram_account_id)
      .maybeSingle();

    if (accountError || !account || !account.page_access_token) {
      console.error("[ig-send] Account not found for id:", instagram_account_id, { accountError });
      // Debug: list available accounts to help diagnose mismatch
      const { data: allAccounts } = await adminClient
        .from("instagram_accounts")
        .select("instagram_account_id, name, is_active");
      console.error("[ig-send] Available accounts in DB:", allAccounts);
      return new Response(JSON.stringify({ error: "Instagram account not found or missing token" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.log("[ig-send] Account found:", {
      instagram_account_id: account.instagram_account_id,
      name: account.name,
      has_token: !!account.page_access_token,
      is_active: account.is_active,
    });

    if (!account.is_active) {
      return new Response(JSON.stringify({ error: "Instagram account is disabled" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let metaResponse: Response;
    let metaJson: unknown;
    let metaUrl: string;

    if (message_type === "dm") {
      metaUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${account.instagram_account_id}/messages`;
      console.log("[ig-send] Calling Meta API", { url: metaUrl, message_type, recipient_id });
      metaResponse = await fetch(
        `${metaUrl}?access_token=${encodeURIComponent(account.page_access_token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipient: { id: recipient_id },
            message: { text: message },
          }),
        },
      );
      metaJson = await metaResponse.json();
    } else {
      metaUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${comment_id}/replies`;
      console.log("[ig-send] Calling Meta API", { url: metaUrl, message_type, comment_id });
      metaResponse = await fetch(
        `${metaUrl}?access_token=${encodeURIComponent(account.page_access_token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message }),
        },
      );
      metaJson = await metaResponse.json();
    }

    if (!metaResponse.ok) {
      console.error("[ig-send] Meta API error:", { status: metaResponse.status, body: metaJson });
      return new Response(
        JSON.stringify({ error: "Meta API error", details: metaJson }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    console.log("[ig-send] Meta API success:", metaJson);

    // Persist outbound message
    await adminClient.from("instagram_messages").insert({
      instagram_account_id: account.instagram_account_id,
      sender_id: recipient_id ?? null,
      sender_name: account.name ?? null,
      message_text: message,
      message_type,
      comment_id: comment_id ?? null,
      is_outbound: true,
      is_read: true,
    });

    return new Response(JSON.stringify({ ok: true, meta: metaJson }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ig-send] Exception:", msg, e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
