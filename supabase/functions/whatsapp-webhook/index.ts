import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // GET = webhook verification from Meta
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    // Load verify token from integrations table
    const { data: integration } = await supabase
      .from("integrations")
      .select("config")
      .eq("key", "whatsapp_config")
      .maybeSingle();

    const verifyToken = (integration?.config as any)?.webhook_verify_token || "";

    if (mode === "subscribe" && token === verifyToken) {
      return new Response(challenge, { status: 200, headers: corsHeaders });
    }
    return new Response("Forbidden", { status: 403, headers: corsHeaders });
  }

  // POST = incoming message
  if (req.method === "POST") {
    try {
      const body = await req.json();
      const entries = body?.entry || [];

      for (const entry of entries) {
        const changes = entry?.changes || [];
        for (const change of changes) {
          const value = change?.value;
          if (!value) continue;

          // Handle incoming messages
          const messages = value?.messages || [];
          for (const msg of messages) {
            const from = msg.from; // sender phone number
            const msgType = msg.type || "text";
            let content = "";
            let mediaUrl = null;

            if (msgType === "text") {
              content = msg.text?.body || "";
            } else if (msgType === "image") {
              content = msg.image?.caption || "";
              mediaUrl = msg.image?.id || null;
            } else if (msgType === "audio") {
              mediaUrl = msg.audio?.id || null;
            } else if (msgType === "sticker") {
              mediaUrl = msg.sticker?.id || null;
            }

            // Find lead by phone
            const { data: lead } = await supabase
              .from("crm_leads")
              .select("id")
              .eq("phone", from)
              .maybeSingle();

            if (lead) {
              await supabase.from("messages").insert({
                lead_id: lead.id,
                direction: "inbound",
                type: msgType,
                content: content || null,
                media_url: mediaUrl,
                status: "received",
              });

              await supabase.from("crm_leads").update({
                last_message: content || `[${msgType}]`,
                last_message_at: new Date().toISOString(),
              }).eq("id", lead.id);
            }
          }

          // Handle status updates
          const statuses = value?.statuses || [];
          for (const status of statuses) {
            // Could update message status here if we store wamid
          }
        }
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  return new Response("Method not allowed", { status: 405, headers: corsHeaders });
});
