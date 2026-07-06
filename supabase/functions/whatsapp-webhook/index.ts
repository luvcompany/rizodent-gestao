import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hub-signature-256",
};

const APP_SECRET = Deno.env.get("WHATSAPP_APP_SECRET") ?? Deno.env.get("META_APP_SECRET") ?? "";

async function verifyMetaSignature(rawBody: string, signature: string | null): Promise<boolean> {
  if (!APP_SECRET) return false;
  if (!signature || !signature.startsWith("sha256=")) return false;
  const sigHex = signature.slice("sha256=".length);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const computed = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  if (computed.length !== sigHex.length) return false;
  let mismatch = 0;
  for (let i = 0; i < computed.length; i++) mismatch |= computed.charCodeAt(i) ^ sigHex.charCodeAt(i);
  return mismatch === 0;
}

const MEDIA_TYPES = new Set(["image", "audio", "document", "video", "sticker"]);

// Mapeia o nome da conta de anúncio (Meta Ad Account) ou pistas no texto do anúncio
// (título, descrição, mensagem inicial) para a cidade do lead. Permite preencher
// automaticamente o campo cidade quando um lead vem de anúncio, mesmo se a chamada
// à Graph API falhar e a conta não estiver disponível.
function inferCidadeFromAdAccount(...sources: Array<string | null | undefined>): string | null {
  const combined = sources.filter(Boolean).join(" ").toLowerCase();
  if (!combined) return null;
  if (combined.includes("vca") || combined.includes("vitoria") || combined.includes("vitória") || combined.includes("conquista")) return "Vitória da Conquista";
  if (combined.includes("guanambi")) return "Guanambi";
  if (combined.includes("itabuna")) return "Itabuna";
  if (combined.includes("ipiau") || combined.includes("ipiaú")) return "Ipiaú";
  return null;
}

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

// Execute stage automations server-side for given trigger types
async function executeStageAutomationsForTriggers(
  supabase: any,
  leadId: string,
  stageId: string,
  phone: string | null,
  triggerTypes: string[]
) {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    const { data: automations } = await supabase
      .from("crm_automations")
      .select("*")
      .eq("stage_id", stageId)
      .eq("is_active", true)
      .in("trigger_type", triggerTypes);

    // Lazy-fetch lead data for condition evaluation
    let leadRow: any = null;
    const needsLead = (automations || []).some((a: any) => (a.action_config as any)?.conditions?.rules?.length);
    if (needsLead) {
      const { data: lead } = await supabase
        .from("crm_leads")
        .select("tags, source, cidade, ad_id, ad_account_id, ad_account_name, nome_anuncio, servico_interesse, assigned_to, value")
        .eq("id", leadId)
        .maybeSingle();
      leadRow = lead;
    }

    const { evaluateConditions } = await import("../_shared/automationConditions.ts");

    for (const auto of automations || []) {
      const config = (auto.action_config || {}) as Record<string, any>;
      const conditions = config.conditions;
      if (conditions?.rules?.length && leadRow && !evaluateConditions(conditions, leadRow)) {
        console.log(`[WEBHOOK] Skipping ${auto.id} (${auto.trigger_type}): conditions not met`);
        continue;
      }
      console.log(`[WEBHOOK] ${auto.trigger_type} automation ${auto.id} (${auto.action_type}) for lead ${leadId}`);
      await executeWebhookAction(supabase, supabaseUrl, serviceKey, auto.action_type, config, leadId, phone);
    }
  } catch (e: any) {
    console.error("[WEBHOOK] stage automations error:", e.message);
  }
}

// Backwards-compat wrapper
async function executeOnEnterAutomations(supabase: any, leadId: string, stageId: string, phone: string | null) {
  return executeStageAutomationsForTriggers(supabase, leadId, stageId, phone, ["on_enter"]);
}

// Atribuição padrão: somente para o tenant Rizodent. Outros clientes
// não recebem atribuição automática para um usuário fixo de outro cliente.
const RIZODENT_TENANT_ID = "00000000-0000-0000-0000-000000000010";
const RIZODENT_DEFAULT_USER = "d9b27aa3-049e-4ec9-9ae3-fb160a9544fa";

async function resolveAutoAssignment(supabase: any, _pipelineId: string, tenantId?: string | null): Promise<string | null> {
  if (!tenantId) return null;
  if (tenantId === RIZODENT_TENANT_ID) return RIZODENT_DEFAULT_USER;
  // Para qualquer outro cliente, deixa null (sem dono) — o time do cliente
  // assume manualmente. Nunca atribui a um usuário de outro tenant.
  return null;
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
    console.log(`[MEDIA] Meta response para media_id ${mediaId}: status ${metaRes.status}, mime=${metaData?.mime_type || "n/a"}`);

    if (!metaRes.ok) {
      console.error(`[MEDIA] ERRO ao buscar media_id ${mediaId}: status ${metaRes.status}`);
      return null;
    }

    const downloadUrl = metaData.url;
    const mimeType = metaData.mime_type || "application/octet-stream";

    if (!downloadUrl) {
      console.error(`[MEDIA] Sem URL de download na resposta da Meta para media_id ${mediaId}`);
      return null;
    }

    console.log(`[MEDIA] Fazendo download da mídia (media_id=${mediaId})`);
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
    console.log(`[MEDIA] Upload para Supabase Storage OK: path=${path}, size=${fileBlob.size}`);
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

    // Aceita os 2 verify tokens globais (v1 = Rizodent legado, v2 = novo app único)
    // ou um verify token customizado de integração legada.
    const v1 = Deno.env.get("WHATSAPP_VERIFY_TOKEN") || "";
    const v2 = Deno.env.get("WHATSAPP_VERIFY_TOKEN_V2") || "";
    let matched = (token && (token === v1 || token === v2));
    if (!matched && token) {
      try {
        const { data: integrations } = await supabase
          .from("integrations")
          .select("config")
          .like("key", "whatsapp_%")
          .limit(10);
        for (const intg of (integrations || [])) {
          const cfg = (intg as any).config || {};
          if (cfg.webhook_verify_token && cfg.webhook_verify_token === token) {
            matched = true;
            break;
          }
        }
      } catch (e) {
        console.log("[WEBHOOK] Erro ao buscar verify token das integrações:", e);
      }
    }

    if (mode === "subscribe" && matched) {
      console.log("Webhook verified successfully");
      return new Response(challenge, { status: 200, headers: corsHeaders });
    }
    console.log("Webhook verification failed", { mode, tokenMatch: matched });
    return new Response("Forbidden", { status: 403, headers: corsHeaders });
  }

  // POST = incoming message
  if (req.method === "POST") {
    try {
      const rawBody = await req.text();
      const signature = req.headers.get("x-hub-signature-256");
      const valid = await verifyMetaSignature(rawBody, signature);
      if (!valid) {
        console.warn("[WEBHOOK] Invalid or missing x-hub-signature-256");
        return new Response("Forbidden", { status: 403, headers: corsHeaders });
      }
      const body = JSON.parse(rawBody);
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
              .select("id, key, config, status, tenant_id")
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

            // 🔑 CACHE: tenta buscar metadados do anúncio no cache local antes de chamar a Graph API
            // Isso garante que mesmo se a Graph API falhar (token expirado, rate limit, permissão),
            // ainda teremos o ad_account_name e a cidade corretos do primeiro sucesso.
            if (referral && adSourceId) {
              try {
                const { data: cached } = await supabase
                  .from("ad_id_mapping")
                  .select("ad_account_id, ad_account_name, ad_name, ad_headline, ad_body")
                  .eq("ad_id", adSourceId)
                  .maybeSingle();
                if (cached) {
                  if (!adAccountId && cached.ad_account_id) adAccountId = cached.ad_account_id;
                  if (!adAccountName && cached.ad_account_name) adAccountName = cached.ad_account_name;
                  if (!adHeadline && cached.ad_headline) adHeadline = cached.ad_headline;
                  if (!adBody && cached.ad_body) adBody = cached.ad_body;
                  console.log(`[AD-CACHE] HIT ad_id=${adSourceId} => account=${adAccountName}`);
                } else {
                  console.log(`[AD-CACHE] MISS ad_id=${adSourceId} - vai consultar Graph API`);
                }
              } catch (cErr: any) {
                console.log(`[AD-CACHE] erro lookup: ${cErr.message}`);
              }
            }

            // Enrich ad data from Meta Graph API if we have an ad ID but missing image/link
            if (referral && adSourceId) {
              // Coleta todos os tokens disponíveis (integração atual + outras integrações + env)
              // Necessário porque nem todo token tem permissão `ads_read` para buscar dados da conta de anúncios.
              const tokens: string[] = [];
              const primary = (matchedIntegration?.config as any)?.access_token;
              if (primary) tokens.push(primary);
              try {
                const { data: integs } = await supabase
                  .from("integrations")
                  .select("config")
                  .eq("key", "whatsapp")
                  .eq("status", "connected");
                if (integs) {
                  for (const it of integs) {
                    const t = (it.config as any)?.access_token;
                    if (t && !tokens.includes(t)) tokens.push(t);
                  }
                }
              } catch (_) { /* skip */ }
              const envTok = Deno.env.get("WHATSAPP_TOKEN") || "";
              if (envTok && !tokens.includes(envTok)) tokens.push(envTok);

              for (const metaToken of tokens) {
                try {
                  console.log(`[AD-ENRICHMENT] Fetching ad ${adSourceId} with token ...${metaToken.slice(-6)}`);
                  const adRes = await fetch(
                    `https://graph.facebook.com/v25.0/${adSourceId}?fields=id,name,permalink_url,account_id,creative{thumbnail_url,image_url,object_story_spec}&access_token=${metaToken}`
                  );
                  if (!adRes.ok) {
                    const errText = await adRes.text();
                    console.log(`[AD-ENRICHMENT] Failed ${adSourceId} with ...${metaToken.slice(-6)}: ${adRes.status} - ${errText.slice(0, 150)}`);
                    continue;
                  }
                  const adData = await adRes.json();
                  console.log(`[AD-ENRICHMENT] Ad data received for ${adSourceId}: name=${adData?.name ? "yes" : "no"}, account_id=${adData?.account_id || "n/a"}`);

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
                        || creative.object_story_spec?.video_data?.call_to_action?.value?.link
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
                  if (adData.account_id) {
                    adAccountId = adData.account_id;
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

                  console.log(`[AD-ENRICHMENT] After creative: image=${adImageUrl}, link=${adSourceUrl}, account=${adAccountName}`);
                  break; // sucesso, sai do loop de tokens
                } catch (adErr: any) {
                  console.log(`[AD-ENRICHMENT] Error: ${adErr.message}`);
                }
              }

              const fallbackToken = tokens[0] || "";

              // Fallback: fetch adcreatives directly for video/carousel ads that don't return image above
              if (!adImageUrl && fallbackToken) {
                try {
                  console.log(`[AD-ENRICHMENT] Trying adcreatives endpoint for ad_id: ${adSourceId}`);
                  const crRes = await fetch(
                    `https://graph.facebook.com/v25.0/${adSourceId}/adcreatives?fields=thumbnail_url,image_url,object_story_id,effective_object_story_id&access_token=${fallbackToken}`
                  );
                  if (crRes.ok) {
                    const crData = await crRes.json();
                    const cr = crData.data?.[0];
                    if (cr) {
                      adImageUrl = cr.image_url || cr.thumbnail_url || null;
                      const storyId = cr.effective_object_story_id || cr.object_story_id;
                      if (!adImageUrl && storyId) {
                        try {
                          const postRes = await fetch(
                            `https://graph.facebook.com/v25.0/${storyId}?fields=full_picture,picture&access_token=${fallbackToken}`
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
              if (!adImageUrl && adSourceUrl && fallbackToken) {
                try {
                  const igMatch = adSourceUrl.match(/instagram\.com\/p\/([^/?]+)/);
                  if (igMatch) {
                    const oembedRes = await fetch(`https://graph.facebook.com/v25.0/instagram_oembed?url=${encodeURIComponent(adSourceUrl)}&access_token=${fallbackToken}`);
                    if (oembedRes.ok) {
                      const oembedData = await oembedRes.json();
                      adImageUrl = oembedData.thumbnail_url || null;
                    }
                  }
                  console.log(`[AD-ENRICHMENT] After oEmbed fallback: image=${adImageUrl}`);
                } catch (_) { /* skip */ }
              }
            }

            // 🔑 CACHE: persiste/atualiza metadados do anúncio para garantir que próximas requisições
            // não dependam mais da Graph API (evita falhas por token expirado, rate limit, etc.)
            if (referral && adSourceId && (adAccountName || adAccountId || adHeadline)) {
              try {
                const inferredCidadeForCache = inferCidadeFromAdAccount(adAccountName, adHeadline, adBody, content);
                await supabase.from("ad_id_mapping").upsert({
                  ad_id: adSourceId,
                  ad_account_id: adAccountId,
                  ad_account_name: adAccountName,
                  ad_headline: adHeadline,
                  ad_body: adBody,
                  cidade: inferredCidadeForCache,
                  updated_at: new Date().toISOString(),
                }, { onConflict: "ad_id" });
                console.log(`[AD-CACHE] UPSERT ad_id=${adSourceId} account=${adAccountName} cidade=${inferredCidadeForCache}`);
              } catch (upErr: any) {
                console.log(`[AD-CACHE] erro upsert: ${upErr.message}`);
              }
            }

            // Download and store media if present
            let mediaUrl: string | null = null;
            const whatsappToken = (matchedIntegration?.config as any)?.access_token || Deno.env.get("WHATSAPP_TOKEN") || "";
            if (mediaId && MEDIA_TYPES.has(msgType)) {
              mediaUrl = await downloadAndStoreMedia(mediaId, msgType, whatsappToken, supabase);
            }

            // Find or create lead by phone (scoped by tenant)
            const tenantId: string | null = matchedIntegration?.tenant_id ?? null;
            if (!tenantId) {
              console.warn(`[WEBHOOK] Integração ${matchedIntegration?.key} sem tenant_id — descartando mensagem.`);
              continue;
            }

            let { data: leadRows } = await supabase
              .from("crm_leads")
              .select("id, name, source, is_blocked")
              .eq("tenant_id", tenantId)
              .eq("phone", from)
              .order("created_at", { ascending: true })
              .limit(1);
            let lead: any = leadRows?.[0] || null;

            // 🚫 Blocked lead: drop the inbound message entirely
            if (lead && (lead as any).is_blocked) {
              console.log(`[WEBHOOK] Lead ${lead.id} (${from}) está BLOQUEADO — mensagem descartada.`);
              continue;
            }

            if (!lead) {
              const leadName = contactName || `Lead WhatsApp ${from}`;

              let pipelineId: string | null = null;
              if (matchedIntegration) {
                const { data: funnelChannel } = await supabase
                  .from("funnel_channels")
                  .select("pipeline_id")
                  .eq("tenant_id", tenantId)
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
                  .eq("tenant_id", tenantId)
                  .limit(1)
                  .maybeSingle();
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
                    tenant_id: tenantId,
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
                    // Tenta inferir cidade pelo nome da conta; se a conta não veio (Graph API falhou),
                    // usa título/descrição/conteúdo da primeira mensagem como pista (ex: "[Guanambi]").
                    const inferredCidade = inferCidadeFromAdAccount(adAccountName, adHeadline, adBody, content);
                    if (inferredCidade) insertData.cidade = inferredCidade;
                  }

                  // Atribuição padrão por cliente (somente Rizodent tem usuário fixo)
                  const assignedTo = await resolveAutoAssignment(supabase, pipelineId, tenantId);
                  if (assignedTo) {
                    insertData.assigned_to = assignedTo;
                    console.log(`[WEBHOOK] Round-robin atribuiu lead a: ${assignedTo}`);
                  }

                  const { data: newLead, error: insertLeadErr } = await supabase
                    .from("crm_leads")
                    .insert(insertData)
                    .select("id, name, source")
                    .single();

                  if (insertLeadErr && (insertLeadErr as any).code === "23505") {
                    // Race: another webhook just created this lead. Reuse it.
                    const { data: existing } = await supabase
                      .from("crm_leads")
                      .select("id, name, source")
                      .eq("tenant_id", tenantId).eq("phone", from)
                      .order("created_at", { ascending: true }).limit(1).maybeSingle();
                    lead = existing as any;
                    console.log(`[WEBHOOK] Race avoided — reusing existing lead ${existing?.id} for ${from}`);
                  } else {
                    lead = newLead;
                    console.log(`[WEBHOOK] Lead criado: id=${newLead?.id}, pipeline=${pipelineId}, assigned=${assignedTo || "none"}, ad_id=${adSourceId || "N/A"}`);
                  }

                  // Execute on_create + on_enter + on_create_or_enter automations for the new lead's first stage
                  if (newLead?.id) {
                    await executeStageAutomationsForTriggers(
                      supabase,
                      newLead.id,
                      stage.id,
                      from,
                      ["on_create", "on_enter", "on_create_or_enter"]
                    );
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
                // Preencher cidade automaticamente apenas se o lead ainda não tiver cidade definida (preserva alteração manual)
                const inferredCidade = inferCidadeFromAdAccount(adAccountName, adHeadline, adBody, content);
                if (inferredCidade) {
                  const { data: leadCidadeRow } = await supabase
                    .from("crm_leads")
                    .select("cidade")
                    .eq("id", lead.id)
                    .maybeSingle();
                  if (!leadCidadeRow?.cidade) {
                    updates.cidade = inferredCidade;
                  }
                }
                if (!lead.source || lead.source === "whatsapp") updates.source = "facebook_ad";
              }
              if (Object.keys(updates).length > 0) {
                await supabase.from("crm_leads").update(updates).eq("id", lead.id);
                console.log(`[WEBHOOK] Lead ${lead.id} atualizado: campos=${Object.keys(updates).join(",")}`);
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
                tenant_id: tenantId,
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
                console.error(`[WEBHOOK] ERRO ao salvar mensagem lead=${lead.id}: ${insertErr.message || insertErr.code}`);
              } else {
                console.log(`[WEBHOOK] Mensagem salva: id=${savedMsg?.id}, lead=${lead.id}, direction=inbound, type=${msgType}`);
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

              // Sugestão da Bia agora é estritamente sob demanda (clique em "Sugerir resposta").
              // Removido o disparo automático no webhook para evitar consumo de créditos sem necessidade.

              // Fire-and-forget: transcrição de áudio inbound
              if (msgType === "audio" && savedMsg?.id) {
                try {
                  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
                  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
                  fetch(`${supabaseUrl}/functions/v1/transcribe-audio`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${serviceKey}`,
                      apikey: serviceKey,
                    },
                    body: JSON.stringify({ message_id: savedMsg.id }),
                  }).catch((e) => console.error("[WEBHOOK] transcribe fire-and-forget error:", e?.message));
                } catch (e: any) {
                  console.error("[WEBHOOK] transcribe trigger error:", e?.message);
                }
              }




              // Check follow-up queue - mark as responded if active (covers ALL waiting statuses)
              try {
                const { data: fqItems } = await supabase
                  .from("crm_followup_queue")
                  .select("id, config_id")
                  .eq("lead_id", lead.id)
                  .in("status", ["waiting", "waiting_disparo1", "waiting_disparo2"])
                  .limit(20);

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

                // Cancel any pending automation queue items (progressive_reengagement / no_response) for this lead
                const { data: cancelledItems } = await supabase
                  .from("crm_automation_queue")
                  .update({ status: "cancelled", error_message: "lead_replied", updated_at: new Date().toISOString() })
                  .eq("lead_id", lead.id)
                  .eq("status", "pending")
                  .select("id, automation_id, layer_index");
                if (cancelledItems && cancelledItems.length > 0) {
                  console.log(`[WEBHOOK] Cancelled ${cancelledItems.length} pending automation queue items for lead ${lead.id} (lead replied)`);
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

                  // Pre-load lead data once if any reactive auto has conditions
                  let reactiveLeadRow: any = null;
                  const needsReactiveLead = (reactiveAutos || []).some((a: any) => (a.action_config as any)?.conditions?.rules?.length);
                  if (needsReactiveLead) {
                    const { data: rl } = await supabase
                      .from("crm_leads")
                      .select("tags, source, cidade, ad_id, ad_account_id, ad_account_name, nome_anuncio, servico_interesse, assigned_to, value")
                      .eq("id", lead.id)
                      .maybeSingle();
                    reactiveLeadRow = rl;
                  }
                  const { evaluateConditions: evalReactiveConditions } = await import("../_shared/automationConditions.ts");

                  for (const ra of reactiveAutos || []) {
                    const raCfg = (ra.action_config || {}) as Record<string, any>;

                    // Check optional conditions filter
                    if (raCfg.conditions?.rules?.length && reactiveLeadRow && !evalReactiveConditions(raCfg.conditions, reactiveLeadRow)) {
                      console.log(`[WEBHOOK] Reactive auto ${ra.id} skipped by conditions`);
                      continue;
                    }

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
                      const mode = (raCfg.window_mode as string) || "once";
                      const nowMs = Date.now();
                      let inWindow = false;

                      if (mode === "weekly") {
                        // Defaults: Sat -> Mon, 08:00 -> 08:00 if missing
                        const startDay = raCfg.start_day !== undefined && raCfg.start_day !== null && raCfg.start_day !== ""
                          ? Number(raCfg.start_day) : 6;
                        const endDay = raCfg.end_day !== undefined && raCfg.end_day !== null && raCfg.end_day !== ""
                          ? Number(raCfg.end_day) : 1;
                        const startTime = (raCfg.start_time as string) || "08:00";
                        const endTime = (raCfg.end_time as string) || "08:00";
                        if (Number.isNaN(startDay) || Number.isNaN(endDay)) {
                          console.log(`[WEBHOOK] time_window weekly auto ${ra.id}: invalid days (start=${raCfg.start_day}, end=${raCfg.end_day})`);
                          continue;
                        }
                        const [sh, sm] = startTime.split(":").map(Number);
                        const [eh, em] = endTime.split(":").map(Number);
                        // "Now" in Brasília (UTC-3)
                        const brNow = new Date(nowMs - 3 * 3600 * 1000);
                        const brDay = brNow.getUTCDay();
                        const brMin = brNow.getUTCHours() * 60 + brNow.getUTCMinutes();
                        const nowWeekMin = brDay * 1440 + brMin;
                        const startWeekMin = startDay * 1440 + sh * 60 + sm;
                        const endWeekMin = endDay * 1440 + eh * 60 + em;
                        if (startWeekMin <= endWeekMin) {
                          inWindow = nowWeekMin >= startWeekMin && nowWeekMin <= endWeekMin;
                        } else {
                          inWindow = nowWeekMin >= startWeekMin || nowWeekMin <= endWeekMin;
                        }
                      } else if (mode === "business_hours_off") {
                        const bhDays = (Array.isArray(raCfg.bh_days) ? raCfg.bh_days : [1,2,3,4,5]).map((d:any)=>Number(d));
                        const [sh, sm] = String(raCfg.bh_start || "08:00").split(":").map(Number);
                        const [eh, em] = String(raCfg.bh_end || "18:00").split(":").map(Number);
                        if ([sh,sm,eh,em].some(v=>Number.isNaN(v))) { console.log(`[WEBHOOK] time_window bh_off auto ${ra.id}: invalid time`); continue; }
                        const startMin = sh*60+sm, endMin = eh*60+em;
                        if (startMin >= endMin) { console.log(`[WEBHOOK] time_window bh_off auto ${ra.id}: invalid range`); continue; }
                        const brNow = new Date(nowMs - 3 * 3600 * 1000);
                        const day = brNow.getUTCDay();
                        const min = brNow.getUTCHours() * 60 + brNow.getUTCMinutes();
                        const isBH = bhDays.includes(day) && min >= startMin && min < endMin;
                        inWindow = !isBH;
                      } else {
                        const winStart = raCfg.window_start as string | undefined;
                        const winEnd = raCfg.window_end as string | undefined;
                        if (!winStart || !winEnd) continue;
                        const parseLocalBR = (s: string): number => {
                          if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s).getTime();
                          return new Date(s + "-03:00").getTime();
                        };
                        const startMs = parseLocalBR(winStart);
                        const endMs = parseLocalBR(winEnd);
                        if (isNaN(startMs) || isNaN(endMs)) continue;
                        inWindow = nowMs >= startMs && nowMs <= endMs;
                      }

                      if (!inWindow) {
                        console.log(`[WEBHOOK] time_window automation ${ra.id} fora da janela (mode=${mode})`);
                        continue;
                      }
                      // Dedup por ocorrência: para weekly, calcula início da janela atual; para once, usa window_start
                      let occurrenceStartMs = 0;
                      if (mode === "weekly") {
                        const startDay = raCfg.start_day !== undefined && raCfg.start_day !== null && raCfg.start_day !== ""
                          ? Number(raCfg.start_day) : 6;
                        const startTime = (raCfg.start_time as string) || "08:00";
                        const [sh, sm] = startTime.split(":").map(Number);
                        const brNow = new Date(nowMs - 3 * 3600 * 1000);
                        const brDay = brNow.getUTCDay();
                        const brMin = brNow.getUTCHours() * 60 + brNow.getUTCMinutes();
                        const startWeekMin = startDay * 1440 + sh * 60 + sm;
                        const nowWeekMin = brDay * 1440 + brMin;
                        // Diferença em minutos desde o início da ocorrência atual (sempre <= 7*1440)
                        let diffMin = nowWeekMin - startWeekMin;
                        if (diffMin < 0) diffMin += 7 * 1440;
                        occurrenceStartMs = nowMs - diffMin * 60 * 1000;
                      } else if (mode === "business_hours_off") {
                        // Walk back at most 8 days to find when current off-period started
                        const bhDays = (Array.isArray(raCfg.bh_days) ? raCfg.bh_days : [1,2,3,4,5]).map((d:any)=>Number(d));
                        const [sh, sm] = String(raCfg.bh_start || "08:00").split(":").map(Number);
                        const [eh, em] = String(raCfg.bh_end || "18:00").split(":").map(Number);
                        const startMin = sh*60+sm, endMin = eh*60+em;
                        const brNow = new Date(nowMs - 3 * 3600 * 1000);
                        let foundIdx = 8 * 24 * 60;
                        for (let i = 0; i < 8 * 24 * 60; i++) {
                          const t = new Date(brNow.getTime() - i * 60 * 1000);
                          const d = t.getUTCDay();
                          const m = t.getUTCHours() * 60 + t.getUTCMinutes();
                          const isBH = bhDays.includes(d) && m >= startMin && m < endMin;
                          if (isBH) { foundIdx = i; break; }
                        }
                        // Start of current off-period = 1 minute after the last BH minute
                        occurrenceStartMs = nowMs - Math.max(0, foundIdx - 1) * 60 * 1000;
                      } else {
                        const winStart = raCfg.window_start as string | undefined;
                        if (winStart) {
                          const parseLocalBR = (s: string): number => {
                            if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s).getTime();
                            return new Date(s + "-03:00").getTime();
                          };
                          occurrenceStartMs = parseLocalBR(winStart);
                        }
                      }
                      const { data: prevExec } = await supabase
                        .from("crm_automation_executions")
                        .select("id, executed_at")
                        .eq("automation_id", ra.id)
                        .eq("lead_id", lead.id)
                        .gte("executed_at", new Date(occurrenceStartMs).toISOString())
                        .limit(1)
                        .maybeSingle();
                      if (prevExec) {
                        console.log(`[WEBHOOK] time_window automation ${ra.id} já executada para lead ${lead.id} nesta ocorrência (since ${new Date(occurrenceStartMs).toISOString()}), pulando`);
                        continue;
                      }
                      await supabase.from("crm_automation_executions").insert({ automation_id: ra.id, lead_id: lead.id });
                      console.log(`[WEBHOOK] time_window matched (mode=${mode}) for lead ${lead.id}, automation ${ra.id}`);
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
                  .select("id, started_at, bot_id")
                  .eq("lead_id", lead.id)
                  .eq("status", "waiting_reply")
                  .order("started_at", { ascending: false })
                  .limit(1)
                  .maybeSingle();

                // Ignore replies that arrived BEFORE this execution started
                // (prevents stale messages from being treated as bot replies)
                const inboundMs = msg.timestamp ? Number(msg.timestamp) * 1000 : Date.now();
                const execStartedMs = botExec?.started_at ? new Date(botExec.started_at).getTime() : 0;
                if (botExec && inboundMs < execStartedMs) {
                  console.log(`[WEBHOOK] Ignoring stale inbound (${new Date(inboundMs).toISOString()}) — older than execution start (${botExec.started_at})`);
                } else if (botExec) {
                  // Gate: if this bot was started by a time_window automation that is
                  // currently CLOSED, cancel the execution and do not continue.
                  let windowClosed = false;
                  try {
                    const { data: twAutos } = await supabase
                      .from("crm_automations")
                      .select("id, action_config, is_active")
                      .eq("trigger_type", "time_window")
                      .eq("action_type", "send_bot");
                    const related = (twAutos || []).filter((a: any) => (a.action_config?.bot_id) === botExec.bot_id);
                    if (related.length > 0) {
                      const nowMs = Date.now();
                      const brNow = new Date(nowMs - 3 * 3600 * 1000);
                      const brDay = brNow.getUTCDay();
                      const brMin = brNow.getUTCHours() * 60 + brNow.getUTCMinutes();
                      const nowWeekMin = brDay * 1440 + brMin;
                      const parseLocalBR = (s: string): number => {
                        if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s).getTime();
                        return new Date(s + "-03:00").getTime();
                      };
                      let anyOpen = false;
                      for (const a of related) {
                        const cfg = (a.action_config || {}) as Record<string, any>;
                        const mode = (cfg.window_mode as string) || "once";
                        if (mode === "weekly") {
                          const startDay = Number(cfg.start_day);
                          const endDay = Number(cfg.end_day);
                          const [sh, sm] = String(cfg.start_time || "00:00").split(":").map(Number);
                          const [eh, em] = String(cfg.end_time || "23:59").split(":").map(Number);
                          if ([startDay, endDay, sh, sm, eh, em].some(v => Number.isNaN(v))) continue;
                          const startWeekMin = startDay * 1440 + sh * 60 + sm;
                          const endWeekMin = endDay * 1440 + eh * 60 + em;
                          let isOpen: boolean;
                          if (startWeekMin <= endWeekMin) {
                            isOpen = nowWeekMin >= startWeekMin && nowWeekMin <= endWeekMin;
                          } else {
                            isOpen = nowWeekMin >= startWeekMin || nowWeekMin <= endWeekMin;
                          }
                          if (isOpen) { anyOpen = true; break; }
                        } else if (mode === "business_hours_off") {
                          const bhDays = (Array.isArray(cfg.bh_days) ? cfg.bh_days : [1,2,3,4,5]).map((d:any)=>Number(d));
                          const [sh, sm] = String(cfg.bh_start || "08:00").split(":").map(Number);
                          const [eh, em] = String(cfg.bh_end || "18:00").split(":").map(Number);
                          if ([sh,sm,eh,em].some(v => Number.isNaN(v))) continue;
                          const startMin = sh*60+sm, endMin = eh*60+em;
                          const isBH = bhDays.includes(brDay) && brMin >= startMin && brMin < endMin;
                          if (!isBH) { anyOpen = true; break; }
                        } else {
                          if (!a.is_active) continue;
                          const winStart = cfg.window_start as string | undefined;
                          const winEnd = cfg.window_end as string | undefined;
                          if (!winStart || !winEnd) continue;
                          const startMs = parseLocalBR(winStart);
                          const endMs = parseLocalBR(winEnd);
                          if (isNaN(startMs) || isNaN(endMs)) continue;
                          if (nowMs >= startMs && nowMs <= endMs) { anyOpen = true; break; }
                        }
                      }
                      windowClosed = !anyOpen;
                    }
                  } catch (gateErr: any) {
                    console.error("[WEBHOOK] time_window gate error:", gateErr.message);
                  }

                  if (windowClosed) {
                    await supabase
                      .from("bot_executions")
                      .update({ status: "cancelled", completed_at: new Date().toISOString() })
                      .eq("id", botExec.id);
                    console.log(`[WEBHOOK] Bot execution ${botExec.id} cancelled — time_window closed (lead ${lead.id}, bot ${botExec.bot_id})`);
                  } else {
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
            const errorsArr = Array.isArray(status.errors) ? status.errors : [];
            const failureDetails = errorsArr.length > 0 ? JSON.stringify(errorsArr) : null;

            console.log(`Status update: ${messageId} -> ${statusValue}`);

            const updatePayload: Record<string, any> = { status: statusValue };

            // Quando a entrega falha, a Meta envia detalhes em status.errors[].
            // Preserva isso em error_reason pra você ver o motivo real
            // (ex: "131047 - Re-engagement message", "131026 - Undeliverable",
            // "131056 - Pair rate limit", etc) em vez de só "failed".
            if (statusValue === "failed" && errorsArr.length > 0) {
              const e = errorsArr[0] || {};
              const code = e.code ?? "";
              const title = e.title || e.message || "";
              const details = e.error_data?.details || e.details || "";
              // Formato amigável: "131047 - Re-engagement message: detail..."
              const reason = [
                code ? String(code) : null,
                title || null,
                details && details !== title ? details : null,
              ].filter(Boolean).join(" - ");
              updatePayload.error_reason = reason || failureDetails;
              console.error(`[WEBHOOK] Delivery failed for ${messageId}: ${reason}`);
            } else if (statusValue === "failed") {
              console.error(`[WEBHOOK] Delivery failed for ${messageId} (sem detalhes Meta)`);
              updatePayload.error_reason = "Falha de entrega sem detalhes";
            }

            await supabase
              .from("messages")
              .update(updatePayload)
              .eq("whatsapp_message_id", messageId);
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
