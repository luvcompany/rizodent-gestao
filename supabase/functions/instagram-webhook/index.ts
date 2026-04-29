import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hub-signature-256",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VERIFY_TOKEN = Deno.env.get("INSTAGRAM_VERIFY_TOKEN") ?? "";
const APP_SECRET =
  Deno.env.get("INSTAGRAM_APP_SECRET") ??
  Deno.env.get("META_APP_SECRET") ??
  "";

const INSTAGRAM_PIPELINE_ID = "c2d3e4f5-0001-4000-8000-000000000002";

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function verifySignature(rawBody: string, signature: string | null): Promise<boolean> {
  if (!signature || !APP_SECRET) return false;
  const expectedPrefix = "sha256=";
  if (!signature.startsWith(expectedPrefix)) return false;
  const sigHex = signature.slice(expectedPrefix.length);

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const computed = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (computed.length !== sigHex.length) return false;
  let mismatch = 0;
  for (let i = 0; i < computed.length; i++) {
    mismatch |= computed.charCodeAt(i) ^ sigHex.charCodeAt(i);
  }
  return mismatch === 0;
}

// Profile cache (per invocation)
const profileCache = new Map<string, { name: string | null; username: string | null; profile_pic: string | null }>();

async function fetchIgProfile(igUserId: string, accessToken: string) {
  if (profileCache.has(igUserId)) return profileCache.get(igUserId)!;

  let out: { name: string | null; username: string | null; profile_pic: string | null } = {
    name: null,
    username: null,
    profile_pic: null,
  };

  // Attempt 1: full set (works for IG Business / Creator users that messaged a connected page)
  try {
    const url = `https://graph.facebook.com/v25.0/${igUserId}?fields=name,username,profile_pic&access_token=${encodeURIComponent(accessToken)}`;
    const r = await fetch(url);
    const j = await r.json().catch(() => ({}));
    console.log(`[instagram-webhook] profile (full) ${igUserId} status=${r.status}:`, JSON.stringify(j));
    if (r.ok) {
      out = {
        name: j?.name ?? null,
        username: j?.username ?? null,
        profile_pic: j?.profile_pic ?? null,
      };
    }
  } catch (e) {
    console.warn("[instagram-webhook] fetchIgProfile attempt1 error", igUserId, e);
  }

  // Attempt 2: fallback to just username + profile_picture_url
  if (!out.username || !out.profile_pic) {
    try {
      const url2 = `https://graph.facebook.com/v25.0/${igUserId}?fields=username,profile_picture_url&access_token=${encodeURIComponent(accessToken)}`;
      const r2 = await fetch(url2);
      const j2 = await r2.json().catch(() => ({}));
      console.log(`[instagram-webhook] profile (fallback) ${igUserId} status=${r2.status}:`, JSON.stringify(j2));
      if (r2.ok) {
        out.username = out.username || j2?.username || null;
        out.profile_pic = out.profile_pic || j2?.profile_picture_url || null;
        out.name = out.name || j2?.name || null;
      }
    } catch (e) {
      console.warn("[instagram-webhook] fetchIgProfile attempt2 error", igUserId, e);
    }
  }

  // Attempt 3: query the conversation participants endpoint — most reliable for DMs
  // because the IG user is in a messaging context with our page.
  if (!out.name && !out.username) {
    try {
      const convUrl = `https://graph.facebook.com/v25.0/me/conversations?platform=instagram&user_id=${encodeURIComponent(igUserId)}&fields=participants&access_token=${encodeURIComponent(accessToken)}`;
      const r3 = await fetch(convUrl);
      const j3 = await r3.json().catch(() => ({}));
      console.log(`[instagram-webhook] profile (conv) ${igUserId} status=${r3.status}:`, JSON.stringify(j3));
      if (r3.ok && Array.isArray(j3?.data)) {
        for (const conv of j3.data) {
          const parts = conv?.participants?.data ?? [];
          const me = parts.find((p: any) => p?.id === igUserId);
          if (me) {
            out.name = out.name || me?.name || null;
            out.username = out.username || me?.username || null;
            break;
          }
        }
      }
    } catch (e) {
      console.warn("[instagram-webhook] fetchIgProfile attempt3 error", igUserId, e);
    }
  }

  profileCache.set(igUserId, out);
  return out;
}

// Find or create lead in Instagram pipeline based on IG user ID
async function findOrCreateLead(
  igUserId: string,
  profile: { name: string | null; username: string | null; profile_pic: string | null },
  accountName: string | null
): Promise<string | null> {
  if (!igUserId) return null;

  // 1. Try to find existing lead by instagram_user_id
  const { data: existing } = await supabase
    .from("crm_leads")
    .select("id, instagram_username, instagram_profile_pic_url, name, is_blocked")
    .eq("instagram_user_id", igUserId)
    .maybeSingle();

  if (existing && (existing as any).is_blocked) {
    console.log(`[instagram-webhook] Lead ${existing.id} (IG ${igUserId}) está BLOQUEADO — mensagem descartada.`);
    return null;
  }

  if (existing) {
    // Update profile cache fields if missing/stale
    const updates: Record<string, unknown> = {};
    if (profile.username && existing.instagram_username !== profile.username) {
      updates.instagram_username = profile.username;
    }
    if (profile.profile_pic && existing.instagram_profile_pic_url !== profile.profile_pic) {
      updates.instagram_profile_pic_url = profile.profile_pic;
    }
    // If lead name is the placeholder "IG xxxxxxxx", upgrade it to real name/username when we get one
    const placeholder = `IG ${igUserId.slice(0, 8)}`;
    if (existing.name === placeholder || existing.name?.startsWith("IG ")) {
      const better = profile.name || profile.username;
      if (better) updates.name = better;
    }
    if (Object.keys(updates).length > 0) {
      await supabase.from("crm_leads").update(updates).eq("id", existing.id);
    }
    return existing.id;
  }

  // 2. Find first stage of Instagram pipeline
  const { data: firstStage } = await supabase
    .from("crm_stages")
    .select("id")
    .eq("pipeline_id", INSTAGRAM_PIPELINE_ID)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!firstStage) {
    console.error("[instagram-webhook] No stages in Instagram pipeline");
    return null;
  }

  const displayName = profile.name || profile.username || `IG ${igUserId.slice(0, 8)}`;
  const sourceLabel = accountName ? `Instagram (${accountName})` : "Instagram";

  const { data: created, error: createErr } = await supabase
    .from("crm_leads")
    .insert({
      name: displayName,
      pipeline_id: INSTAGRAM_PIPELINE_ID,
      stage_id: firstStage.id,
      source: sourceLabel,
      instagram_user_id: igUserId,
      instagram_username: profile.username,
      instagram_profile_pic_url: profile.profile_pic,
    })
    .select("id")
    .single();

  if (createErr) {
    console.error("[instagram-webhook] Failed to create lead:", createErr);
    return null;
  }
  console.log(`[instagram-webhook] Created IG lead ${created.id} for user ${igUserId}`);
  return created.id;
}

async function persistMessage(opts: {
  accountId: string;
  accountConfigId: string | null;
  accountName: string | null;
  accessToken: string | null;
  senderId: string;
  senderUsername: string | null;
  senderName: string | null;
  text: string | null;
  messageType: "dm" | "comment";
  postId: string | null;
  commentId: string | null;
  igMessageId: string | null;
}) {
  // Enrich profile via Graph API if we have a token
  let profile = { name: opts.senderName, username: opts.senderUsername, profile_pic: null as string | null };
  if (opts.accessToken && opts.senderId) {
    profile = await fetchIgProfile(opts.senderId, opts.accessToken);
  }

  // Find or create lead — ONLY for DMs. Comments stay in instagram_messages only.
  const leadId = opts.messageType === "dm"
    ? await findOrCreateLead(opts.senderId, profile, opts.accountName)
    : null;

  // Insert into instagram_messages (legacy table — used for both DMs & comments)
  await supabase.from("instagram_messages").insert({
    instagram_account_id: opts.accountId,
    instagram_account_config_id: opts.accountConfigId,
    sender_id: opts.senderId,
    sender_name: profile.name ?? opts.senderName,
    sender_username: profile.username ?? opts.senderUsername,
    sender_profile_pic: profile.profile_pic,
    message_text: opts.text,
    message_type: opts.messageType,
    post_id: opts.postId,
    comment_id: opts.commentId,
    is_outbound: false,
    is_read: false,
    lead_id: leadId,
  });

  // Mirror into unified messages table for chat UI
  if (leadId) {
    await supabase.from("messages").insert({
      lead_id: leadId,
      direction: "inbound",
      type: "text",
      content: opts.text,
      channel: "instagram",
      instagram_message_id: opts.igMessageId,
      instagram_sender_id: opts.senderId,
      status: "received",
    });

    // Update lead last_message
    await supabase
      .from("crm_leads")
      .update({
        last_message: opts.text,
        last_message_at: new Date().toISOString(),
        last_inbound_at: new Date().toISOString(),
      })
      .eq("id", leadId);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);

  // GET — Meta verification
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === VERIFY_TOKEN && challenge) {
      return new Response(challenge, { status: 200, headers: corsHeaders });
    }
    return new Response("Forbidden", { status: 403, headers: corsHeaders });
  }

  if (req.method === "POST") {
    const rawBody = await req.text();
    const signature = req.headers.get("x-hub-signature-256");

    const valid = await verifySignature(rawBody, signature);
    if (!valid) {
      console.warn("[instagram-webhook] Invalid signature");
      return new Response("OK", { status: 200, headers: corsHeaders });
    }

    try {
      const payload = JSON.parse(rawBody);
      console.log("[instagram-webhook] payload:", JSON.stringify(payload));

      const entries = Array.isArray(payload?.entry) ? payload.entry : [];

      // Global kill-switch: if integrations row 'instagram_global' is disabled, ignore all events
      const { data: globalIntegration } = await supabase
        .from("integrations")
        .select("status")
        .eq("key", "instagram_global")
        .maybeSingle();
      if (globalIntegration?.status === "disabled") {
        console.log("[instagram-webhook] Global Instagram integration is disabled. Skipping payload.");
        return new Response("OK", { status: 200, headers: corsHeaders });
      }

      for (const entry of entries) {
        const accountId: string = String(entry?.id ?? "");

        const { data: accountConfig } = await supabase
          .from("instagram_accounts")
          .select("id, name, page_access_token, is_active")
          .eq("instagram_account_id", accountId)
          .maybeSingle();

        // Per-account kill-switch
        if (accountConfig && accountConfig.is_active === false) {
          console.log(`[instagram-webhook] Account ${accountId} is inactive. Skipping entry.`);
          continue;
        }

        const accessToken = accountConfig?.page_access_token ?? null;
        const accountName = accountConfig?.name ?? null;
        const accountConfigId = accountConfig?.id ?? null;

        // entry.messaging — Direct Messages
        const messagingArr = Array.isArray(entry?.messaging) ? entry.messaging : [];
        for (const m of messagingArr) {
          if (!m?.message || m?.message?.is_echo) continue;
          const senderId = String(m?.sender?.id ?? "");
          if (!senderId) continue;
          const text = m?.message?.text ?? null;
          const igMessageId = m?.message?.mid ?? null;

          await persistMessage({
            accountId,
            accountConfigId,
            accountName,
            accessToken,
            senderId,
            senderUsername: null,
            senderName: null,
            text,
            messageType: "dm",
            postId: null,
            commentId: null,
            igMessageId,
          });
        }

        // entry.changes — comments / messages alt format
        const changes = Array.isArray(entry?.changes) ? entry.changes : [];
        for (const change of changes) {
          const field = change?.field;
          const value = change?.value ?? {};

          if (field === "messages") {
            const senderId = String(value?.sender?.id ?? value?.from?.id ?? "");
            if (!senderId) continue;
            const senderUsername = value?.sender?.username ?? value?.from?.username ?? null;
            const text = value?.message?.text ?? value?.text ?? null;
            const igMessageId = value?.message?.mid ?? value?.mid ?? null;

            await persistMessage({
              accountId,
              accountConfigId,
              accountName,
              accessToken,
              senderId,
              senderUsername,
              senderName: null,
              text,
              messageType: "dm",
              postId: null,
              commentId: null,
              igMessageId,
            });
          } else if (field === "comments") {
            const senderId = String(value?.from?.id ?? "");
            if (!senderId) continue;
            const senderUsername = value?.from?.username ?? null;
            const senderName = value?.from?.name ?? null;
            const text = value?.text ?? value?.message ?? null;
            const commentId = value?.id ?? null;
            const postId = value?.media?.id ?? value?.post_id ?? null;

            await persistMessage({
              accountId,
              accountConfigId,
              accountName,
              accessToken,
              senderId,
              senderUsername,
              senderName,
              text,
              messageType: "comment",
              postId,
              commentId,
              igMessageId: null,
            });
          }
        }
      }
    } catch (err) {
      console.error("[instagram-webhook] error processing payload:", err);
    }

    return new Response("OK", { status: 200, headers: corsHeaders });
  }

  return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
});
