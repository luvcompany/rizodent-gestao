import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hub-signature-256",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VERIFY_TOKEN = Deno.env.get("INSTAGRAM_VERIFY_TOKEN") ?? "";
const APP_SECRET = Deno.env.get("INSTAGRAM_APP_SECRET") ?? "";

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

  // timing-safe compare
  if (computed.length !== sigHex.length) return false;
  let mismatch = 0;
  for (let i = 0; i < computed.length; i++) {
    mismatch |= computed.charCodeAt(i) ^ sigHex.charCodeAt(i);
  }
  return mismatch === 0;
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

  // POST — events
  if (req.method === "POST") {
    const rawBody = await req.text();
    const signature = req.headers.get("x-hub-signature-256");

    const valid = await verifySignature(rawBody, signature);
    if (!valid) {
      console.warn("[instagram-webhook] Invalid signature");
      // Always return 200 to Meta to avoid retries, but log it
      return new Response("OK", { status: 200, headers: corsHeaders });
    }

    try {
      const payload = JSON.parse(rawBody);
      console.log("[instagram-webhook] payload:", JSON.stringify(payload));

      const entries = Array.isArray(payload?.entry) ? payload.entry : [];

      for (const entry of entries) {
        const accountId: string = String(entry?.id ?? "");

        // Look up our config row to attach FK + log
        const { data: accountConfig } = await supabase
          .from("instagram_accounts")
          .select("id")
          .eq("instagram_account_id", accountId)
          .maybeSingle();

        // Instagram Messaging delivers messages under entry.messaging (not changes)
        const messagingArr = Array.isArray(entry?.messaging) ? entry.messaging : [];
        for (const m of messagingArr) {
          if (!m?.message || m?.message?.is_echo) continue;
          const senderId = String(m?.sender?.id ?? "");
          const text = m?.message?.text ?? null;

          await supabase.from("instagram_messages").insert({
            instagram_account_id: accountId,
            instagram_account_config_id: accountConfig?.id ?? null,
            sender_id: senderId,
            sender_name: null,
            message_text: text,
            message_type: "dm",
            post_id: null,
            comment_id: null,
            is_outbound: false,
            is_read: false,
            lead_id: null,
          });
        }

        // Comments / messages via "changes"
        const changes = Array.isArray(entry?.changes) ? entry.changes : [];
        for (const change of changes) {
          const field = change?.field;
          const value = change?.value ?? {};

          if (field === "messages") {
            const senderId = String(value?.sender?.id ?? value?.from?.id ?? "");
            const senderName = value?.sender?.username ?? value?.from?.username ?? null;
            const text = value?.message?.text ?? value?.text ?? null;

            await supabase.from("instagram_messages").insert({
              instagram_account_id: accountId,
              instagram_account_config_id: accountConfig?.id ?? null,
              sender_id: senderId,
              sender_name: senderName,
              message_text: text,
              message_type: "dm",
              post_id: null,
              comment_id: null,
              is_outbound: false,
              is_read: false,
              lead_id: null,
            });
          } else if (field === "comments") {
            const senderId = String(value?.from?.id ?? "");
            const senderName = value?.from?.username ?? value?.from?.name ?? null;
            const text = value?.text ?? value?.message ?? null;
            const commentId = value?.id ?? null;
            const postId = value?.media?.id ?? value?.post_id ?? null;

            await supabase.from("instagram_messages").insert({
              instagram_account_id: accountId,
              instagram_account_config_id: accountConfig?.id ?? null,
              sender_id: senderId,
              sender_name: senderName,
              message_text: text,
              message_type: "comment",
              post_id: postId,
              comment_id: commentId,
              is_outbound: false,
              is_read: false,
              lead_id: null,
            });
          }
        }
      }
    } catch (err) {
      console.error("[instagram-webhook] error processing payload:", err);
    }

    // Always 200 to Meta
    return new Response("OK", { status: 200, headers: corsHeaders });
  }

  return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
});
