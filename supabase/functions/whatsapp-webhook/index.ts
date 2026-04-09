import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MEDIA_TYPES = new Set(["image", "audio", "document", "video", "sticker"]);

async function resolveAutoAssignment(supabase: any, pipelineId: string): Promise<string | null> {
  try {
    const { data: rules } = await supabase
      .from("crm_automations")
      .select("action_config, is_active")
      .eq("action_type", "assign_lead")
      .eq("is_active", true);

    if (!rules || rules.length === 0) return null;

    const rule = rules.find((r: any) => (r.action_config as any)?.pipeline_id === pipelineId);
    if (!rule) return null;

    const cfg = rule.action_config as any;
    const eligible: string[] = cfg?.eligible_users || [];
    if (eligible.length === 0) return null;

    const method = cfg?.method || "round_robin";

    if (method === "least_load") {
      // Assign to user with fewest active leads in this pipeline
      const counts: Record<string, number> = {};
      for (const uid of eligible) counts[uid] = 0;
      const { data: leads } = await supabase
        .from("crm_leads")
        .select("assigned_to")
        .eq("pipeline_id", pipelineId)
        .in("assigned_to", eligible);
      if (leads) {
        for (const l of leads) {
          if (l.assigned_to && counts[l.assigned_to] !== undefined) counts[l.assigned_to]++;
        }
      }
      let min = Infinity, pick = eligible[0];
      for (const uid of eligible) {
        if (counts[uid] < min) { min = counts[uid]; pick = uid; }
      }
      return pick;
    }

    // Round-robin: count total leads assigned to each eligible user, pick the one with fewest
    const { data: allLeads } = await supabase
      .from("crm_leads")
      .select("assigned_to")
      .eq("pipeline_id", pipelineId)
      .in("assigned_to", eligible);

    const counts: Record<string, number> = {};
    for (const uid of eligible) counts[uid] = 0;
    if (allLeads) {
      for (const l of allLeads) {
        if (l.assigned_to && counts[l.assigned_to] !== undefined) counts[l.assigned_to]++;
      }
    }
    let min = Infinity, pick = eligible[0];
    for (const uid of eligible) {
      if (counts[uid] < min) { min = counts[uid]; pick = uid; }
    }
    return pick;
  } catch (e: any) {
    console.error("[ROUND-ROBIN] Erro:", e.message);
    return null;
  }
}

async function downloadAndStoreMedia(
  mediaId: string,
  msgType: string,
  whatsappToken: string,
  supabase: any
): Promise<string | null> {
  try {
    console.log(`[MEDIA] Buscando media_id: ${mediaId}`);
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
  } catch (err: any) {
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
              .select("id, key, config, status")
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

            // Check if integration is disabled
            if (matchedIntegration.status === "disabled") {
              console.log(`[WEBHOOK] Integração ${matchedIntegration.key} está DESATIVADA, ignorando webhook`);
              continue;
            }

            console.log(`[WEBHOOK] Integração encontrada: ${matchedIntegration.key} para phone_number_id ${incomingPhoneNumberId}`);
          }

          const contacts = value?.contacts || [];
          const contactName = contacts[0]?.profile?.name || null;

          const messages = value?.messages || [];
          for (const msg of messages) {
            const from = msg.from;
            const msgType = msg.type || "text";
            let content = "";
            let replyOptionId: string | null = null;
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
                replyOptionId = msg.button?.payload || null;
                break;
              case "interactive":
                if (msg.interactive?.type === "button_reply") {
                  content = msg.interactive.button_reply?.title || "";
                  replyOptionId = msg.interactive.button_reply?.id || null;
                } else if (msg.interactive?.type === "list_reply") {
                  content = msg.interactive.list_reply?.title || msg.interactive.list_reply?.description || "";
                  replyOptionId = msg.interactive.list_reply?.id || null;
                } else {
                  content = msg.interactive?.body?.text || JSON.stringify(msg.interactive || {});
                }
                break;
              case "reaction": {
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
                      const updated = [...existing, { emoji: reactionEmoji, from: from }];
                      await supabase.from("messages").update({ reactions: updated }).eq("id", targetMsg.id);
                    } else {
                      const updated = existing.filter((r: any) => r.from !== from);
                      await supabase.from("messages").update({ reactions: updated }).eq("id", targetMsg.id);
                    }
                    console.log(`[WEBHOOK] Reaction ${reactionEmoji || "removed"} on message ${targetMsg.id}`);
                  }
                }
                continue;
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

            // Extract referral (ad) info - comes in context.referral or msg.referral
            const referral = msg.referral || msg.context?.referral || null;
            let adHeadline = referral?.headline || null;
            let adBody = referral?.body || null;
            let adImageUrl = referral?.image_url || null;
            let adSourceUrl = referral?.source_url || null;
            let adSourceId = referral?.source_id || null;

            // Enrich ad data from Meta Graph API if we have an ad ID but missing image/link
            if (referral && adSourceId) {
              try {
                const metaToken = (matchedIntegration?.config as any)?.access_token || Deno.env.get("WHATSAPP_TOKEN") || "";
                console.log(`[AD-ENRICHMENT] Fetching ad creative for ad_id: ${adSourceId}`);
                const adRes = await fetch(
                  `https://graph.facebook.com/v25.0/${adSourceId}?fields=id,name,permalink_url,creative{thumbnail_url,image_url,object_story_spec}&access_token=${metaToken}`
                );
                if (adRes.ok) {
                  const adData = await adRes.json();
                  console.log(`[AD-ENRICHMENT] Ad data received:`, JSON.stringify(adData));

                  // Fill missing fields from the API response
                  if (!adHeadline && adData.name) adHeadline = adData.name;
                  if (!adSourceUrl && adData.permalink_url) adSourceUrl = adData.permalink_url;

                  const creative = adData.creative;
                  if (creative) {
                    // Try to get image from creative
                    if (!adImageUrl) {
                      adImageUrl = creative.image_url
                        || creative.thumbnail_url
                        || creative.object_story_spec?.link_data?.picture
                        || creative.object_story_spec?.link_data?.image_url
                        || creative.object_story_spec?.video_data?.image_url
                        || null;
                    }
                    // Try to get link from creative
                    if (!adSourceUrl) {
                      adSourceUrl = creative.object_story_spec?.link_data?.link || null;
                    }
                    // Try to get description from creative
                    if (!adBody) {
                      adBody = creative.object_story_spec?.link_data?.description
                        || creative.object_story_spec?.link_data?.message
                        || null;
                    }
                    if (!adHeadline) {
                      adHeadline = creative.object_story_spec?.link_data?.name || null;
                    }
                  }
                  console.log(`[AD-ENRICHMENT] Enriched: image=${adImageUrl}, link=${adSourceUrl}, headline=${adHeadline}`);
                } else {
                  const errText = await adRes.text();
                  console.log(`[AD-ENRICHMENT] Failed to fetch ad ${adSourceId}: ${adRes.status} - ${errText}`);
                }
              } catch (adErr: any) {
                console.log(`[AD-ENRICHMENT] Error enriching ad data: ${adErr.message}`);
              }
            }

            // Download and store media if present
            let mediaUrl: string | null = null;
            const whatsappToken = (matchedIntegration?.config as any)?.access_token || Deno.env.get("WHATSAPP_TOKEN") || "";
            if (mediaId && MEDIA_TYPES.has(msgType)) {
              mediaUrl = await downloadAndStoreMedia(mediaId, msgType, whatsappToken, supabase);
            }

            // Find or create lead by phone
            let { data: lead } = await supabase
              .from("crm_leads")
              .select("id, name, source")
              .eq("phone", from)
              .maybeSingle();

            if (!lead) {
              const leadName = contactName || `Lead WhatsApp ${from}`;

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
                  // Save ad referral data if present
                  if (referral) {
                    if (adHeadline) insertData.titulo_anuncio = adHeadline;
                    if (adHeadline) insertData.nome_anuncio = adHeadline;
                    if (adBody) insertData.descricao_anuncio = adBody;
                    if (adImageUrl) insertData.imagem_origem = adImageUrl;
                    if (adSourceUrl) insertData.link_anuncio = adSourceUrl;
                    if (adSourceId) insertData.ad_id = adSourceId;
                  }

                  // Round-robin / least-load assignment
                  const assignedTo = await resolveAutoAssignment(supabase, pipelineId);
                  if (assignedTo) {
                    insertData.assigned_to = assignedTo;
                    console.log(`[WEBHOOK] Round-robin atribuiu lead a: ${assignedTo}`);
                  }

                  const { data: newLead } = await supabase
                    .from("crm_leads")
                    .insert(insertData)
                    .select("id, name, source")
                    .single();

                  lead = newLead;
                  console.log(`[WEBHOOK] Lead criado: ${leadName} (${from}), pipeline: ${pipelineId}, id: ${newLead?.id}, assigned: ${assignedTo || 'none'}, anuncio: ${adHeadline || 'N/A'}, ad_id: ${adSourceId || 'N/A'}`);
                }
              }
            } else {
              // Existing lead - update name if auto-generated, and update ad info if referral present
              const updates: any = {};
              if (contactName && lead.name.startsWith("Lead WhatsApp ")) {
                updates.name = contactName;
              }
              if (referral) {
                if (adHeadline) {
                  updates.titulo_anuncio = adHeadline;
                  updates.nome_anuncio = adHeadline;
                }
                if (adBody) updates.descricao_anuncio = adBody;
                if (adImageUrl) updates.imagem_origem = adImageUrl;
                if (adSourceUrl) updates.link_anuncio = adSourceUrl;
                if (adSourceId) updates.ad_id = adSourceId;
                if (!lead.source || lead.source === "whatsapp") updates.source = "facebook_ad";
              }
              if (Object.keys(updates).length > 0) {
                await supabase.from("crm_leads").update(updates).eq("id", lead.id);
                console.log(`[WEBHOOK] Lead ${lead.id} atualizado:`, JSON.stringify(updates));
                lead = { ...lead, ...updates };
              }
            }

            if (lead) {
              let replyToMessageId = null;
              if (msg.context?.id) {
                const { data: replyTarget } = await supabase
                  .from("messages")
                  .select("id")
                  .eq("whatsapp_message_id", msg.context.id)
                  .maybeSingle();
                replyToMessageId = replyTarget?.id || null;
              }

              const insertPayload: any = {
                lead_id: lead.id,
                direction: "inbound",
                type: msgType,
                content: content || null,
                media_url: mediaUrl,
                status: "received",
                whatsapp_message_id: msg.id || null,
                reply_to_message_id: replyToMessageId,
                // Dados do anúncio (referral)
                ad_headline: adHeadline || null,
                ad_body: adBody || null,
                ad_image_url: adImageUrl || null,
                ad_source_url: adSourceUrl || null,
                ad_source_id: adSourceId || null,
              };
              const { data: savedMsg, error: insertErr } = await supabase.from("messages").insert(insertPayload).select().single();

              if (insertErr) {
                console.error(`[WEBHOOK] ERRO ao salvar mensagem: ${JSON.stringify(insertErr)}`);
              } else {
                console.log(`[WEBHOOK] Mensagem salva: ${JSON.stringify(savedMsg)}`);
              }

              // Build update payload — set first_inbound_at only if not already set
              const leadUpdate: any = {
                last_message: content || `[${msgType}]`,
                last_message_at: new Date().toISOString(),
                last_inbound_at: new Date().toISOString(),
                follow_up_count: 0,
              };
              // Check if first_inbound_at needs to be set (first ever inbound msg)
              const { data: currentLead } = await supabase
                .from("crm_leads")
                .select("first_inbound_at")
                .eq("id", lead.id)
                .single();
              if (!currentLead?.first_inbound_at) {
                leadUpdate.first_inbound_at = new Date().toISOString();
                console.log(`[WEBHOOK] Setting first_inbound_at for lead ${lead.id}`);
              }
              await supabase.from("crm_leads").update(leadUpdate).eq("id", lead.id);

              console.log(`[WEBHOOK] Message received from ${from}, lead ${lead.id}, type: ${msgType}, media_url: ${mediaUrl}`);


              // Check follow-up queue - mark as responded if active
              try {
                const { data: fqItems } = await supabase
                  .from("crm_followup_queue")
                  .select("id, config_id")
                  .eq("lead_id", lead.id)
                  .in("status", ["waiting_disparo1", "waiting_disparo2"])
                  .limit(10);

                if (fqItems && fqItems.length > 0) {
                  for (const fq of fqItems) {
                    // Get config for return_to_stage_id
                    const { data: fConfig } = await supabase
                      .from("crm_followup_configs")
                      .select("return_to_stage_id")
                      .eq("id", fq.config_id)
                      .single();

                    await supabase.from("crm_followup_queue").update({
                      status: "responded",
                      updated_at: new Date().toISOString(),
                    }).eq("id", fq.id);

                    if (fConfig?.return_to_stage_id) {
                      await supabase.from("crm_leads").update({
                        stage_id: fConfig.return_to_stage_id,
                        updated_at: new Date().toISOString(),
                      }).eq("id", lead.id);
                      console.log(`[WEBHOOK] Follow-up: lead ${lead.id} responded, moved to stage ${fConfig.return_to_stage_id}`);
                    }
                  }
                  console.log(`[WEBHOOK] Follow-up: marked ${fqItems.length} queue items as responded for lead ${lead.id}`);
                }
              } catch (fqErr: any) {
                console.error("[WEBHOOK] Erro ao verificar follow-up queue:", fqErr.message);
              }

              // Check for active bot execution waiting for reply
              try {
                const { data: botExec } = await supabase
                  .from("bot_executions")
                  .select("id")
                  .eq("lead_id", lead.id)
                  .eq("status", "waiting_reply")
                  .order("started_at", { ascending: false })
                  .limit(1)
                  .maybeSingle();

                if (botExec) {
                  console.log(`[WEBHOOK] Bot execution ${botExec.id} waiting for reply, triggering continue`);
                  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
                  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
                  // Call bot-engine to continue (consume response to prevent resource leak)
                  fetch(`${supabaseUrl}/functions/v1/bot-engine`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "Authorization": `Bearer ${serviceKey}`,
                      "apikey": serviceKey,
                    },
                    body: JSON.stringify({
                      leadId: lead.id,
                      trigger: "continue",
                      executionId: botExec.id,
                      replyText: content || "",
                      replyOptionId,
                    }),
                  }).then(async (res) => {
                    const body = await res.text();
                    console.log(`[WEBHOOK] Bot-engine continue response (${res.status}): ${body}`);
                  }).catch((err: any) => console.error("[WEBHOOK] Bot-engine continue error:", err.message));
                }
              } catch (botErr: any) {
                console.error("[WEBHOOK] Erro ao verificar bot execution:", botErr.message);
              }
            } else {
              console.log(`Could not find or create lead for phone: ${from}`);
            }
          }

          // Handle status updates
          const statuses = value?.statuses || [];
          for (const status of statuses) {
            const messageId = status.id;
            const statusValue = status.status;
            console.log(`Status update: ${messageId} -> ${statusValue}`);
          }
        }
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (error: any) {
      console.error("Webhook error:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  return new Response("Method not allowed", { status: 405, headers: corsHeaders });
});
