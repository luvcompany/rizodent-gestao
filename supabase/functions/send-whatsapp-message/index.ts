import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const whatsappToken = Deno.env.get("WHATSAPP_TOKEN");
    const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");

    if (!whatsappToken || !phoneNumberId) {
      return new Response(JSON.stringify({ error: "WhatsApp secrets not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { lead_id, to, message, type = "text", media_url, template_name, template_language, template_components, reply_to_wamid, reply_to_message_id } = await req.json();

    if (!lead_id || !to) {
      return new Response(JSON.stringify({ error: "Missing lead_id or to" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create Supabase client early - needed for wamid lookup
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    let waBody: any = { messaging_product: "whatsapp", to };

    // Add reply context - resolve wamid from DB if not provided directly
    let resolvedWamid = reply_to_wamid || null;
    if (!resolvedWamid && reply_to_message_id) {
      const { data: origMsg } = await supabase
        .from("messages")
        .select("whatsapp_message_id")
        .eq("id", reply_to_message_id)
        .single();
      resolvedWamid = origMsg?.whatsapp_message_id || null;
    }
    if (resolvedWamid) {
      waBody.context = { message_id: resolvedWamid };
    }

    if (type === "template") {
      waBody.type = "template";
      waBody.template = {
        name: template_name,
        language: { code: template_language || "pt_BR" },
        components: template_components || [],
      };
    } else if (type === "text") {
      if (!message) {
        return new Response(JSON.stringify({ error: "Missing message for text type" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      waBody.type = "text";
      waBody.text = { body: message };
    } else if (media_url) {
      // Step 1: Download the file from Supabase Storage
      const fileResponse = await fetch(media_url);
      if (!fileResponse.ok) {
        return new Response(JSON.stringify({ error: "Failed to download file from storage", status: fileResponse.status }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const fileBlob = await fileResponse.blob();
      
      // Extract filename from URL
      const urlParts = media_url.split("/");
      const filename = urlParts[urlParts.length - 1] || "file";
      const ext = filename.split(".").pop()?.toLowerCase() || "";

      // Map correct content-type based on extension (storage may return generic types)
      const contentTypeMap: Record<string, string> = {
        ogg: "audio/ogg",
        opus: "audio/ogg",
        mp3: "audio/mpeg",
        m4a: "audio/mp4",
        wav: "audio/wav",
        webm: type === "audio" ? "audio/webm" : "video/webm",
        mp4: type === "video" ? "video/mp4" : "audio/mp4",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        webp: "image/webp",
        pdf: "application/pdf",
        doc: "application/msword",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        xls: "application/vnd.ms-excel",
        xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      };
      const contentType = contentTypeMap[ext] || fileResponse.headers.get("content-type") || "application/octet-stream";

      // Step 2: Upload to Meta's media API
      const formData = new FormData();
      formData.append("messaging_product", "whatsapp");
      formData.append("file", new File([fileBlob], filename, { type: contentType }));
      formData.append("type", contentType);

      const uploadResponse = await fetch(
        `https://graph.facebook.com/v25.0/${phoneNumberId}/media`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${whatsappToken}` },
          body: formData,
        }
      );
      const uploadData = await uploadResponse.json();

      if (!uploadResponse.ok || !uploadData.id) {
        return new Response(JSON.stringify({ error: "Meta media upload failed", details: uploadData }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const mediaId = uploadData.id;

      // Step 3: Build message body with media_id
      waBody.type = type;
      if (type === "image") {
        waBody.image = { id: mediaId, caption: message || undefined };
      } else if (type === "audio") {
        waBody.audio = { id: mediaId };
      } else if (type === "video") {
        waBody.video = { id: mediaId, caption: message || undefined };
      } else if (type === "document") {
        waBody.document = { id: mediaId, caption: message || undefined, filename: message || filename };
      } else if (type === "sticker") {
        waBody.sticker = { id: mediaId };
      } else {
        return new Response(JSON.stringify({ error: `Unsupported media type: ${type}` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      return new Response(JSON.stringify({ error: "Missing media_url for non-text message" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Send message via WhatsApp API
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
      return new Response(JSON.stringify({ error: "WhatsApp API error", details: waData }), {
        status: waResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Save message to DB
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Extract the wamid from Meta's response
    const sentWamid = waData?.messages?.[0]?.id || null;

    const dbContent = type === "template" ? `📋 Template: ${template_name}` : (message || null);
    const { data: msg, error: insertError } = await supabase.from("messages").insert({
      lead_id,
      direction: "outbound",
      type: type === "template" ? "text" : type,
      content: dbContent,
      media_url: media_url || null,
      status: "sent",
      whatsapp_message_id: sentWamid,
      reply_to_message_id: reply_to_message_id || null,
    }).select().single();

    if (insertError) {
      return new Response(JSON.stringify({ error: "DB insert error", details: insertError }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("crm_leads").update({
      last_message: message || `[${type}]`,
      last_message_at: new Date().toISOString(),
    }).eq("id", lead_id);

    return new Response(JSON.stringify({ success: true, message: msg, whatsapp: waData }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
