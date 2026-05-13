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
  // Comment-thread grouping (so outbound reply stays in same thread)
  post_id?: string;
  thread_sender_id?: string;
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

function getMetaPermissionError(metaJson: any) {
  const metaError = metaJson?.error;
  if (!metaError) return null;

  const isPermissionDenied = metaError.code === 200 && metaError.error_subcode === 2534048;
  if (!isPermissionDenied) return null;

  return {
    ok: false,
    error_code: "instagram_permission_denied",
    error: metaError.message || "Instagram messaging permission denied",
    user_message:
      "A integração do Instagram ainda não tem permissão avançada para enviar mensagens. Libere a permissão instagram_manage_messages no app da Meta ou adicione este perfil como função no app.",
    setup_required: true,
    meta: metaJson,
  };
}

type ResolvedAccount = {
  id: string;
  page_access_token: string;
  is_active: boolean;
  instagram_account_id: string;
  name: string | null;
};

async function lookupByIgUserId(igUserId: string): Promise<ResolvedAccount | null> {
  // Try ig_accounts (Instagram Lite) first — these have fresh long-lived tokens
  const { data: lite } = await supabase
    .from("ig_accounts")
    .select("id, access_token, active, ig_user_id, username")
    .eq("ig_user_id", igUserId)
    .maybeSingle();
  if (lite && lite.access_token) {
    return {
      id: lite.id,
      page_access_token: lite.access_token,
      is_active: lite.active,
      instagram_account_id: lite.ig_user_id,
      name: lite.username,
    };
  }

  // Fallback: legacy instagram_accounts
  const { data: legacy } = await supabase
    .from("instagram_accounts")
    .select("id, page_access_token, is_active, instagram_account_id, name")
    .eq("instagram_account_id", igUserId)
    .maybeSingle();
  if (legacy) return legacy as ResolvedAccount;

  return null;
}

async function resolveAccount(input: { instagram_account_id?: string; lead_id?: string; comment_id?: string }): Promise<ResolvedAccount | null> {
  // Strategy A: explicit IG account id
  if (input.instagram_account_id) {
    const found = await lookupByIgUserId(input.instagram_account_id);
    if (found) return found;
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
      if (data) return data as ResolvedAccount;
    }
    if (msg?.instagram_account_id) {
      const found = await lookupByIgUserId(msg.instagram_account_id);
      if (found) return found;
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
      if (data) return data as ResolvedAccount;
    }
    if (c?.instagram_account_id) {
      const found = await lookupByIgUserId(c.instagram_account_id);
      if (found) return found;
    }
  }

  // Strategy D: only one active IG account total (legacy + lite) → use it
  const [{ data: legacyAccs }, { data: liteAccs }] = await Promise.all([
    supabase
      .from("instagram_accounts")
      .select("id, page_access_token, is_active, instagram_account_id, name")
      .eq("is_active", true)
      .limit(2),
    supabase
      .from("ig_accounts")
      .select("id, access_token, active, ig_user_id, username")
      .eq("active", true)
      .limit(2),
  ]);
  const combined: ResolvedAccount[] = [
    ...((legacyAccs ?? []) as ResolvedAccount[]),
    ...((liteAccs ?? []).map((l: any) => ({
      id: l.id,
      page_access_token: l.access_token,
      is_active: l.active,
      instagram_account_id: l.ig_user_id,
      name: l.username,
    }))),
  ];
  if (combined.length === 1) return combined[0];
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // Require authenticated caller (user JWT) or service role
  const authHeader = req.headers.get("authorization") || "";
  const isServiceRole = authHeader === `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`;
  if (!isServiceRole) {
    if (!authHeader.startsWith("Bearer ")) return jsonResponse({ error: "Unauthorized" }, 401);
    const token = authHeader.slice("Bearer ".length);
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { lead_id, message, message_type, comment_id, media_type, media_url, post_id, thread_sender_id } = body ?? {};
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

  console.log("[instagram-send-message] resolving account", { instagram_account_id, leadId, comment_id, recipient_id, message_type });
  const account = await resolveAccount({ instagram_account_id, lead_id: leadId ?? undefined, comment_id });
  console.log("[instagram-send-message] resolved account:", account ? { id: account.id, name: account.name, is_active: account.is_active, hasToken: !!account.page_access_token } : null);
  if (!account || !account.is_active || !account.page_access_token) {
    return jsonResponse({ error: "Instagram account not found, inactive, or missing access token", debug: { instagram_account_id, leadId, comment_id, recipient_id } }, 404);
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
    const permissionError = getMetaPermissionError(metaJson);
    if (permissionError) {
      return jsonResponse(permissionError, 200);
    }
    return jsonResponse({ error: metaJson?.error?.message || "Meta API error", meta: metaJson }, 500);
  }

  const igMessageId = metaJson?.message_id ?? null;

  // Persist to instagram_messages (legacy)
  // For comment replies: keep post_id + thread_sender_id so the UI groups outbound
  // reply into the same thread (key = sender_id::post_id).
  await supabase.from("instagram_messages").insert({
    instagram_account_id,
    instagram_account_config_id: account.id,
    sender_id: message_type === "comment" ? (thread_sender_id ?? null) : (recipient_id || null),
    sender_name: null,
    message_text: message ?? null,
    message_type,
    post_id: message_type === "comment" ? (post_id ?? null) : null,
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
