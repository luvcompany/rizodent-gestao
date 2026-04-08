import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MEDIA_TYPES = ["image", "audio", "document", "video", "sticker"] as const;
const isPublicMediaUrl = (mediaUrl: string | null) => Boolean(mediaUrl?.startsWith("http"));

async function downloadAndStoreMedia(
  mediaId: string,
  msgType: string,
  whatsappToken: string,
  supabase: ReturnType<typeof createClient>,
) {
  const metaRes = await fetch(`https://graph.facebook.com/v25.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${whatsappToken}` },
  });
  const metaData = await metaRes.json();

  if (!metaRes.ok || !metaData?.url) {
    throw new Error(`Falha ao buscar mídia ${mediaId}: ${JSON.stringify(metaData)}`);
  }

  const fileRes = await fetch(metaData.url, {
    headers: { Authorization: `Bearer ${whatsappToken}` },
  });

  if (!fileRes.ok) {
    throw new Error(`Falha ao baixar mídia ${mediaId}: ${await fileRes.text()}`);
  }

  const fileBlob = await fileRes.blob();
  const mimeType = metaData.mime_type || fileBlob.type || "application/octet-stream";
  const extMap: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "audio/ogg": "ogg",
    "audio/ogg; codecs=opus": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/wav": "wav",
    "video/mp4": "mp4",
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  };

  const ext = extMap[mimeType] || mimeType.split("/").pop() || "bin";
  const path = `${msgType}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("chat-media")
    .upload(path, fileBlob, { contentType: mimeType, upsert: false });

  if (uploadError) {
    throw new Error(`Falha no upload para storage: ${JSON.stringify(uploadError)}`);
  }

  return supabase.storage.from("chat-media").getPublicUrl(path).data.publicUrl;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate authenticated user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    console.log("getClaims result:", JSON.stringify({ claimsError, sub: claimsData?.claims?.sub }));
    if (claimsError || !claimsData?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized", detail: claimsError?.message }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub;

    // Verify admin or gerente role server-side
    const adminClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: roleRows, error: roleError } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .in("role", ["admin", "gerente"]);
    console.log("Role check:", JSON.stringify({ userId, roleRows, roleError }));
    if (!roleRows || roleRows.length === 0) {
      return new Response(JSON.stringify({ error: "Forbidden: admin or gerente role required", userId }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const whatsappToken = Deno.env.get("WHATSAPP_TOKEN");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!whatsappToken || !supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: "Missing required secrets" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { leadId } = await req.json().catch(() => ({ leadId: null }));

    let query = supabase
      .from("messages")
      .select("id, lead_id, type, media_url")
      .not("media_url", "is", null)
      .in("type", [...MEDIA_TYPES]);

    if (leadId) {
      query = query.eq("lead_id", leadId);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Erro ao buscar mensagens legadas: ${JSON.stringify(error)}`);
    }

    const legacyMessages = (data || []).filter((message) => !isPublicMediaUrl(message.media_url));
    const repaired: Array<{ id: string; media_url: string }> = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const message of legacyMessages) {
      try {
        const publicUrl = await downloadAndStoreMedia(message.media_url!, message.type, whatsappToken, supabase);
        const { error: updateError } = await supabase
          .from("messages")
          .update({ media_url: publicUrl })
          .eq("id", message.id);

        if (updateError) {
          throw new Error(JSON.stringify(updateError));
        }

        repaired.push({ id: message.id, media_url: publicUrl });
      } catch (repairError) {
        failed.push({
          id: message.id,
          error: repairError instanceof Error ? repairError.message : "Erro desconhecido",
        });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      total: legacyMessages.length,
      repaired,
      failed,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Erro desconhecido",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
