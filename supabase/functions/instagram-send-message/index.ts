import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, serviceRoleKey);

interface Body {
  instagram_account_id: string;
  recipient_id: string;
  message: string;
  message_type: "dm" | "comment";
  comment_id?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { instagram_account_id, recipient_id, message, message_type, comment_id } = body ?? {};

  if (!instagram_account_id || !message || !message_type) {
    return new Response(
      JSON.stringify({ error: "instagram_account_id, message and message_type are required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
  if (message_type === "comment" && !comment_id) {
    return new Response(JSON.stringify({ error: "comment_id is required for message_type=comment" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (message_type === "dm" && !recipient_id) {
    return new Response(JSON.stringify({ error: "recipient_id is required for message_type=dm" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Look up account
  const { data: account, error: accErr } = await supabase
    .from("instagram_accounts")
    .select("id, page_access_token, is_active, instagram_account_id")
    .eq("instagram_account_id", instagram_account_id)
    .maybeSingle();

  if (accErr) {
    console.error("[instagram-send-message] DB error:", accErr);
    return new Response(JSON.stringify({ error: "Database error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!account || !account.is_active || !account.page_access_token) {
    return new Response(
      JSON.stringify({ error: "Instagram account not found, inactive, or missing access token" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const token = account.page_access_token;
  let metaResponse: Response;
  let metaJson: unknown;

  try {
    if (message_type === "dm") {
      metaResponse = await fetch("https://graph.facebook.com/v25.0/me/messages", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          recipient: { id: recipient_id },
          message: { text: message },
        }),
      });
    } else {
      const url = `https://graph.facebook.com/v25.0/${comment_id}/replies?access_token=${encodeURIComponent(token)}`;
      metaResponse = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
    }
    metaJson = await metaResponse.json().catch(() => ({}));
  } catch (err) {
    console.error("[instagram-send-message] Meta call failed:", err);
    return new Response(JSON.stringify({ error: "Failed to reach Meta API", details: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!metaResponse.ok) {
    console.error("[instagram-send-message] Meta error:", metaJson);
    return new Response(JSON.stringify({ error: "Meta API error", meta: metaJson }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Persist outbound message
  await supabase.from("instagram_messages").insert({
    instagram_account_id,
    instagram_account_config_id: account.id,
    sender_id: recipient_id || null,
    sender_name: null,
    message_text: message,
    message_type,
    post_id: null,
    comment_id: message_type === "comment" ? comment_id ?? null : null,
    is_outbound: true,
    is_read: true,
    lead_id: null,
  });

  return new Response(JSON.stringify({ success: true, meta: metaJson }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
