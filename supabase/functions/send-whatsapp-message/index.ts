import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveCaller, assertLeadInTenant } from "../_shared/authz.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Usamos o bucket privado chat-media (o "avatars" restringe a apenas imagens,
// então uploads de vídeo/PDF de header de template falhavam silenciosamente).
// Geramos uma signed URL de longa duração para o Meta baixar a mídia no envio.
const PUBLIC_TEMPLATE_MEDIA_BUCKET = "chat-media";
const PUBLIC_TEMPLATE_MEDIA_PREFIX = "whatsapp-template-media";
const TEMPLATE_MEDIA_SIGNED_TTL = 60 * 60 * 24 * 365; // 1 ano

const isHttpUrl = (value: string | null | undefined) => Boolean(value && /^https?:\/\//i.test(value));

const sanitizePathSegment = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "template";

const extensionFromMime = (mimeType: string) => {
  const mimeMap: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  };

  return mimeMap[mimeType.toLowerCase()] || "bin";
};

const TEMPLATE_SELECT = "name, body_text, header_type, header_content, status, updated_at, created_at";

const cleanTemplateName = (name: string) => name.replace(/_[a-z0-9]{4,10}$/i, "");

const getTemplatePlaceholderIndexes = (content: string | null | undefined): number[] => {
  if (!content) return [];

  const indexes = new Set<number>();

  // Only detect {{N}} style placeholders (Meta's official format)
  for (const match of content.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0) indexes.add(value);
  }

  return [...indexes].sort((a, b) => a - b);
};

const hasOfficialTemplatePlaceholders = (content: string | null | undefined) =>
  getTemplatePlaceholderIndexes(content).length > 0;

async function resolveTemplateForSend(supabase: any, templateName: string) {
  const { data: exactTemplate } = await supabase
    .from("crm_whatsapp_templates")
    .select(TEMPLATE_SELECT)
    .eq("name", templateName)
    .maybeSingle();

  if (exactTemplate?.body_text && hasOfficialTemplatePlaceholders(exactTemplate.body_text)) {
    return exactTemplate;
  }

  const baseName = cleanTemplateName(templateName);
  const { data: relatedTemplates } = await supabase
    .from("crm_whatsapp_templates")
    .select(TEMPLATE_SELECT)
    .eq("status", "APPROVED")
    .like("name", `${baseName}_%`)
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false });

  const preferredTemplate = (relatedTemplates || []).find((candidate: any) =>
    cleanTemplateName(candidate.name) === baseName && hasOfficialTemplatePlaceholders(candidate.body_text)
  );

  if (preferredTemplate && preferredTemplate.name !== exactTemplate?.name) {
    console.log(
      `[send-whatsapp] Switching template ${templateName} -> ${preferredTemplate.name} to use the official body placeholders.`,
    );
    return preferredTemplate;
  }

  return exactTemplate || null;
}

const buildTemplateFallbacks = (
  lead: { name?: string | null; phone?: string | null; source?: string | null; servico_interesse?: string | null } | null,
  appointmentDate?: string | null,
) => {
  const safeLeadName = lead?.name?.trim() || "cliente";
  const safeDate = appointmentDate || "data a confirmar";
  const safeService = lead?.servico_interesse?.trim() || "consulta";
  return [safeLeadName, safeDate, safeService, lead?.phone?.trim() || safeLeadName, lead?.source?.trim() || safeLeadName];
};

const buildMediaHeaderComponent = (headerType: string, link: string) => {
  if (headerType === "IMAGE") {
    return { type: "header", parameters: [{ type: "image", image: { link } }] };
  }

  if (headerType === "VIDEO") {
    return { type: "header", parameters: [{ type: "video", video: { link } }] };
  }

  if (headerType === "DOCUMENT") {
    return { type: "header", parameters: [{ type: "document", document: { link } }] };
  }

  return null;
};

async function ensurePublicTemplateMediaLink(
  supabase: any,
  templateName: string,
  headerType: string,
  originalValue: string,
) {
  if (!originalValue) return null;
  if (!isHttpUrl(originalValue)) return originalValue;
  if (originalValue.includes("/storage/v1/object/public/")) return originalValue;

  const response = await fetch(originalValue);
  if (!response.ok) {
    throw new Error(`Failed to download template media (${response.status})`);
  }

  const mediaBlob = await response.blob();
  const contentType = mediaBlob.type || (headerType === "VIDEO" ? "video/mp4" : headerType === "DOCUMENT" ? "application/pdf" : "image/jpeg");
  const extension = extensionFromMime(contentType);
  const filePath = `${PUBLIC_TEMPLATE_MEDIA_PREFIX}/${sanitizePathSegment(templateName)}-${Date.now()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(PUBLIC_TEMPLATE_MEDIA_BUCKET)
    .upload(filePath, mediaBlob, {
      contentType,
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`Failed to cache template media: ${uploadError.message}`);
  }

  const { data } = supabase.storage.from(PUBLIC_TEMPLATE_MEDIA_BUCKET).getPublicUrl(filePath);
  return data.publicUrl;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const apiKeyHeader = req.headers.get("apikey") || "";
    const token = authHeader.replace("Bearer ", "");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceRoleKey,
    );

    const caller = await resolveCaller(req, supabase);
    if (!caller.ok) {
      console.warn(`[send-whatsapp-message] auth failed: ${caller.error}`);
      return new Response(JSON.stringify({ error: caller.error }), {
        status: caller.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }



    const {
      lead_id,
      to,
      message,
      type = "text",
      media_url,
      template_name,
      template_language,
      template_components,
      reply_to_wamid,
      reply_to_message_id,
      reaction_emoji,
      reaction_to_message_id,
      audio_voice = false,
      interactive_type,
      body,
      buttons,
      button_text,
      sections,
      header,
      footer,
      skip_mark_as_read = false,
    } = await req.json();

    if (!lead_id || !to) {
      return new Response(JSON.stringify({ error: "Missing lead_id or to" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Tenant ownership check (IDOR guard) — service-role and superadmin bypass.
    const tenantCheck = await assertLeadInTenant(supabase, lead_id, caller);
    if (!tenantCheck.ok) {
      console.warn(`[send-whatsapp-message] tenant guard: ${tenantCheck.error} lead=${lead_id} user=${caller.userId ?? "service"}`);
      return new Response(JSON.stringify({ error: tenantCheck.error }), {
        status: tenantCheck.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    let whatsappToken = Deno.env.get("WHATSAPP_TOKEN") || "";
    let phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || "";

    const { data: leadData } = await supabase
      .from("crm_leads")
      .select("pipeline_id, tenant_id")
      .eq("id", lead_id)
      .maybeSingle();
    const leadTenantId: string | null = (leadData as any)?.tenant_id ?? null;

    // ISOLAMENTO POR CLIENTE: as credenciais WhatsApp DEVEM pertencer
    // ao mesmo tenant do lead. Sem fallback "qualquer canal ativo".
    if (!leadTenantId) {
      return new Response(JSON.stringify({ error: "Lead sem tenant_id; envio bloqueado" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let resolvedFromTenant = false;
    if (leadData?.pipeline_id) {
      const { data: funnelChannel } = await supabase
        .from("funnel_channels")
        .select("channel_config")
        .eq("channel_type", "whatsapp")
        .eq("pipeline_id", leadData.pipeline_id)
        .eq("tenant_id", leadTenantId)
        .maybeSingle();

      if (funnelChannel?.channel_config) {
        const integrationKey = (funnelChannel.channel_config as any)?.integration_key;
        if (integrationKey) {
          const { data: integration } = await supabase
            .from("integrations")
            .select("config, status, tenant_id")
            .eq("key", integrationKey)
            .eq("tenant_id", leadTenantId)
            .maybeSingle();

          if (integration?.status === "disabled") {
            return new Response(JSON.stringify({ error: "Integração desativada" }), {
              status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          if (integration?.config) {
            const cfg = integration.config as any;
            const resolvedToken = cfg.access_token || cfg.token;
            if (resolvedToken) whatsappToken = resolvedToken;
            if (cfg.phone_number_id) phoneNumberId = cfg.phone_number_id;
            resolvedFromTenant = true;
          }
        }
      }
    }

    // Se não houver canal por pipeline, tentar QUALQUER integração WhatsApp
    // ativa do MESMO tenant (e nunca de outro cliente).
    if (!resolvedFromTenant) {
      const { data: tenantIntegrations } = await supabase
        .from("integrations")
        .select("config, status")
        .eq("tenant_id", leadTenantId)
        .like("key", "whatsapp_%")
        .neq("status", "disabled");
      const intg = (tenantIntegrations || []).find((i: any) => {
        const cfg = (i.config as any) || {};
        return (cfg.access_token || cfg.token) && cfg.phone_number_id;
      });
      if (intg) {
        const cfg = (intg.config as any) || {};
        whatsappToken = cfg.access_token || cfg.token || whatsappToken;
        phoneNumberId = cfg.phone_number_id || phoneNumberId;
        resolvedFromTenant = true;
      }
    }

    if (!resolvedFromTenant || !whatsappToken || !phoneNumberId) {
      return new Response(JSON.stringify({
        error: "Sem credenciais WhatsApp para o cliente deste lead",
        tenant_id: leadTenantId,
      }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let resolvedWamid = reply_to_wamid || null;
    if (!resolvedWamid && reply_to_message_id) {
      const { data: origMsg } = await supabase
        .from("messages")
        .select("whatsapp_message_id")
        .eq("id", reply_to_message_id)
        .single();
      resolvedWamid = origMsg?.whatsapp_message_id || null;
    }

    if (type === "reaction") {
      let reactionWamid = null;
      if (reaction_to_message_id) {
        const { data: reactMsg } = await supabase
          .from("messages")
          .select("whatsapp_message_id")
          .eq("id", reaction_to_message_id)
          .single();
        reactionWamid = reactMsg?.whatsapp_message_id || null;
      }

      if (!reactionWamid) {
        return new Response(JSON.stringify({ error: "Cannot react: original message has no WhatsApp ID" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const reactionBody = {
        messaging_product: "whatsapp",
        to,
        type: "reaction",
        reaction: {
          message_id: reactionWamid,
          emoji: reaction_emoji || "👍",
        },
      };

      const waResponse = await fetch(
        `https://graph.facebook.com/v25.0/${phoneNumberId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${whatsappToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(reactionBody),
        }
      );
      const waData = await waResponse.json();

      if (!waResponse.ok) {
        return new Response(JSON.stringify({ error: "WhatsApp reaction error", details: waData }), {
          status: waResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: targetMsg } = await supabase
        .from("messages")
        .select("reactions")
        .eq("id", reaction_to_message_id)
        .single();

      const existingReactions = Array.isArray(targetMsg?.reactions) ? targetMsg.reactions : [];
      const filtered = existingReactions.filter((r: any) => r.from !== "me");
      const updatedReactions = [...filtered, { emoji: reaction_emoji || "👍", from: "me" }];

      await supabase
        .from("messages")
        .update({ reactions: updatedReactions })
        .eq("id", reaction_to_message_id);

      return new Response(JSON.stringify({ success: true, whatsapp: waData }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let finalType = type;
    let sentTemplateName = template_name || null;
    let waBody: any = { messaging_product: "whatsapp", to };

    if (resolvedWamid) {
      waBody.context = { message_id: resolvedWamid };
    }

    if (type === "interactive") {
      waBody.type = "interactive";
      const interactiveBody = body || message || "Escolha uma opção:";

      if (interactive_type === "list") {
        const listInteractive: any = {
          type: "list",
          body: { text: interactiveBody },
          action: {
            button: button_text || "Ver opções",
            sections: (sections || []).map((s: any) => ({
              title: (s.title || "Opções").slice(0, 24),
              rows: (s.rows || []).map((r: any) => ({
                id: r.id || r.title?.slice(0, 20) || "opt",
                title: (r.title || "").slice(0, 24),
                description: r.description ? r.description.slice(0, 72) : undefined,
              })),
            })),
          },
        };
        if (header) listInteractive.header = { type: "text", text: String(header).slice(0, 60) };
        if (footer) listInteractive.footer = { text: String(footer).slice(0, 60) };
        waBody.interactive = listInteractive;
      } else {
        waBody.interactive = {
          type: "button",
          body: { text: interactiveBody },
          action: {
            buttons: (buttons || []).slice(0, 3).map((b: any) => ({
              type: "reply",
              reply: {
                id: b.reply?.id || b.id || "btn",
                title: (b.reply?.title || b.title || "").slice(0, 20),
              },
            })),
          },
        };
      }
    } else if (type === "template") {
      waBody.type = "template";

      let resolvedTemplateName = template_name;
      let resolvedComponents = Array.isArray(template_components) ? [...template_components] : [];

      if (template_name) {
        const [tplRow, tplLead, nextAppt] = await Promise.all([
          resolveTemplateForSend(supabase, template_name),
          supabase
            .from("crm_leads")
            .select("name, phone, source, servico_interesse")
            .eq("id", lead_id)
            .maybeSingle()
            .then(({ data }) => data),
          supabase
            .from("crm_appointments")
            .select("scheduled_date, scheduled_time")
            .eq("lead_id", lead_id)
            .in("status", ["confirmed", "pending"])
            .order("scheduled_date", { ascending: true })
            .limit(1)
            .maybeSingle()
            .then(({ data }) => data),
        ]);

        if (tplRow) {
          resolvedTemplateName = tplRow.name;
          const headerType = (tplRow.header_type || "").toUpperCase();
          const bodyText = tplRow.body_text || "";
          const placeholderIndexes = getTemplatePlaceholderIndexes(bodyText);

          let formattedApptDate: string | null = null;
          if (nextAppt?.scheduled_date) {
            const [y, m, d] = nextAppt.scheduled_date.split("-");
            const timePart = nextAppt.scheduled_time ? ` às ${nextAppt.scheduled_time.slice(0, 5)}` : "";
            formattedApptDate = `${d}/${m}/${y}${timePart}`;
          }
          const fallbackValues = buildTemplateFallbacks(tplLead || null, formattedApptDate);

          if (["IMAGE", "VIDEO", "DOCUMENT"].includes(headerType) && tplRow.header_content) {
            resolvedComponents = resolvedComponents.filter((component: any) => String(component?.type || "").toLowerCase() !== "header");

            // Tenta cachear a mídia num bucket público estável. Se falhar (URL do
            // Meta expirada, bucket com limite, RLS bloqueando etc.), NÃO derrubar
            // o envio — cai de volta para a URL original do Meta. Se essa também
            // não funcionar, o erro do Meta é capturado adiante e vira mensagem
            // com status=failed (visível na conversa), em vez de sumir silencioso.
            let stableHeaderLink: string | null = tplRow.header_content;
            try {
              stableHeaderLink = await ensurePublicTemplateMediaLink(
                supabase,
                resolvedTemplateName,
                headerType,
                tplRow.header_content,
              );

              if (stableHeaderLink && stableHeaderLink !== tplRow.header_content) {
                await supabase
                  .from("crm_whatsapp_templates")
                  .update({ header_content: stableHeaderLink, updated_at: new Date().toISOString() })
                  .eq("name", resolvedTemplateName);
              }
            } catch (mediaErr) {
              console.warn(
                `[send-whatsapp] Falha ao cachear mídia do template ${resolvedTemplateName}: ${mediaErr instanceof Error ? mediaErr.message : String(mediaErr)} — usando URL original.`,
              );
              stableHeaderLink = tplRow.header_content;
            }

            const headerComponent = stableHeaderLink ? buildMediaHeaderComponent(headerType, stableHeaderLink) : null;
            if (headerComponent) {
              resolvedComponents.unshift(headerComponent);
            }
          }

          if (placeholderIndexes.length > 0) {
            const bodyIndex = resolvedComponents.findIndex((component: any) => String(component?.type || "").toLowerCase() === "body");
            const existingBody = bodyIndex >= 0 ? resolvedComponents[bodyIndex] : null;
            const existingParams = Array.isArray(existingBody?.parameters) ? existingBody.parameters : [];
            const shouldRebuildBody =
              bodyIndex === -1 ||
              existingParams.length !== placeholderIndexes.length ||
              existingParams.some((parameter: any) => {
                const textValue = String(parameter?.text || "").trim().toLowerCase();
                return !textValue || textValue === "cliente" || textValue.includes("{{");
              });

            if (shouldRebuildBody) {
              const bodyComponent = {
                type: "body",
                parameters: placeholderIndexes.map((_, index) => ({
                  type: "text",
                  text: (fallbackValues[index] || fallbackValues[0]).trim() || "cliente",
                })),
              };

              if (bodyIndex >= 0) {
                resolvedComponents[bodyIndex] = bodyComponent;
              } else {
                resolvedComponents.push(bodyComponent);
              }
            }
          }

          console.log(`[send-whatsapp] Resolved ${resolvedComponents.length} component(s) for template ${resolvedTemplateName}`, JSON.stringify(resolvedComponents));
        }
      }

      waBody.template = {
        name: resolvedTemplateName,
        language: { code: template_language || "pt_BR" },
        ...(resolvedComponents.length > 0 ? { components: resolvedComponents } : {}),
      };
      sentTemplateName = resolvedTemplateName || sentTemplateName;
    } else if (type === "text") {
      if (!message) {
        return new Response(JSON.stringify({ error: "Missing message for text type" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      waBody.type = "text";
      waBody.text = { body: message };
    } else if (media_url) {
      console.log(`[send-whatsapp] Downloading media: ${media_url}, type: ${type}`);

      let fileBlob: Blob;
      const chatMediaMarker = "/storage/v1/object/";
      const isChatMedia = media_url.includes(chatMediaMarker) && media_url.includes("chat-media");

      if (isChatMedia) {
        const pathMatch = media_url.match(/chat-media\/(.+?)(?:\?|$)/);
        const storagePath = pathMatch ? decodeURIComponent(pathMatch[1]) : null;

        if (storagePath) {
          console.log(`[send-whatsapp] Downloading from private bucket, path: ${storagePath}`);
          const { data: fileData, error: downloadError } = await supabase.storage
            .from("chat-media")
            .download(storagePath);

          if (downloadError || !fileData) {
            console.error(`[send-whatsapp] Failed to download from storage: ${JSON.stringify(downloadError)}`);
            return new Response(JSON.stringify({ error: "Failed to download file from storage", details: downloadError }), {
              status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          fileBlob = fileData;
        } else {
          const { data: signedData } = await supabase.storage.from("chat-media").createSignedUrl(media_url, 300);
          const fileResponse = await fetch(signedData?.signedUrl || media_url);
          if (!fileResponse.ok) {
            return new Response(JSON.stringify({ error: "Failed to download file from storage", status: fileResponse.status }), {
              status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          fileBlob = await fileResponse.blob();
        }
      } else {
        const fileResponse = await fetch(media_url);
        if (!fileResponse.ok) {
          console.error(`[send-whatsapp] Failed to download file: ${fileResponse.status}`);
          return new Response(JSON.stringify({ error: "Failed to download file from storage", status: fileResponse.status }), {
            status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        fileBlob = await fileResponse.blob();
      }

      let filename = "file";
      try {
        const parsedUrl = new URL(media_url);
        filename = decodeURIComponent(parsedUrl.pathname.split("/").pop() || "file");
      } catch {
        const cleanUrl = media_url.split("?")[0];
        const urlParts = cleanUrl.split("/");
        filename = urlParts[urlParts.length - 1] || "file";
      }

      const ext = filename.split(".").pop()?.toLowerCase() || "";

      const contentTypeMap: Record<string, string> = {
        ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg",
        webm: type === "audio" ? "audio/ogg" : "video/webm",
        mp3: "audio/mpeg", m4a: "audio/mp4",
        wav: "audio/wav", aac: "audio/aac",
        mp4: type === "video" ? "video/mp4" : "audio/mp4",
        jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
        pdf: "application/pdf", doc: "application/msword",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        xls: "application/vnd.ms-excel",
        xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      };
      const contentType = contentTypeMap[ext] || fileBlob.type || "application/octet-stream";

      const audioExtensions = new Set(["ogg", "oga", "opus", "mp3", "m4a", "wav", "aac", "webm", "amr"]);
      const isAudioFile = type === "audio" || audioExtensions.has(ext) || contentType.toLowerCase().startsWith("audio/");
      if (isAudioFile && type !== "audio") {
        console.log(`[send-whatsapp] Correcting type from "${type}" to "audio" based on file: ${filename}`);
      }
      finalType = isAudioFile ? "audio" : type;
      const resolvedType = finalType;

      const uploadFilename = resolvedType === "audio" ? filename.replace(/\.\w+$/, ".ogg") : filename;
      const uploadContentType = resolvedType === "audio" ? "audio/ogg" : contentType;

      console.log(`[send-whatsapp] Uploading to Meta: filename=${uploadFilename}, contentType=${uploadContentType}, size=${fileBlob.size}, resolvedType=${resolvedType}`);

      const formData = new FormData();
      formData.append("messaging_product", "whatsapp");
      formData.append("file", new File([fileBlob], uploadFilename, { type: uploadContentType }));
      formData.append("type", uploadContentType);

      const uploadResponse = await fetch(
        `https://graph.facebook.com/v25.0/${phoneNumberId}/media`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${whatsappToken}` },
          body: formData,
        }
      );
      const uploadData = await uploadResponse.json();

      console.log(`[send-whatsapp] Meta upload response: ${JSON.stringify(uploadData)}`);

      if (!uploadResponse.ok || !uploadData.id) {
        console.error(`[send-whatsapp] Meta media upload failed: ${JSON.stringify(uploadData)}`);
        return new Response(JSON.stringify({ error: "Meta media upload failed", details: uploadData }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const mediaId = uploadData.id;

      waBody.type = resolvedType;
      if (resolvedType === "image") {
        waBody.image = { id: mediaId, caption: message || undefined };
      } else if (resolvedType === "audio") {
        waBody.audio = audio_voice ? { id: mediaId, voice: true } : { id: mediaId };
      } else if (resolvedType === "video") {
        waBody.video = { id: mediaId, caption: message || undefined };
      } else if (resolvedType === "document") {
        waBody.document = { id: mediaId, caption: message || undefined, filename };
      } else if (resolvedType === "sticker") {
        waBody.sticker = { id: mediaId };
      } else {
        return new Response(JSON.stringify({ error: `Unsupported media type: ${resolvedType}` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      return new Response(JSON.stringify({ error: "Missing media_url for non-text message" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[send-whatsapp] Sending to META phoneId=${phoneNumberId} tokenLen=${whatsappToken.length} type=${type} payload=${JSON.stringify(waBody)}`);

    const waResponse = await fetch(
      `https://graph.facebook.com/v25.0/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${whatsappToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(waBody),
      }
    );

    const waData = await waResponse.json();

    if (!waResponse.ok) {
      const metaError = waData?.error?.message || waData?.error?.error_user_msg || JSON.stringify(waData?.error || waData);
      const metaErrorCode = waData?.error?.code || waResponse.status;
      console.error(`[send-whatsapp] META API error (${metaErrorCode}) status=${waResponse.status}: ${metaError} | full=${JSON.stringify(waData)}`);


      // Translate common META errors to user-friendly Portuguese
      let friendlyError = metaError;
      if (metaError.includes("Re-engage") || metaError.includes("24 hour")) {
        friendlyError = "Janela de 24h expirada. Use um template para reabrir a conversa.";
      } else if (metaError.includes("not a valid WhatsApp") || metaError.includes("Recipient phone number not in allowed")) {
        friendlyError = "Número não registrado no WhatsApp.";
      } else if (metaError.includes("template") && metaError.includes("not found")) {
        friendlyError = "Template não encontrado ou não aprovado pela META.";
      } else if (metaError.includes("rate limit") || metaError.includes("throttl")) {
        friendlyError = "Limite de envio atingido. Tente novamente em alguns minutos.";
      } else if (metaError.includes("spam") || metaError.includes("blocked")) {
        friendlyError = "Mensagem bloqueada pela META (possível spam ou bloqueio do contato).";
      }

      // Still insert the message as failed so user can see it in chat
      const dbContent = type === "template" ? `📋 Template: ${sentTemplateName || "template"}` : type === "interactive" ? (body || message || "[menu]") : (message || null);
      const dbType = type === "template" || type === "interactive" ? "text" : finalType;
      const { data: failedMsg } = await supabase.from("messages").insert({
        lead_id,
        direction: "outbound",
        type: dbType,
        content: dbContent,
        media_url: media_url || null,
        status: "failed",
        error_reason: friendlyError,
        reply_to_message_id: reply_to_message_id || null,
        ...(leadTenantId ? { tenant_id: leadTenantId } : {}),
      }).select().single();

      return new Response(JSON.stringify({ ok: false, error: friendlyError, error_code: metaErrorCode, message: failedMsg }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sentWamid = waData?.messages?.[0]?.id || null;
    const initialStatus = waData?.messages?.[0]?.message_status || "accepted";
    const dbContent = type === "template" ? `📋 Template: ${sentTemplateName || "template"}` : type === "interactive" ? (body || message || "[menu]") : (message || null);
    const dbType = type === "template" || type === "interactive" ? "text" : finalType;
    const { data: msg, error: insertError } = await supabase.from("messages").insert({
      lead_id,
      direction: "outbound",
      type: dbType,
      content: dbContent,
      media_url: media_url || null,
      status: initialStatus,
      whatsapp_message_id: sentWamid,
      reply_to_message_id: reply_to_message_id || null,
      ...(leadTenantId ? { tenant_id: leadTenantId } : {}),
    }).select().single();

    if (insertError) {
      return new Response(JSON.stringify({ error: "DB insert error", details: insertError }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date().toISOString();
    // When a bot has "Marcar como lida" disabled, we skip updating last_outbound_at
    // so the conversation continues to appear as "aguardando resposta" in the CRM.
    const leadUpdate: Record<string, any> = {
      last_message: message || `[${finalType}]`,
      last_message_at: now,
    };
    if (!skip_mark_as_read) {
      leadUpdate.last_outbound_at = now;
    }
    await supabase.from("crm_leads").update(leadUpdate).eq("id", lead_id);

    return new Response(JSON.stringify({ success: true, message: msg, whatsapp: waData }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
