import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MEDIA_TYPES = new Set(["image", "audio", "document", "video", "sticker"]);

// Centralized server-side action executor — always awaits to prevent runtime shutdown
async function executeWebhookAction(
  supabase: any,
  supabaseUrl: string,
  serviceKey: string,
  actionType: string,
  config: Record<string, any>,
  leadId: string,
  phone: string | null
) {
  try {
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}`, apikey: serviceKey };
    switch (actionType) {
      case "send_template":
        if (config.template_id && phone) {
          const { data: tpl } = await supabase.from("crm_whatsapp_templates").select("name, language").eq("id", config.template_id).single();
          if (tpl) {
            const r = await fetch(`${supabaseUrl}/functions/v1/send-whatsapp-message`, {
              method: "POST", headers,
              body: JSON.stringify({ lead_id: leadId, to: phone, type: "template", template_name: tpl.name, template_language: tpl.language }),
            });
            await r.text();
            console.log(`[WEBHOOK-ACTION] send_template ${tpl.name} to ${phone} => ${r.status}`);
          }
        }
        break;
      case "send_bot":
        if (config.bot_id) {
          const r = await fetch(`${supabaseUrl}/functions/v1/bot-engine`, {
            method: "POST", headers,
            body: JSON.stringify({ leadId, botId: config.bot_id, trigger: "automation" }),
          });
          await r.text();
          console.log(`[WEBHOOK-ACTION] send_bot ${config.bot_id} for lead ${leadId} => ${r.status}`);
        }
        break;
      case "send_audio":
        if (config.audio_url && phone) {
          const r = await fetch(`${supabaseUrl}/functions/v1/send-whatsapp-message`, {
            method: "POST", headers,
            body: JSON.stringify({ lead_id: leadId, to: phone, type: "audio", media_url: config.audio_url }),
          });
          await r.text();
        }
        break;
      case "send_file":
        if (config.file_url && phone) {
          const r = await fetch(`${supabaseUrl}/functions/v1/send-whatsapp-message`, {
            method: "POST", headers,
            body: JSON.stringify({ lead_id: leadId, to: phone, type: "document", media_url: config.file_url, filename: config.filename || "arquivo" }),
          });
          await r.text();
        }
        break;
      case "add_tag": {
        const tag = config.tag as string;
        if (tag) {
          const { data: ld } = await supabase.from("crm_leads").select("tags").eq("id", leadId).single();
          const existing = (ld?.tags || []) as string[];
          if (!existing.includes(tag)) {
            await supabase.from("crm_leads").update({ tags: [...existing, tag] }).eq("id", leadId);
          }
        }
        break;
      }
      case "notify_owner": {
        const { data: ld } = await supabase.from("crm_leads").select("assigned_to, name").eq("id", leadId).single();
        if (ld?.assigned_to) {
          await supabase.from("crm_notifications").insert({
            user_id: ld.assigned_to, lead_id: leadId,
            title: config.notification_title || "Automação disparada",
            body: config.notification_body || `Automação para ${ld.name}`,
            type: "automation",
          });
        }
        break;
      }
      case "move_stage":
        if (config.target_stage_id) {
          await supabase.from("crm_leads").update({ stage_id: config.target_stage_id }).eq("id", leadId);
        }
        break;
      case "combo": {
        const actions = (config.actions || []) as Array<{ action_type: string; action_config: Record<string, any> }>;
        for (const sub of actions) {
          await executeWebhookAction(supabase, supabaseUrl, serviceKey, sub.action_type, sub.action_config || {}, leadId, phone);
        }
        break;
      }
    }
  } catch (e: any) {
    console.error(`[WEBHOOK-ACTION] Error (${actionType}):`, e.message);
  }
}

// Execute on_enter stage automations server-side
async function executeOnEnterAutomations(supabase: any, leadId: string, stageId: string, phone: string | null) {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    const { data: automations } = await supabase
      .from("crm_automations")
      .select("*")
      .eq("stage_id", stageId)
      .eq("is_active", true)
      .eq("trigger_type", "on_enter");

    for (const auto of automations || []) {
      const config = (auto.action_config || {}) as Record<string, any>;
      console.log(`[WEBHOOK] on_enter automation ${auto.id} (${auto.action_type}) for lead ${leadId}`);
      await executeWebhookAction(supabase, supabaseUrl, serviceKey, auto.action_type, config, leadId, phone);
    }
  } catch (e: any) {
    console.error("[WEBHOOK] on_enter automations error:", e.message);
  }
}

// Default assignment: all leads go to Rizodent user
const DEFAULT_ASSIGNED_TO = "d9b27aa3-049e-4ec9-9ae3-fb160a9544fa";

async function resolveAutoAssignment(_supabase: any, _pipelineId: string): Promise<string | null> {
  return DEFAULT_ASSIGNED_TO;
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

            let adAccountId: string | null = null;
            let adAccountName: string | null = null;

            // Enrich ad data from Meta Graph API if we have an ad ID but missing image/link
            if (referral && adSourceId) {
              const metaToken = (matchedIntegration?.config as any)?.access_token || Deno.env.get("WHATSAPP_TOKEN") || "";
              try {
                console.log(`[AD-ENRICHMENT] Fetching ad creative for ad_id: ${adSourceId}`);
                const adRes = await fetch(
                  `https://graph.facebook.com/v25.0/${adSourceId}?fields=id,name,permalink_url,account_id,creative{thumbnail_url,image_url,object_story_spec}&access_token=${metaToken}`
                );
                if (adRes.ok) {
                  const adData = await adRes.json();
                  console.log(`[AD-ENRICHMENT] Ad data received:`, JSON.stringify(adData));

                  if (!adHeadline && adData.name) adHeadline = adData.name;
                  if (!adSourceUrl && adData.permalink_url) adSourceUrl = adData.permalink_url;

                  const creative = adData.creative;
                  if (creative) {
                    if (!adImageUrl) {
                      adImageUrl = creative.image_url
                        || creative.thumbnail_url
                        || creative.object_story_spec?.link_data?.picture
                        || creative.object_story_spec?.link_data?.image_url
                        || creative.object_story_spec?.video_data?.image_url
                        || creative.object_story_spec?.video_data?.call_to_action?.value?.link // video thumbnail
                        || null;
                    }
                    if (!adSourceUrl) {
                      adSourceUrl = creative.object_story_spec?.link_data?.link || null;
                    }
                    if (!adBody) {
                      adBody = creative.object_story_spec?.link_data?.description
                        || creative.object_story_spec?.link_data?.message
                        || creative.object_story_spec?.video_data?.message
                        || null;
                    }
                    if (!adHeadline) {
                      adHeadline = creative.object_story_spec?.link_data?.name || null;
                    }
                  }
                  // Extract account_id from ad data
                  if (adData.account_id) {
                    adAccountId = adData.account_id;
                    // Fetch account name
                    try {
                      const acctRes = await fetch(
                        `https://graph.facebook.com/v25.0/act_${adData.account_id}?fields=name&access_token=${metaToken}`
                      );
                      if (acctRes.ok) {
                        const acctData = await acctRes.json();
                        adAccountName = acctData.name || null;
                        console.log(`[AD-ENRICHMENT] Ad account: ${adAccountId} => ${adAccountName}`);
                      } else {
                        await acctRes.text();
                      }
                    } catch (_) { /* skip */ }
                  }

                  console.log(`[AD-ENRICHMENT] After creative: image=${adImageUrl}, link=${adSourceUrl}`);
                } else {
                  const errText = await adRes.text();
                  console.log(`[AD-ENRICHMENT] Failed to fetch ad ${adSourceId}: ${adRes.status} - ${errText}`);
                }
              } catch (adErr: any) {
                console.log(`[AD-ENRICHMENT] Error enriching ad data: ${adErr.message}`);
              }

              // Fallback: fetch adcreatives directly for video/carousel ads that don't return image above
              if (!adImageUrl) {
                try {
                  console.log(`[AD-ENRICHMENT] Trying adcreatives endpoint for ad_id: ${adSourceId}`);
                  const crRes = await fetch(
                    `https://graph.facebook.com/v25.0/${adSourceId}/adcreatives?fields=thumbnail_url,image_url,object_story_id,effective_object_story_id&access_token=${metaToken}`
                  );
                  if (crRes.ok) {
                    const crData = await crRes.json();
                    const cr = crData.data?.[0];
                    if (cr) {
                      adImageUrl = cr.image_url || cr.thumbnail_url || null;
                      // If we have an object_story_id, try to get the post image
                      const storyId = cr.effective_object_story_id || cr.object_story_id;
                      if (!adImageUrl && storyId) {
                        try {
                          const postRes = await fetch(
                            `https://graph.facebook.com/v25.0/${storyId}?fields=full_picture,picture&access_token=${metaToken}`
                          );
                          if (postRes.ok) {
                            const postData = await postRes.json();
                            adImageUrl = postData.full_picture || postData.picture || null;
                          }
                        } catch (_) { /* skip */ }
                      }
                    }
                  }
                  console.log(`[AD-ENRICHMENT] After adcreatives fallback: image=${adImageUrl}`);
                } catch (crErr: any) {
                  console.log(`[AD-ENRICHMENT] adcreatives fallback error: ${crErr.message}`);
                }
              }

              // Final fallback: if source_url is an Instagram post, try oEmbed
              if (!adImageUrl && adSourceUrl) {
                try {
                  const igMatch = adSourceUrl.match(/instagram\.com\/p\/([^/?]+)/);
                  if (igMatch) {
                    const oembedRes = await fetch(`https://graph.facebook.com/v25.0/instagram_oembed?url=${encodeURIComponent(adSourceUrl)}&access_token=${metaToken}`);
                    if (oembedRes.ok) {
                      const oembedData = await oembedRes.json();
                      adImageUrl = oembedData.thumbnail_url || null;
                    }
                  }
                  console.log(`[AD-ENRICHMENT] After oEmbed fallback: image=${adImageUrl}`);
                } catch (_) { /* skip */ }
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
                    if (adAccountId) insertData.ad_account_id = adAccountId;
                    if (adAccountName) insertData.ad_account_name = adAccountName;
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

                  // Execute on_enter automations immediately for the new lead's first stage
                  if (newLead?.id) {
                    await executeOnEnterAutomations(supabase, newLead.id, stage.id, from);
                  }
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
                if (adAccountId) updates.ad_account_id = adAccountId;
                if (adAccountName) updates.ad_account_name = adAccountName;
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
                ad_account_id: adAccountId || null,
                ad_account_name: adAccountName || null,
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

              // ===== REACTIVE AUTOMATIONS: keyword_response & cold_lead_return =====
              try {
                const { data: currentLeadData } = await supabase
                  .from("crm_leads")
                  .select("stage_id, phone, name, assigned_to")
                  .eq("id", lead.id)
                  .single();

                if (currentLeadData?.stage_id) {
                  const { data: reactiveAutos } = await supabase
                    .from("crm_automations")
                    .select("*")
                    .eq("stage_id", currentLeadData.stage_id)
                    .eq("is_active", true)
                    .in("trigger_type", ["keyword_response", "cold_lead_return", "time_window"]);

                  for (const ra of reactiveAutos || []) {
                    const raCfg = (ra.action_config || {}) as Record<string, any>;

                    if (ra.trigger_type === "keyword_response") {
                      const keywords = (raCfg.keywords || []) as string[];
                      const lowerContent = (content || "").toLowerCase();
                      const matched = keywords.some((kw: string) => lowerContent.includes(kw.toLowerCase()));
                      if (!matched) continue;
                      console.log(`[WEBHOOK] Keyword matched for lead ${lead.id}, automation ${ra.id}`);
                    }

                    if (ra.trigger_type === "cold_lead_return") {
                      // Only trigger if configured cold stages include current stage
                      const coldStages = (raCfg.cold_stages || []) as string[];
                      if (coldStages.length > 0 && !coldStages.includes(currentLeadData.stage_id)) continue;
                      console.log(`[WEBHOOK] Cold lead return for lead ${lead.id}, automation ${ra.id}`);
                    }

                    if (ra.trigger_type === "time_window") {
                      const winStart = raCfg.window_start as string | undefined;
                      const winEnd = raCfg.window_end as string | undefined;
                      if (!winStart || !winEnd) continue;
                      const nowMs = Date.now();
                      // datetime-local sem timezone → interpretar como horário de Brasília (UTC-3)
                      const parseLocalBR = (s: string): number => {
                        if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s).getTime();
                        return new Date(s + "-03:00").getTime();
                      };
                      const startMs = parseLocalBR(winStart);
                      const endMs = parseLocalBR(winEnd);
                      if (isNaN(startMs) || isNaN(endMs)) continue;
                      if (nowMs < startMs || nowMs > endMs) {
                        console.log(`[WEBHOOK] time_window automation ${ra.id} fora da janela (now=${new Date(nowMs).toISOString()}, start=${winStart}, end=${winEnd})`);
                        continue;
                      }
                      // Garantir disparo único por lead/automação via insert único
                      const { error: dedupErr } = await supabase
                        .from("crm_automation_executions")
                        .insert({ automation_id: ra.id, lead_id: lead.id });
                      if (dedupErr) {
                        console.log(`[WEBHOOK] time_window automation ${ra.id} já executada para lead ${lead.id}, pulando`);
                        continue;
                      }
                      console.log(`[WEBHOOK] time_window matched for lead ${lead.id}, automation ${ra.id}`);
                    }

                    // Execute actions server-side
                    const supabaseUrlVal = Deno.env.get("SUPABASE_URL") || "";
                    const serviceKeyVal = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

                    // Move stage if configured
                    if (raCfg.target_stage_id) {
                      await supabase.from("crm_leads").update({ stage_id: raCfg.target_stage_id }).eq("id", lead.id);
                    }

                    // Execute the action with await to prevent runtime shutdown
                    await executeWebhookAction(supabase, supabaseUrlVal, serviceKeyVal, ra.action_type, raCfg, lead.id, currentLeadData.phone);

                    // Notify owner
                    if (raCfg.notify_owner && currentLeadData.assigned_to) {
                      await supabase.from("crm_notifications").insert({
                        user_id: currentLeadData.assigned_to,
                        lead_id: lead.id,
                        title: ra.trigger_type === "cold_lead_return" ? "Lead frio retornou!" : "Palavra-chave detectada",
                        body: `Lead ${currentLeadData.name}: "${content?.substring(0, 80) || ""}"`,
                        type: "automation",
                      });
                    }
                  }
                }
              } catch (raErr: any) {
                console.error("[WEBHOOK] Erro ao verificar automações reativas:", raErr.message);
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
                  try {
                    const botRes = await fetch(`${supabaseUrl}/functions/v1/bot-engine`, {
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
                    });
                    const botBody = await botRes.text();
                    console.log(`[WEBHOOK] Bot-engine continue response (${botRes.status}): ${botBody}`);
                  } catch (err: any) {
                    console.error("[WEBHOOK] Bot-engine continue error:", err.message);
                  }
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
            const failureDetails = Array.isArray(status.errors) && status.errors.length > 0
              ? JSON.stringify(status.errors)
              : null;

            console.log(`Status update: ${messageId} -> ${statusValue}`);
            await supabase
              .from("messages")
              .update({ status: statusValue })
              .eq("whatsapp_message_id", messageId);

            if (statusValue === "failed") {
              console.error(`[WEBHOOK] Delivery failed for ${messageId}: ${failureDetails || JSON.stringify(status)}`);
            }
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
