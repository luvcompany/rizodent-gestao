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

    // Try verify token from integrations table first, fallback to env var
    let verifyToken = Deno.env.get("WHATSAPP_VERIFY_TOKEN") || "";
    try {
      const { data: integrations } = await supabase
        .from("integrations")
        .select("config")
        .like("key", "whatsapp_%")
        .limit(10);
      if (integrations) {
        for (const intg of integrations) {
          const cfg = intg.config as any;
          if (cfg?.webhook_verify_token && cfg.webhook_verify_token === token) {
            verifyToken = cfg.webhook_verify_token;
            break;
          }
        }
      }
    } catch (e) {
      console.log("[WEBHOOK] Erro ao buscar verify token das integrações:", e);
    }

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

          // Find the matching integration by phone_number_id
          const incomingPhoneNumberId = value?.metadata?.phone_number_id;
          let matchedIntegration: any = null;

          if (incomingPhoneNumberId) {
            const { data: allIntegrations } = await supabase
              .from("integrations")
              .select("id, key, config")
              .like("key", "whatsapp_%");

            if (allIntegrations) {
              matchedIntegration = allIntegrations.find((intg: any) => {
                const cfg = intg.config as any;
                return cfg?.phone_number_id === incomingPhoneNumberId;
              });
            }

            if (!matchedIntegration) {
              console.log(`[WEBHOOK] Nenhuma integração encontrada para phone_number_id ${incomingPhoneNumberId}`);
              continue;
            }
            console.log(`[WEBHOOK] Integração encontrada: ${matchedIntegration.key} para phone_number_id ${incomingPhoneNumberId}`);
          }

          // Extract contact name and referral (ad) info from payload
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
              case "button":
                content = msg.button?.text || msg.button?.payload || "";
                break;
              case "interactive":
                if (msg.interactive?.type === "button_reply") {
                  content = msg.interactive.button_reply?.title || "";
                } else if (msg.interactive?.type === "list_reply") {
                  content = msg.interactive.list_reply?.title || msg.interactive.list_reply?.description || "";
                } else {
                  content = msg.interactive?.body?.text || JSON.stringify(msg.interactive || {});
                }
                break;
              case "reaction": {
                // Handle reactions: update the target message's reactions column instead of inserting a new message
                const reactionEmoji = msg.reaction?.emoji || "";
                const reactionWamid = msg.reaction?.message_id;
                if (reactionWamid) {
                  const { data: targetMsg } = await supabase
                    .from("messages")
                    .select("id, reactions")
                    .eq("whatsapp_message_id", reactionWamid)
                    .maybeSingle();
                  if (targetMsg) {
                    const existing = Array.isArray(targetMsg.reactions) ? targetMsg.reactions : [];
                    if (reactionEmoji) {
                      // Add reaction
                      const updated = [...existing, { emoji: reactionEmoji, from: from }];
                      await supabase.from("messages").update({ reactions: updated }).eq("id", targetMsg.id);
                    } else {
                      // Empty emoji = remove reaction from this sender
                      const updated = existing.filter((r: any) => r.from !== from);
                      await supabase.from("messages").update({ reactions: updated }).eq("id", targetMsg.id);
                    }
                    console.log(`[WEBHOOK] Reaction ${reactionEmoji || "removed"} on message ${targetMsg.id}`);
                  }
                }
                continue; // Skip normal message insertion for reactions
              }
              case "location":
                content = `📍 Localização: ${msg.location?.latitude}, ${msg.location?.longitude}`;
                if (msg.location?.name) content = `📍 ${msg.location.name}`;
                break;
              case "contacts":
                const contactInfo = msg.contacts?.[0];
                content = contactInfo?.name?.formatted_name || "Contato compartilhado";
                if (contactInfo?.phones?.[0]?.phone) content += ` (${contactInfo.phones[0].phone})`;
                break;
              case "order":
                content = "📦 Pedido recebido";
                break;
              case "referral":
                content = msg.referral?.body || "Referência de anúncio";
                break;
              case "template":
                content = "[template]";
                break;
              default:
                content = msg[msgType]?.body || msg[msgType]?.text || msg[msgType]?.caption || `[${msgType}]`;
                break;
            }

            // Extract referral (ad) info - Meta sends this alongside the message when lead comes from an ad
            const referral = msg.referral || null;
            const adHeadline = referral?.headline || referral?.body || null;
            const adSourceUrl = referral?.source_url || null;
            const adSourceId = referral?.source_id || null;

            // Download and store media if present
            let mediaUrl: string | null = null;
            // Use token from matched integration config, fallback to env var
            const whatsappToken = (matchedIntegration?.config as any)?.access_token || Deno.env.get("WHATSAPP_TOKEN") || "";
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
              const leadName = contactName || `Lead WhatsApp ${from}`;

              // Find pipeline linked to this integration via funnel_channels
              let pipelineId: string | null = null;
              if (matchedIntegration) {
                const { data: funnelChannel } = await supabase
                  .from("funnel_channels")
                  .select("pipeline_id")
                  .eq("channel_type", "whatsapp")
                  .eq("channel_config->>integration_key", matchedIntegration.key)
                  .maybeSingle();
                if (funnelChannel) {
                  pipelineId = funnelChannel.pipeline_id;
                  console.log(`[WEBHOOK] Pipeline do funnel_channels: ${pipelineId}`);
                }
              }

              if (!pipelineId) {
                const { data: fallbackPipeline } = await supabase
                  .from("crm_pipelines")
                  .select("id")
                  .limit(1)
                  .single();
                pipelineId = fallbackPipeline?.id || null;
              }

              if (pipelineId) {
                const { data: stage } = await supabase
                  .from("crm_stages")
                  .select("id")
                  .eq("pipeline_id", pipelineId)
                  .order("position", { ascending: true })
                  .limit(1)
                  .single();

                if (stage) {
                  const insertData: any = {
                      name: leadName,
                      phone: from,
                      pipeline_id: pipelineId,
                      stage_id: stage.id,
                      source: referral ? "facebook_ad" : "whatsapp",
                  };
                  if (adHeadline) insertData.nome_anuncio = adHeadline;

                  const { data: newLead } = await supabase
                    .from("crm_leads")
                    .insert(insertData)
                    .select("id, name")
                    .single();

                  lead = newLead;
                  console.log(`[WEBHOOK] Lead criado: ${leadName} (${from}), pipeline: ${pipelineId}, id: ${newLead?.id}, anuncio: ${adHeadline || 'N/A'}`);
                }
              }
            } else {
              // Existing lead - update name if auto-generated, and update ad info if referral present
              const updates: any = {};
              if (contactName && lead.name.startsWith("Lead WhatsApp ")) {
                updates.name = contactName;
              }
              if (referral && adHeadline) {
                updates.nome_anuncio = adHeadline;
                if (!lead.source || lead.source === "whatsapp") updates.source = "facebook_ad";
              }
              if (Object.keys(updates).length > 0) {
                await supabase.from("crm_leads").update(updates).eq("id", lead.id);
                console.log(`[WEBHOOK] Lead ${lead.id} atualizado:`, JSON.stringify(updates));
                lead = { ...lead, ...updates };
              }
            }

            if (lead) {
              // Resolve reply_to_message_id from WhatsApp context
              let replyToMessageId = null;
              if (msg.context?.id) {
                const { data: replyTarget } = await supabase
                  .from("messages")
                  .select("id")
                  .eq("whatsapp_message_id", msg.context.id)
                  .maybeSingle();
                replyToMessageId = replyTarget?.id || null;
              }

              const insertPayload = {
                lead_id: lead.id,
                direction: "inbound",
                type: msgType,
                content: content || null,
                media_url: mediaUrl,
                status: "received",
                whatsapp_message_id: msg.id || null,
                reply_to_message_id: replyToMessageId,
              };
              const { data: savedMsg, error: insertErr } = await supabase.from("messages").insert(insertPayload).select().single();

              if (insertErr) {
                console.error(`[WEBHOOK] ERRO ao salvar mensagem: ${JSON.stringify(insertErr)}`);
              } else {
                console.log(`[WEBHOOK] Mensagem salva: ${JSON.stringify(savedMsg)}`);
              }

              // Update lead with last message info + last_inbound_at + reset follow_up_count
              await supabase.from("crm_leads").update({
                last_message: content || `[${msgType}]`,
                last_message_at: new Date().toISOString(),
                last_inbound_at: new Date().toISOString(),
                follow_up_count: 0,
              }).eq("id", lead.id);

              console.log(`[WEBHOOK] Message received from ${from}, lead ${lead.id}, type: ${msgType}, media_url: ${mediaUrl}`);

              // Trigger bot-engine for inbound message (fire-and-forget)
              try {
                const botUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/bot-engine`;
                fetch(botUrl, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                  },
                  body: JSON.stringify({
                    leadId: lead.id,
                    trigger: "inbound_message",
                    message: content || "",
                  }),
                }).catch(e => console.error("[WEBHOOK] Erro ao chamar bot-engine:", e));
              } catch (botErr) {
                console.error("[WEBHOOK] Erro ao preparar chamada bot-engine:", botErr);
              }
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
