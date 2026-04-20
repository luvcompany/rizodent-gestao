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
  // Identification: either by IG account id directly, or by lead_id
  instagram_account_id?: string;
  lead_id?: string;
  recipient_id?: string;
  // Content
  message?: string;
  message_type: "dm" | "comment";
  comment_id?: string;
  // Media
  media_type?: "image" | "video" | "audio";
  media_url?: string;
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function resolveAccount(input: { instagram_account_id?: string; lead_id?: string; comment_id?: string }) {
  // Strategy A: explicit IG account id
  if (input.instagram_account_id) {
    const { data } = await supabase
      .from("instagram_accounts")
      .select("id, page_access_token, is_active, instagram_account_id, name")
      .eq("instagram_account_id", input.instagram_account_id)
      .maybeSingle();
    if (data) return data;
  }

  // Strategy B: derive from lead's most recent instagram_messages
  if (input.lead_id) {
    const { data: msg } = await supabase
      .from("instagram_messages")
      .select("instagram_account_id, instagram_account_config_id")
      .eq("lead_id", input.lead_id)
      .not("instagram_account_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (msg?.instagram_account_config_id) {
      const { data } = await supabase
        .from("instagram_accounts")
        .select("id, page_access_token, is_active, instagram_account_id, name")
        .eq("id", msg.instagram_account_config_id)
        .maybeSingle();
      if (data) return data;
    }
    if (msg?.instagram_account_id) {
      const { data } = await supabase
        .from("instagram_accounts")
        .select("id, page_access_token, is_active, instagram_account_id, name")
        .eq("instagram_account_id", msg.instagram_account_id)
        .maybeSingle();
      if (data) return data;
    }
  }

  // Strategy C: derive from comment_id's stored row
  if (input.comment_id) {
    const { data: c } = await supabase
      .from("instagram_messages")
      .select("instagram_account_id, instagram_account_config_id")
      .eq("comment_id", input.comment_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (c?.instagram_account_config_id) {
      const { data } = await supabase
        .from("instagram_accounts")
        .select("id, page_access_token, is_active, instagram_account_id, name")
        .eq("id", c.instagram_account_config_id)
        .maybeSingle();
      if (data) return data;
    }
    if (c?.instagram_account_id) {
      const { data } = await supabase
        .from("instagram_accounts")
        .select("id, page_access_token, is_active, instagram_account_id, name")
        .eq("instagram_account_id", c.instagram_account_id)
        .maybeSingle();
      if (data) return data;
    }
  }

  // Strategy D: only one active IG account → use it
  const { data: accounts } = await supabase
    .from("instagram_accounts")
    .select("id, page_access_token, is_active, instagram_account_id, name")
    .eq("is_active", true)
    .limit(2);
  if (accounts && accounts.length === 1) return accounts[0];
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { lead_id, message, message_type, comment_id, media_type, media_url } = body ?? {};
  let { instagram_account_id, recipient_id } = body ?? {};

  if (!message_type) {
    return jsonResponse({ error: "message_type is required" }, 400);
  }
  if (message_type === "comment" && !comment_id) {
    return jsonResponse({ error: "comment_id is required for message_type=comment" }, 400);
  }

  // If lead_id is provided, derive recipient_id and account from lead
  let leadId = lead_id ?? null;
  if (leadId && !recipient_id) {
    const { data: lead } = await supabase
      .from("crm_leads")
      .select("instagram_user_id")
      .eq("id", leadId)
      .maybeSingle();
    if (lead?.instagram_user_id) {
      recipient_id = lead.instagram_user_id;
    }
  }

  if (message_type === "dm" && !recipient_id) {
    return jsonResponse({ error: "recipient_id (or lead with instagram_user_id) is required for DM" }, 400);
  }
  if (!message && !media_url) {
    return jsonResponse({ error: "message or media_url is required" }, 400);
  }

  const account = await resolveAccount({ instagram_account_id, lead_id: leadId ?? undefined });
  if (!account || !account.is_active || !account.page_access_token) {
    return jsonResponse({ error: "Instagram account not found, inactive, or missing access token" }, 404);
  }
  instagram_account_id = account.instagram_account_id;
  const token = account.page_access_token;

  // Build Meta request
  let metaResponse: Response;
  let metaJson: any;

  try {
    if (message_type === "dm") {
      const messagePayload: Record<string, unknown> = {};
      if (media_url && media_type) {
        messagePayload.attachment = {
          type: media_type, // image | video | audio
          payload: { url: media_url, is_reusable: false },
        };
      } else {
        messagePayload.text = message;
      }
      metaResponse = await fetch("https://graph.facebook.com/v25.0/me/messages", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          recipient: { id: recipient_id },
          message: messagePayload,
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
    return jsonResponse({ error: "Failed to reach Meta API", details: String(err) }, 500);
  }

  if (!metaResponse.ok) {
    console.error("[instagram-send-message] Meta error:", metaJson);
    return jsonResponse({ error: metaJson?.error?.message || "Meta API error", meta: metaJson }, 500);
  }

  const igMessageId = metaJson?.message_id ?? null;

  // Persist to instagram_messages (legacy)
  await supabase.from("instagram_messages").insert({
    instagram_account_id,
    instagram_account_config_id: account.id,
    sender_id: recipient_id || null,
    sender_name: null,
    message_text: message ?? null,
    message_type,
    post_id: null,
    comment_id: message_type === "comment" ? comment_id ?? null : null,
    is_outbound: true,
    is_read: true,
    lead_id: leadId,
  });

  // Mirror into unified messages table for chat UI
  if (leadId) {
    const msgType = media_type ?? "text";
    await supabase.from("messages").insert({
      lead_id: leadId,
      direction: "outbound",
      type: msgType,
      content: message ?? null,
      media_url: media_url ?? null,
      channel: "instagram",
      instagram_message_id: igMessageId,
      instagram_sender_id: recipient_id ?? null,
      status: "sent",
    });

    await supabase
      .from("crm_leads")
      .update({
        last_message: message ?? (media_url ? `[${media_type ?? "mídia"}]` : null),
        last_message_at: new Date().toISOString(),
        last_outbound_at: new Date().toISOString(),
      })
      .eq("id", leadId);
  }

  return jsonResponse({ success: true, ok: true, message_id: igMessageId, meta: metaJson });
});
