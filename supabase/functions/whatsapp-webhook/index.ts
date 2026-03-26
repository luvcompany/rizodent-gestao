import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MEDIA_TYPES = new Set(["image", "audio", "document", "video", "sticker"]);

async function downloadAndStoreMedia(
  mediaId: string,
  msgType: string,
  whatsappToken: string,
  supabase: any
): Promise<string | null> {
  try {
    console.log(`[MEDIA] Buscando media_id: ${mediaId}`);

    // Step 1: Get temporary URL from Meta
    const metaRes = await fetch(`https://graph.facebook.com/v25.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${whatsappToken}` },
    });
    const metaText = await metaRes.text();
    let metaData: any;
    try { metaData = JSON.parse(metaText); } catch { metaData = metaText; }
    console.log(`[MEDIA] Resposta da Meta ao buscar mídia: ${JSON.stringify(metaData)}`);

    if (!metaRes.ok) {
      console.error(`[MEDIA] ERRO ao buscar media_id ${mediaId}: status ${metaRes.status}`);
      return null;
    }

    const downloadUrl = metaData.url;
    const mimeType = metaData.mime_type || "application/octet-stream";

    if (!downloadUrl) {
      console.error(`[MEDIA] Sem URL de download na resposta da Meta: ${JSON.stringify(metaData)}`);
      return null;
    }

    // Step 2: Download the file
    console.log(`[MEDIA] Fazendo download da URL: ${downloadUrl}`);
    const fileRes = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${whatsappToken}` },
    });
    if (!fileRes.ok) {
      console.error(`[MEDIA] ERRO ao baixar arquivo: status ${fileRes.status}, body: ${await fileRes.text()}`);
      return null;
    }
    const fileBlob = await fileRes.blob();
    console.log(`[MEDIA] Download concluído: ${fileBlob.size} bytes, tipo: ${mimeType}`);

    // Determine extension from mime type
    const extMap: Record<string, string> = {
      "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
      "audio/ogg": "ogg", "audio/ogg; codecs=opus": "ogg", "audio/mpeg": "mp3",
      "audio/mp4": "m4a", "audio/amr": "amr",
      "video/mp4": "mp4", "video/3gpp": "3gp",
      "application/pdf": "pdf",
      "application/vnd.ms-excel": "xls",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    };
    const ext = extMap[mimeType] || mimeType.split("/").pop() || "bin";
    const path = `${msgType}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

    // Step 3: Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from("chat-media")
      .upload(path, fileBlob, { contentType: mimeType });

    if (uploadError) {
      console.error(`[MEDIA] ERRO upload Supabase Storage: ${JSON.stringify(uploadError)}`);
      return null;
    }

    const { data } = supabase.storage.from("chat-media").getPublicUrl(path);
    console.log(`[MEDIA] Upload para Supabase: sucesso, path=${path}, URL=${data.publicUrl}`);
    return data.publicUrl;
  } catch (err) {
    console.error(`[MEDIA] ERRO inesperado ao processar media_id ${mediaId}: ${err.message}`, err);
    return null;
  }
}

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

          // Filter by configured phone_number_id
          const incomingPhoneNumberId = value?.metadata?.phone_number_id;
          if (incomingPhoneNumberId) {
            const { data: integration } = await supabase
              .from("integrations")
              .select("config")
              .eq("key", "whatsapp_config")
              .maybeSingle();

            const configuredPhoneNumberId = (integration?.config as any)?.phone_number_id;
            if (configuredPhoneNumberId && configuredPhoneNumberId !== incomingPhoneNumberId) {
              console.log(`[WEBHOOK] Ignorando: phone_number_id ${incomingPhoneNumberId} != configurado ${configuredPhoneNumberId}`);
              continue;
            }
          }

          // Extract contact name from payload
          const contacts = value?.contacts || [];
          const contactName = contacts[0]?.profile?.name || null;

          // Handle incoming messages
          const messages = value?.messages || [];
          for (const msg of messages) {
            const from = msg.from; // sender phone number
            const msgType = msg.type || "text";
            let content = "";
            let mediaId: string | null = null;

            switch (msgType) {
              case "text":
                content = msg.text?.body || "";
                break;
              case "image":
                content = msg.image?.caption || "";
                mediaId = msg.image?.id || null;
                break;
              case "audio":
                mediaId = msg.audio?.id || null;
                break;
              case "video":
                content = msg.video?.caption || "";
                mediaId = msg.video?.id || null;
                break;
              case "document":
                content = msg.document?.caption || msg.document?.filename || "";
                mediaId = msg.document?.id || null;
                break;
              case "sticker":
                mediaId = msg.sticker?.id || null;
                break;
              case "template":
                content = "[template]";
                break;
              default:
                content = `[${msgType}]`;
                break;
            }

            // Download and store media if present
            let mediaUrl: string | null = null;
            const whatsappToken = Deno.env.get("WHATSAPP_TOKEN") || "";
            if (mediaId && MEDIA_TYPES.has(msgType)) {
              mediaUrl = await downloadAndStoreMedia(mediaId, msgType, whatsappToken, supabase);
            }

            // Find or create lead by phone
            let { data: lead } = await supabase
              .from("crm_leads")
              .select("id, name")
              .eq("phone", from)
              .maybeSingle();

            if (!lead) {
              // Use contact name from Meta payload, fallback to phone
              const leadName = contactName || `Lead WhatsApp ${from}`;

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
                      name: leadName,
                      phone: from,
                      pipeline_id: pipeline.id,
                      stage_id: stage.id,
                      source: "whatsapp",
                    })
                    .select("id, name")
                    .single();

                  lead = newLead;
                  console.log(`[WEBHOOK] Lead criado: ${leadName} (${from}), id: ${newLead?.id}`);
                }
              }
            } else if (contactName && lead.name.startsWith("Lead WhatsApp ")) {
              // Update auto-generated name with real contact name (don't overwrite manual edits)
              await supabase.from("crm_leads").update({ name: contactName }).eq("id", lead.id);
              console.log(`[WEBHOOK] Nome do lead atualizado: "${lead.name}" → "${contactName}"`);
              lead = { ...lead, name: contactName };
            }

            if (lead) {
              const insertPayload = {
                lead_id: lead.id,
                direction: "inbound",
                type: msgType,
                content: content || null,
                media_url: mediaUrl,
                status: "received",
              };
              const { data: savedMsg, error: insertErr } = await supabase.from("messages").insert(insertPayload).select().single();

              if (insertErr) {
                console.error(`[WEBHOOK] ERRO ao salvar mensagem: ${JSON.stringify(insertErr)}`);
              } else {
                console.log(`[WEBHOOK] Mensagem salva: ${JSON.stringify(savedMsg)}`);
              }

              await supabase.from("crm_leads").update({
                last_message: content || `[${msgType}]`,
                last_message_at: new Date().toISOString(),
              }).eq("id", lead.id);

              console.log(`[WEBHOOK] Message received from ${from}, lead ${lead.id}, type: ${msgType}, media_url: ${mediaUrl}`);
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
