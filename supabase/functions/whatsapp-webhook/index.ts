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

    const verifyToken = Deno.env.get("WHATSAPP_VERIFY_TOKEN") || "";

    if (mode === "subscribe" && token === verifyToken) {
      console.log("Webhook verified successfully");
      return new Response(challenge, { status: 200, headers: corsHeaders });
    }
    console.log("Webhook verification failed", { mode, tokenMatch: token === verifyToken });
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
            let mediaUrl: string | null = null;

            switch (msgType) {
              case "text":
                content = msg.text?.body || "";
                break;
              case "image":
                content = msg.image?.caption || "";
                mediaUrl = msg.image?.id || null;
                break;
              case "audio":
                mediaUrl = msg.audio?.id || null;
                break;
              case "document":
                content = msg.document?.caption || msg.document?.filename || "";
                mediaUrl = msg.document?.id || null;
                break;
              case "sticker":
                mediaUrl = msg.sticker?.id || null;
                break;
              case "template":
                content = "[template]";
                break;
              default:
                content = `[${msgType}]`;
                break;
            }

            // Find or create lead by phone
            let { data: lead } = await supabase
              .from("crm_leads")
              .select("id")
              .eq("phone", from)
              .maybeSingle();

            if (!lead) {
              // Get first pipeline and its first stage to assign the new lead
              const { data: pipeline } = await supabase
                .from("crm_pipelines")
                .select("id")
                .limit(1)
                .single();

              if (pipeline) {
                const { data: stage } = await supabase
                  .from("crm_stages")
                  .select("id")
                  .eq("pipeline_id", pipeline.id)
                  .order("position", { ascending: true })
                  .limit(1)
                  .single();

                if (stage) {
                  const { data: newLead } = await supabase
                    .from("crm_leads")
                    .insert({
                      name: `Lead WhatsApp ${from}`,
                      phone: from,
                      pipeline_id: pipeline.id,
                      stage_id: stage.id,
                      source: "whatsapp",
                    })
                    .select("id")
                    .single();

                  lead = newLead;
                  console.log(`Auto-created lead for phone: ${from}, id: ${newLead?.id}`);
                }
              }
            }

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

              console.log(`Message received from ${from}, lead ${lead.id}, type: ${msgType}`);
            } else {
              console.log(`Could not find or create lead for phone: ${from}`);
            }
          }

          // Handle status updates
          const statuses = value?.statuses || [];
          for (const status of statuses) {
            const messageId = status.id;
            const statusValue = status.status; // sent, delivered, read, failed
            console.log(`Status update: ${messageId} -> ${statusValue}`);
          }
        }
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error("Error processing webhook:", err);
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  return new Response("Method not allowed", { status: 405, headers: corsHeaders });
});
