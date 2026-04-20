import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hub-signature-256",
};

async function verifySignature(rawBody: string, signatureHeader: string | null, appSecret: string) {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const provided = signatureHeader.slice("sha256=".length);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex === provided;
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

  // POST: receive events
  if (req.method === "POST") {
    try {
      const rawBody = await req.text();
      const signature = req.headers.get("x-hub-signature-256");
      const appSecret = Deno.env.get("META_APP_SECRET")!;

      const valid = await verifySignature(rawBody, signature, appSecret);
      if (!valid) {
        console.warn("[ig-webhook] invalid signature");
        return new Response("ok", { status: 200, headers: corsHeaders });
      }

      const payload = JSON.parse(rawBody);
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

      for (const entry of payload.entry ?? []) {
        const accountId = String(entry.id ?? "");

        // Messaging events (DMs)
        for (const m of entry.messaging ?? []) {
          if (!m.message || m.message.is_echo) continue;
          await supabase.from("instagram_messages").insert({
            instagram_account_id: accountId,
            sender_id: String(m.sender?.id ?? ""),
            sender_name: m.sender?.name ?? null,
            message_text: m.message?.text ?? null,
            message_type: "dm",
            post_id: null,
            comment_id: null,
            is_read: false,
            is_outbound: false,
            lead_id: null,
          });
        }

        // Changes (comments / messages field)
        for (const change of entry.changes ?? []) {
          const field = change.field;
          const v = change.value ?? {};

          if (field === "messages") {
            await supabase.from("instagram_messages").insert({
              instagram_account_id: accountId,
              sender_id: String(v.sender?.id ?? v.from?.id ?? ""),
              sender_name: v.sender?.name ?? v.from?.username ?? null,
              message_text: v.message?.text ?? v.text ?? null,
              message_type: "dm",
              post_id: null,
              comment_id: null,
              is_read: false,
              is_outbound: false,
              lead_id: null,
            });
          } else if (field === "comments") {
            await supabase.from("instagram_messages").insert({
              instagram_account_id: accountId,
              sender_id: String(v.from?.id ?? ""),
              sender_name: v.from?.username ?? v.from?.name ?? null,
              message_text: v.text ?? null,
              message_type: "comment",
              post_id: v.media?.id ?? v.post_id ?? null,
              comment_id: v.id ?? null,
              is_read: false,
              is_outbound: false,
              lead_id: null,
            });
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
