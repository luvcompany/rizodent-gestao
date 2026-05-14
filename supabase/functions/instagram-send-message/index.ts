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
  message_type: "dm" | "comment" | "image" | "video" | "audio";
  comment_id?: string;
  // Comment-thread grouping (so outbound reply stays in same thread)
  post_id?: string;
  thread_sender_id?: string;
  // Media
  media_type?: "image" | "video" | "audio";
  media_url?: string;
}

const MEDIA_MESSAGE_TYPES = new Set(["image", "video", "audio"]);

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
    // Prefer Lite/legacy lookup by ig_user_id (Lite token is fresher)
    if (msg?.instagram_account_id) {
      const found = await lookupByIgUserId(msg.instagram_account_id);
      if (found?.page_access_token) return found;
    }
    if (msg?.instagram_account_config_id) {
      const { data } = await supabase
        .from("instagram_accounts")
        .select("id, page_access_token, is_active, instagram_account_id, name")
        .eq("id", msg.instagram_account_config_id)
        .maybeSingle();
      if (data) return data as ResolvedAccount;
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
    if (c?.instagram_account_id) {
      const found = await lookupByIgUserId(c.instagram_account_id);
      if (found?.page_access_token) return found;
    }
    if (c?.instagram_account_config_id) {
      const { data } = await supabase
        .from("instagram_accounts")
        .select("id, page_access_token, is_active, instagram_account_id, name")
        .eq("id", c.instagram_account_config_id)
        .maybeSingle();
      if (data) return data as ResolvedAccount;
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

  const { lead_id, message, message_type, comment_id, media_url, post_id, thread_sender_id } = body ?? {};
  const media_type = body?.media_type ?? (MEDIA_MESSAGE_TYPES.has(message_type) ? message_type as "image" | "video" | "audio" : undefined);
  let { instagram_account_id, recipient_id } = body ?? {};

  if (!message_type) {
    return jsonResponse({ error: "message_type is required" }, 400);
  }
  if (message_type === "comment" && !comment_id) {
    return jsonResponse({ error: "comment_id is required for message_type=comment" }, 400);
  }

  let leadId = lead_id ?? null;
  const recipientExplicit = !!recipient_id;

  if (MEDIA_MESSAGE_TYPES.has(message_type) && !media_url) {
    return jsonResponse({ error: "media_url is required for media messages" }, 400);
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

  // IGSIDs (sender_id) are SCOPED PER BUSINESS ACCOUNT. The same end user has a
  // different IGSID for each Instagram business account that received their DMs.
  // So when deriving recipient_id from a lead, we MUST scope by the account
  // we're sending FROM. Falling back to crm_leads.instagram_user_id (which only
  // stores the most recent IGSID) would silently use the wrong scoped id and
  // make Meta return code 100 / subcode 2534014 ("user not found").
  if (message_type !== "comment" && !recipientExplicit && leadId) {
    const { data: scoped } = await supabase
      .from("instagram_messages")
      .select("sender_id, created_at")
      .eq("lead_id", leadId)
      .eq("is_outbound", false)
      .eq("instagram_account_id", account.instagram_account_id)
      .not("sender_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (scoped?.sender_id) {
      recipient_id = scoped.sender_id as string;
    } else {
      // No inbound thread between this lead and the chosen account → cannot
      // derive a valid scoped IGSID. Return a friendly message instead of
      // letting Meta reject with a confusing 500.
      return jsonResponse({
        ok: false,
        error_code: "no_thread_for_account",
        error: "No inbound thread between this lead and the selected Instagram account",
        user_message:
          "Não há histórico de conversa deste lead com a conta selecionada. Selecione no seletor de contas a conta do Instagram que recebeu a última mensagem deste lead.",
      }, 200);
    }
  }

  if (message_type !== "comment" && !recipient_id) {
    return jsonResponse({ error: "recipient_id (or lead with inbound thread on selected account) is required for Instagram DM/media" }, 400);
  }
  const token = account.page_access_token;

  // Build Meta request
  let metaResponse: Response;
  let metaJson: any;

  try {
    // IGAA-prefixed tokens come from Instagram Login API (Lite) and MUST hit graph.instagram.com.
    // Other tokens (Page access tokens via Facebook Login) hit graph.facebook.com.
    const isIgLiteToken = token.startsWith("IGAA");
    const apiBase = isIgLiteToken
      ? "https://graph.instagram.com/v21.0"
      : "https://graph.facebook.com/v25.0";

    if (message_type !== "comment") {
      const messagePayload: Record<string, unknown> = {};
      if (media_url && media_type) {
        messagePayload.attachment = {
          type: media_type, // image | video | audio
          payload: { url: media_url, is_reusable: true },
        };
      } else {
        messagePayload.text = message;
      }
      metaResponse = await fetch(`${apiBase}/me/messages`, {
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
      const url = `${apiBase}/${comment_id}/replies?access_token=${encodeURIComponent(token)}`;
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
    const metaErr = metaJson?.error || {};
    const isUserNotFound = metaErr.code === 100 && metaErr.error_subcode === 2534014;
    return jsonResponse({
      ok: false,
      error_code: isUserNotFound ? "instagram_user_not_found" : "instagram_api_error",
      error: metaErr.message || "Meta API error",
      user_message: isUserNotFound
        ? "Não foi possível enviar: o usuário do Instagram não está disponível (pode ter bloqueado, desativado a conta ou nunca interagido)."
        : (metaErr.message || "Falha ao enviar mensagem pelo Instagram."),
      meta: metaJson,
    }, 200);
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
    message_type: message_type === "comment" ? "comment" : "dm",
    post_id: message_type === "comment" ? (post_id ?? null) : null,
    comment_id: message_type === "comment" ? comment_id ?? null : null,
    is_outbound: true,
    is_read: true,
    lead_id: leadId,
  });

  // Mirror into unified messages table for chat UI
  if (leadId) {
    const isComment = message_type === "comment";
    const msgType = isComment ? "comment" : (media_type ?? "text");
    const newCommentId = isComment ? (metaJson?.id ?? null) : null;
    // Fetch lead's tenant_id so the message is correctly scoped (RLS / multi-tenant)
    const { data: leadRow } = await supabase
      .from("crm_leads")
      .select("tenant_id")
      .eq("id", leadId)
      .maybeSingle();
    const leadTenantId = (leadRow as any)?.tenant_id ?? null;
    await supabase.from("messages").insert({
      lead_id: leadId,
      direction: "outbound",
      type: msgType,
      content: message ?? null,
      media_url: media_url ?? null,
      channel: "instagram",
      instagram_message_id: isComment ? newCommentId : igMessageId,
      instagram_sender_id: recipient_id ?? thread_sender_id ?? null,
      instagram_account_id: instagram_account_id ?? null,
      instagram_comment_id: isComment ? (newCommentId ?? comment_id ?? null) : null,
      instagram_post_id: isComment ? (post_id ?? null) : null,
      status: "sent",
      ...(leadTenantId ? { tenant_id: leadTenantId } : {}),
    });

    await supabase
      .from("crm_leads")
      .update({
        last_message: isComment
          ? `[Comentário] ${message ?? ""}`
          : (message ?? (media_url ? `[${media_type ?? "mídia"}]` : null)),
        last_message_at: new Date().toISOString(),
        last_outbound_at: new Date().toISOString(),
      })
      .eq("id", leadId);
  }

  return jsonResponse({ success: true, ok: true, message_id: igMessageId, meta: metaJson });
});
