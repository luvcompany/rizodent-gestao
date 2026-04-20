import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hub-signature-256",
};


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
      // Ler o body como texto RAW primeiro - obrigatório para validar assinatura
      const rawBody = await req.text();

      // Verificar assinatura do Meta
      const signature = req.headers.get("x-hub-signature-256") ?? "";
      const secret = Deno.env.get("INSTAGRAM_APP_SECRET")
        ?? Deno.env.get("META_APP_SECRET")
        ?? "";

      const encoder = new TextEncoder();
      const keyData = encoder.encode(secret);
      const msgData = encoder.encode(rawBody);

      const cryptoKey = await crypto.subtle.importKey(
        "raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
      );

      const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, msgData);

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

      // Só aqui fazer o parse do JSON
      const payload = JSON.parse(rawBody);

      console.log("[ig-webhook] payload received:", JSON.stringify(payload));
      console.log("[ig-webhook] rawBody preview:", rawBody.substring(0, 50));
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
