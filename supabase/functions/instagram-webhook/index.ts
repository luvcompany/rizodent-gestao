// Instagram Lite Webhook — independente da integração Meta API antiga.
// Lê contas da tabela `ig_accounts` (manuais) e processa DMs/comments
// usando o access_token salvo por conta.
//
// Mensagens são gravadas em `instagram_messages` para aparecerem na aba
// Conversas → Instagram → (Direct | Comentários), igual ao webhook oficial.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hub-signature-256",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VERIFY_TOKEN_V1 = Deno.env.get("INSTAGRAM_LITE_VERIFY_TOKEN") ?? Deno.env.get("INSTAGRAM_VERIFY_TOKEN") ?? "";
const VERIFY_TOKEN_V2 = Deno.env.get("INSTAGRAM_VERIFY_TOKEN_V2") ?? "";

async function verifyMetaSignature(rawBody: string, signature: string | null, appSecret: string): Promise<boolean> {
  if (!appSecret) return false;
  if (!signature || !signature.startsWith("sha256=")) return false;
  const sigHex = signature.slice("sha256=".length);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const computed = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  if (computed.length !== sigHex.length) return false;
  let mismatch = 0;
  for (let i = 0; i < computed.length; i++) mismatch |= computed.charCodeAt(i) ^ sigHex.charCodeAt(i);
  return mismatch === 0;
}



const supabase = createClient(supabaseUrl, serviceRoleKey);

interface IgAccountRow {
  id: string;
  ig_user_id: string;
  username: string | null;
  access_token: string;
  active: boolean;
  token_expires_at: string | null;
  tenant_id: string;
}

const pipelineCache = new Map<string, string>();

async function resolveInstagramPipeline(tenantId: string): Promise<string | null> {
  if (pipelineCache.has(tenantId)) return pipelineCache.get(tenantId)!;
  // Genérico p/ qualquer tenant: a RPC garante/retorna o funil de Instagram (flag
  // is_instagram). Sem caso especial hardcoded da Rizodent.
  const { data, error } = await supabase.rpc("ensure_instagram_pipeline", { _tenant_id: tenantId });
  if (error || !data) {
    console.error("[ig-lite] ensure_instagram_pipeline failed", { tenantId, error });
    return null;
  }
  pipelineCache.set(tenantId, data as string);
  return data as string;
}

const profileCache = new Map<string, { name: string | null; username: string | null; profile_pic: string | null }>();

async function fetchIgProfile(igUserId: string, accessToken: string) {
  if (profileCache.has(igUserId)) return profileCache.get(igUserId)!;
  let out = { name: null as string | null, username: null as string | null, profile_pic: null as string | null };
  const isIgLite = accessToken.startsWith("IGAA");
  const base = isIgLite ? "https://graph.instagram.com/v21.0" : "https://graph.facebook.com/v25.0";
  const tryFetch = async (fields: string) => {
    try {
      const r = await fetch(`${base}/${igUserId}?fields=${fields}&access_token=${encodeURIComponent(accessToken)}`);
      const j = await r.json().catch(() => ({}) as any);
      if (!r.ok) {
        console.warn("[ig-lite] profile fetch failed", { igUserId, fields, status: r.status });
        return null;
      }
      return j as any;
    } catch (e) {
      console.warn("[ig-lite] fetchIgProfile error", igUserId, e);
      return null;
    }
  };
  const j1 = await tryFetch("name,username,profile_pic");
  if (j1) {
    out.name = j1?.name ?? null;
    out.username = j1?.username ?? null;
    out.profile_pic = j1?.profile_pic ?? null;
  }
  if (!out.username || !out.profile_pic) {
    const j2 = await tryFetch("username,profile_picture_url");
    if (j2) {
      out.username = out.username || j2?.username || null;
      out.profile_pic = out.profile_pic || j2?.profile_picture_url || null;
    }
  }
  profileCache.set(igUserId, out);
  return out;
}

async function findOrCreateLead(
  igUserId: string,
  profile: { name: string | null; username: string | null; profile_pic: string | null },
  accountUsername: string | null,
  igAccountId: string,
  tenantId: string,
): Promise<string | null> {
  if (!igUserId) return null;
  const pipelineId = await resolveInstagramPipeline(tenantId);
  if (!pipelineId) {
    console.error("[ig-lite] No pipeline for tenant", tenantId);
    return null;
  }

  const { data: identityRows } = await supabase
    .from("crm_lead_instagram_identities")
    .select("lead_id, crm_leads!inner(id, tenant_id)")
    .eq("ig_account_id", igAccountId)
    .eq("ig_scoped_user_id", igUserId);

  let existingId: string | null = null;
  if (Array.isArray(identityRows)) {
    for (const row of identityRows as any[]) {
      if (row?.crm_leads?.tenant_id === tenantId) {
        existingId = row.lead_id;
        break;
      }
    }
  }

  if (!existingId && profile.username) {
    const { data: byUsernameLead } = await supabase
      .from("crm_leads")
      .select("id")
      .eq("tenant_id", tenantId)
      .ilike("instagram_username", profile.username)
      .limit(1)
      .maybeSingle();
    existingId = byUsernameLead?.id ?? null;
  }

  if (!existingId) {
    const { data: legacy } = await supabase
      .from("crm_leads")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("instagram_user_id", igUserId)
      .maybeSingle();
    existingId = legacy?.id ?? null;
  }

  if (existingId) {
    const { data: existing } = await supabase
      .from("crm_leads")
      .select("id, instagram_username, instagram_profile_pic_url, name, is_blocked, tenant_id")
      .eq("id", existingId)
      .maybeSingle();
    if (existing && (existing as any).is_blocked) return null;
    if (existing && (existing as any).tenant_id !== tenantId) {
      existingId = null;
    } else if (existing) {
      const updates: Record<string, unknown> = {};
      if (profile.username && existing.instagram_username !== profile.username)
        updates.instagram_username = profile.username;
      if (profile.profile_pic && existing.instagram_profile_pic_url !== profile.profile_pic)
        updates.instagram_profile_pic_url = profile.profile_pic;
      if (existing.name?.startsWith("IG ")) {
        const better = profile.name || profile.username;
        if (better) updates.name = better;
      }
      if (Object.keys(updates).length > 0) await supabase.from("crm_leads").update(updates).eq("id", existing.id);
      await supabase
        .from("crm_lead_instagram_identities")
        .upsert(
          { lead_id: existing.id, ig_account_id: igAccountId, ig_scoped_user_id: igUserId, username: profile.username },
          { onConflict: "ig_account_id,ig_scoped_user_id" },
        );
      return existing.id;
    }
  }

  const { data: firstStage } = await supabase
    .from("crm_stages")
    .select("id")
    .eq("pipeline_id", pipelineId)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!firstStage) {
    console.error("[ig-lite] No stages in Instagram pipeline", { tenantId, pipelineId });
    return null;
  }

  const { data: created, error: createErr } = await supabase
    .from("crm_leads")
    .insert({
      name: profile.name || profile.username || `IG ${igUserId.slice(0, 8)}`,
      pipeline_id: pipelineId,
      stage_id: firstStage.id,
      tenant_id: tenantId,
      source: accountUsername ? `Instagram Lite (@${accountUsername})` : "Instagram Lite",
      instagram_user_id: igUserId,
      instagram_username: profile.username,
      instagram_profile_pic_url: profile.profile_pic,
    })
    .select("id")
    .single();

  if (createErr) {
    console.error("[ig-lite] Failed to create lead:", createErr);
    return null;
  }

  await supabase
    .from("crm_lead_instagram_identities")
    .upsert(
      { lead_id: created.id, ig_account_id: igAccountId, ig_scoped_user_id: igUserId, username: profile.username },
      { onConflict: "ig_account_id,ig_scoped_user_id" },
    );
  return created.id;
}

type Attachment = { type?: string; payload?: { url?: string; sticker_id?: string | number } };

async function downloadAndStoreIgMedia(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const mimeType = (res.headers.get("content-type") || blob.type || "image/jpeg").split(";")[0].trim();
    const extMap: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",
      "video/mp4": "mp4",
    };
    const ext = extMap[mimeType] || "jpg";
    const path = `instagram/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage
      .from("chat-media")
      .upload(path, blob, { contentType: mimeType, upsert: false });
    if (error) return null;
    return supabase.storage.from("chat-media").getPublicUrl(path).data.publicUrl;
  } catch {
    return null;
  }
}

function describeAttachments(
  attachments: Attachment[],
  replyToStoryUrl: string | null,
  fallbackText: string | null,
): { content: string; mediaUrl: string | null; msgType: string } {
  if (replyToStoryUrl && !attachments.length) {
    const txt = fallbackText?.trim() ? `\n💬 ${fallbackText.trim()}` : "";
    return { content: `📖 Resposta a story${txt}`, mediaUrl: replyToStoryUrl, msgType: "image" };
  }
  if (!attachments.length) return { content: fallbackText ?? "", mediaUrl: null, msgType: "text" };
  const att = attachments[0];
  const type = (att?.type ?? "").toLowerCase();
  const url = att?.payload?.url ?? null;
  const caption = fallbackText?.trim() ? `\n💬 ${fallbackText.trim()}` : "";
  const storyPrefix = replyToStoryUrl ? "📖 Resposta a story\n" : "";
  switch (type) {
    case "ig_reel":
    case "reel":
      return { content: `${storyPrefix}🎬 Reel compartilhado${caption}`, mediaUrl: url, msgType: "video" };
    case "share":
      return {
        content: `${storyPrefix}🔗 Publicação compartilhada${url ? `\n${url}` : ""}${caption}`,
        mediaUrl: url,
        msgType: "text",
      };
    case "story_mention":
      return { content: `📖 Menção em story${caption}`, mediaUrl: url, msgType: "image" };
    case "story_reply":
      return { content: `📖 Resposta a story${caption}`, mediaUrl: url, msgType: url ? "image" : "text" };
    case "image":
      return { content: `${storyPrefix}${fallbackText ?? ""}`, mediaUrl: url, msgType: "image" };
    case "video":
      return { content: `${storyPrefix}${fallbackText ?? ""}`, mediaUrl: url, msgType: "video" };
    case "audio":
      return { content: fallbackText ?? "", mediaUrl: url, msgType: "audio" };
    case "file":
      return { content: fallbackText ?? "Arquivo", mediaUrl: url, msgType: "document" };
    case "like_heart":
      return { content: "❤️", mediaUrl: null, msgType: "text" };
    default:
      if (type.includes("sticker") || att?.payload?.sticker_id) {
        return { content: `🩷 Figurinha${caption}`, mediaUrl: url, msgType: url ? "image" : "text" };
      }
      return {
        content: fallbackText ?? `📎 Anexo (${type || "desconhecido"})${url ? `\n${url}` : ""}`,
        mediaUrl: url,
        msgType: "text",
      };
  }
}

async function persistMessage(opts: {
  account: IgAccountRow;
  senderId: string;
  senderUsername: string | null;
  senderName: string | null;
  text: string | null;
  messageType: "dm" | "comment";
  postId: string | null;
  commentId: string | null;
  igMessageId: string | null;
  attachments?: Attachment[];
  replyToStoryUrl?: string | null;
}) {
  const profile = await fetchIgProfile(opts.senderId, opts.account.access_token);
  const finalName = profile.name ?? opts.senderName;
  const finalUsername = profile.username ?? opts.senderUsername;
  const finalPic = profile.profile_pic;

  const {
    content: describedContent,
    mediaUrl: rawMediaUrl,
    msgType,
  } = describeAttachments(opts.attachments ?? [], opts.replyToStoryUrl ?? null, opts.text);
  const finalContent = describedContent || opts.text || "";

  let mediaUrl = rawMediaUrl;
  if (rawMediaUrl && (msgType === "image" || msgType === "video") && !rawMediaUrl.includes("supabase.co")) {
    const stored = await downloadAndStoreIgMedia(rawMediaUrl);
    if (stored) mediaUrl = stored;
  }

  let postThumbnail: string | null = null;
  let postPermalink: string | null = null;
  if (opts.messageType === "comment" && opts.postId) {
    try {
      const isIgLite = opts.account.access_token.startsWith("IGAA");
      const base = isIgLite ? "https://graph.instagram.com/v21.0" : "https://graph.facebook.com/v25.0";
      const r = await fetch(
        `${base}/${opts.postId}?fields=media_type,media_url,thumbnail_url,permalink&access_token=${encodeURIComponent(opts.account.access_token)}`,
      );
      const j = await r.json().catch(() => ({}) as any);
      if (r.ok) {
        postThumbnail = j?.thumbnail_url || j?.media_url || null;
        postPermalink = j?.permalink || null;
      }
    } catch (e) {
      console.warn("[ig-lite] post fetch error", opts.postId, e);
    }
  }

  let leadId: string | null = null;
  leadId = await findOrCreateLead(
    opts.senderId,
    { name: finalName, username: finalUsername, profile_pic: finalPic },
    opts.account.username,
    opts.account.ig_user_id,
    opts.account.tenant_id,
  );
  if (leadId) {
    const { data: blockedCheck } = await supabase.from("crm_leads").select("is_blocked").eq("id", leadId).maybeSingle();
    if (blockedCheck && (blockedCheck as any).is_blocked) return;
  }

  await supabase.from("instagram_messages").insert({
    instagram_account_id: opts.account.ig_user_id,
    instagram_account_config_id: null,
    sender_id: opts.senderId,
    sender_name: finalName,
    sender_username: finalUsername,
    sender_profile_pic: finalPic,
    message_text: finalContent,
    message_type: opts.messageType,
    post_id: opts.postId,
    comment_id: opts.commentId,
    is_outbound: false,
    is_read: false,
    lead_id: leadId,
  });

  if (leadId) {
    const isComment = opts.messageType === "comment";
    const dedupeId = isComment ? opts.commentId : opts.igMessageId;
    // Dedupe: se a Meta reenviar o mesmo evento (mesmo instagram_message_id/comment_id),
    // não duplicar. Só descarta em caso de ID igual — IDs diferentes SEMPRE entram.
    if (dedupeId) {
      const { data: dup } = await supabase
        .from("messages")
        .select("id")
        .eq("instagram_message_id", dedupeId)
        .maybeSingle();
      if (dup?.id) {
        console.log(`[ig-webhook] Duplicate ${isComment ? "comment" : "message"} ${dedupeId} — skipping insert`);
        return;
      }
    }
    await supabase.from("messages").insert({
      lead_id: leadId,
      tenant_id: opts.account.tenant_id,
      direction: "inbound",
      type: isComment ? "comment" : msgType,
      content: finalContent,
      media_url: isComment ? null : (mediaUrl ?? null),
      channel: "instagram",
      instagram_message_id: isComment ? opts.commentId : opts.igMessageId,
      instagram_sender_id: opts.senderId,
      instagram_account_id: opts.account.ig_user_id,
      instagram_comment_id: isComment ? opts.commentId : null,
      instagram_post_id: isComment ? opts.postId : null,
      instagram_post_thumbnail: isComment ? postThumbnail : null,
      instagram_post_permalink: isComment ? postPermalink : null,
      status: "received",
    });
    await supabase
      .from("crm_leads")
      .update({
        last_message: isComment ? `[Comentário] ${finalContent}` : finalContent,
        last_message_at: new Date().toISOString(),
        last_inbound_at: new Date().toISOString(),
      })
      .eq("id", leadId);

    // Bot multi-passo no Instagram: se há uma execução esperando resposta (DM, não
    // comentário), aciona o "continue" no bot-engine (espelha o whatsapp-webhook).
    // O bot-engine só executa se bots.channels incluir 'instagram' (gate por canal).
    if (!isComment) {
      try {
        const { data: exec } = await supabase
          .from("bot_executions")
          .select("id")
          .eq("lead_id", leadId)
          .eq("status", "waiting_reply")
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if ((exec as any)?.id) {
          const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
          const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
          console.log(`[ig-webhook] Bot execution ${(exec as any).id} waiting for reply — triggering continue (lead ${leadId})`);
          await fetch(`${supabaseUrl}/functions/v1/bot-engine`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
            body: JSON.stringify({ leadId, trigger: "continue", executionId: (exec as any).id, replyText: finalContent || "" }),
          }).catch((e) => console.error("[ig-webhook] bot-engine continue error", e));
        }
      } catch (e) {
        console.error("[ig-webhook] bot continue check error", e);
      }
    }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);

  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const tokenOk = !!token && (token === VERIFY_TOKEN_V1 || token === VERIFY_TOKEN_V2);
    if (mode === "subscribe" && tokenOk && challenge)
      return new Response(challenge, { status: 200, headers: corsHeaders });
    return new Response("Forbidden", { status: 403, headers: corsHeaders });
  }

  if (req.method === "POST") {
    const rawBody = await req.text();
    const signature = req.headers.get("x-hub-signature-256");
    const appSecret = Deno.env.get("INSTAGRAM_APP_SECRET") || Deno.env.get("META_APP_SECRET") || "";
    const sigOk = await verifyMetaSignature(rawBody, signature, appSecret);
    if (!sigOk) {
      console.warn("[ig-webhook] Invalid or missing x-hub-signature-256");
      return new Response("Forbidden", { status: 403, headers: corsHeaders });
    }
    try {
      const payload = JSON.parse(rawBody);
      // LGPD: não logar payload completo (contém texto, sender_id, nomes).
      const entries = Array.isArray(payload?.entry) ? payload.entry : [];
      console.log(`[ig-webhook] payload received: ${entries.length} entry(ies)`);

      for (const entry of entries) {
        const accountId: string = String(entry?.id ?? "");
        if (!accountId) continue;

        const { data: account } = await supabase
          .from("ig_accounts")
          .select("id, ig_user_id, username, access_token, active, token_expires_at, tenant_id")
          .eq("ig_user_id", accountId)
          .maybeSingle();

        if (!account) continue;
        if (!account.active) continue;
        if (account.token_expires_at && new Date(account.token_expires_at).getTime() < Date.now()) continue;

        const acc = account as IgAccountRow;

        const messagingArr = Array.isArray(entry?.messaging) ? entry.messaging : [];
        for (const m of messagingArr) {
          if (!m?.message || m?.message?.is_echo) continue;
          const senderId = String(m?.sender?.id ?? "");
          if (!senderId || senderId === accountId) continue;
          await persistMessage({
            account: acc,
            senderId,
            senderUsername: null,
            senderName: null,
            text: m?.message?.text ?? null,
            messageType: "dm",
            postId: null,
            commentId: null,
            igMessageId: m?.message?.mid ?? null,
            attachments: Array.isArray(m?.message?.attachments) ? m.message.attachments : [],
            replyToStoryUrl: m?.message?.reply_to?.story?.url ?? null,
          });
        }

        const changes = Array.isArray(entry?.changes) ? entry.changes : [];
        for (const change of changes) {
          const field = change?.field;
          const value = change?.value ?? {};
          if (field === "messages") {
            const senderId = String(value?.sender?.id ?? value?.from?.id ?? "");
            if (!senderId || senderId === accountId) continue;
            await persistMessage({
              account: acc,
              senderId,
              senderUsername: value?.sender?.username ?? value?.from?.username ?? null,
              senderName: null,
              text: value?.message?.text ?? value?.text ?? null,
              messageType: "dm",
              postId: null,
              commentId: null,
              igMessageId: value?.message?.mid ?? value?.mid ?? null,
              attachments: Array.isArray(value?.message?.attachments)
                ? value.message.attachments
                : Array.isArray(value?.attachments)
                  ? value.attachments
                  : [],
              replyToStoryUrl: value?.message?.reply_to?.story?.url ?? value?.reply_to?.story?.url ?? null,
            });
          } else if (field === "comments") {
            const senderId = String(value?.from?.id ?? "");
            if (!senderId || senderId === accountId) continue;
            await persistMessage({
              account: acc,
              senderId,
              senderUsername: value?.from?.username ?? null,
              senderName: value?.from?.name ?? null,
              text: value?.text ?? value?.message ?? null,
              messageType: "comment",
              postId: value?.media?.id ?? value?.post_id ?? null,
              commentId: value?.id ?? null,
              igMessageId: null,
            });
          }
        }
      }
    } catch (err) {
      console.error("[ig-lite] error:", err);
    }

    return new Response("OK", { status: 200, headers: corsHeaders });
  }

  return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
});
