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
    const {
      instagram_account_id,
      recipient_id,
      message,
      message_type = "dm",
      comment_id,
    } = body ?? {};

    if (!instagram_account_id || !message) {
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
      return new Response(JSON.stringify({ error: "Instagram account not found or missing token" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!account.is_active) {
      return new Response(JSON.stringify({ error: "Instagram account is disabled" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let metaResponse: Response;
    let metaJson: unknown;

    if (message_type === "dm") {
      // Send DM via Instagram Messaging API
      metaResponse = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${account.instagram_account_id}/messages?access_token=${encodeURIComponent(account.page_access_token)}`,
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
      // Reply to a comment
      metaResponse = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${comment_id}/replies?access_token=${encodeURIComponent(account.page_access_token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message }),
        },
      );
      metaJson = await metaResponse.json();
    }

    if (!metaResponse.ok) {
      console.error("[instagram-send-message] Meta API error:", metaJson);
      return new Response(
        JSON.stringify({ error: "Meta API error", details: metaJson }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

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
    console.error("[instagram-send-message] Error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
