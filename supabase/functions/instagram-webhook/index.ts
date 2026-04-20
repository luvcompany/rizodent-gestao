import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hub-signature-256",
};

const GRAPH_VERSION = "v25.0";

async function enrichSender(
  supabase: ReturnType<typeof createClient>,
  messageId: string,
  instagramAccountId: string,
  senderId: string,
) {
  try {
    const { data: account } = await supabase
      .from("instagram_accounts")
      .select("page_access_token")
      .eq("instagram_account_id", instagramAccountId)
      .maybeSingle();
    const token = (account as { page_access_token?: string } | null)?.page_access_token;
    if (!token || !senderId) return;
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${senderId}?fields=name,profile_pic&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) {
      console.warn("[ig-webhook] enrichSender API error:", data);
      return;
    }
    await supabase
      .from("instagram_messages")
      .update({
        sender_name: data.name ?? null,
        sender_profile_pic: data.profile_pic ?? null,
      })
      .eq("id", messageId);
  } catch (e) {
    console.warn("[ig-webhook] enrichSender exception:", e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);

  // GET: Meta verification
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const verifyToken = Deno.env.get("INSTAGRAM_VERIFY_TOKEN");

    if (mode === "subscribe" && token === verifyToken && challenge) {
      return new Response(challenge, { status: 200, headers: corsHeaders });
    }
    return new Response("Forbidden", { status: 403, headers: corsHeaders });
  }

  if (req.method === "POST") {
    try {
      const rawBody = await req.text();
      const signature = req.headers.get("x-hub-signature-256") ?? "";
      const secret = Deno.env.get("INSTAGRAM_APP_SECRET")
        ?? Deno.env.get("META_APP_SECRET")
        ?? "";

      const encoder = new TextEncoder();
      const cryptoKey = await crypto.subtle.importKey(
        "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
      );
      const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(rawBody));
      const computedHex = Array.from(new Uint8Array(signatureBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const computedSignature = `sha256=${computedHex}`;

      console.log("[ig-webhook] signature received:", signature);
      console.log("[ig-webhook] signature computed:", computedSignature);

      if (signature !== computedSignature) {
        console.warn("[ig-webhook] invalid signature - rejecting");
        return new Response("Forbidden", { status: 403 });
      }

      const payload = JSON.parse(rawBody);
      console.log("[ig-webhook] payload received:", JSON.stringify(payload));
      console.log("[ig-webhook] rawBody preview:", rawBody.substring(0, 50));

      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

      for (const entry of payload.entry ?? []) {
        const accountId = String(entry.id ?? "");

        for (const m of entry.messaging ?? []) {
          if (!m.message || m.message.is_echo) continue;
          const senderId = String(m.sender?.id ?? "");
          const { data: inserted } = await supabase
            .from("instagram_messages")
            .insert({
              instagram_account_id: accountId,
              sender_id: senderId,
              sender_name: m.sender?.name ?? null,
              message_text: m.message?.text ?? null,
              message_type: "dm",
              post_id: null,
              comment_id: null,
              is_read: false,
              is_outbound: false,
              lead_id: null,
            })
            .select("id")
            .maybeSingle();
          if (inserted?.id && senderId) {
            await enrichSender(supabase, inserted.id, accountId, senderId);
          }
        }

        for (const change of entry.changes ?? []) {
          const field = change.field;
          const v = change.value ?? {};

          if (field === "messages") {
            const senderId = String(v.sender?.id ?? v.from?.id ?? "");
            const { data: inserted } = await supabase
              .from("instagram_messages")
              .insert({
                instagram_account_id: accountId,
                sender_id: senderId,
                sender_name: v.sender?.name ?? v.from?.username ?? null,
                message_text: v.message?.text ?? v.text ?? null,
                message_type: "dm",
                post_id: null,
                comment_id: null,
                is_read: false,
                is_outbound: false,
                lead_id: null,
              })
              .select("id")
              .maybeSingle();
            if (inserted?.id && senderId) {
              await enrichSender(supabase, inserted.id, accountId, senderId);
            }
          } else if (field === "comments") {
            const senderId = String(v.from?.id ?? "");
            const { data: inserted } = await supabase
              .from("instagram_messages")
              .insert({
                instagram_account_id: accountId,
                sender_id: senderId,
                sender_name: v.from?.username ?? v.from?.name ?? null,
                message_text: v.text ?? null,
                message_type: "comment",
                post_id: v.media?.id ?? v.post_id ?? null,
                comment_id: v.id ?? null,
                is_read: false,
                is_outbound: false,
                lead_id: null,
              })
              .select("id")
              .maybeSingle();
            if (inserted?.id && senderId) {
              await enrichSender(supabase, inserted.id, accountId, senderId);
            }
          }
        }
      }

      return new Response("ok", { status: 200, headers: corsHeaders });
    } catch (err) {
      console.error("[ig-webhook] error", err);
      return new Response("ok", { status: 200, headers: corsHeaders });
    }
  }

  return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
});
