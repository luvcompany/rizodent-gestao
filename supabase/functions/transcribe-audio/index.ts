import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: any, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function extractStoragePath(url: string): string | null {
  if (!url) return null;
  const pub = "/storage/v1/object/public/chat-media/";
  const sig = "/storage/v1/object/sign/chat-media/";
  let i = url.indexOf(pub);
  if (i !== -1) return url.substring(i + pub.length).split("?")[0];
  i = url.indexOf(sig);
  if (i !== -1) return url.substring(i + sig.length).split("?")[0];
  return null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function mimeToFormat(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("ogg") || m.includes("opus")) return "ogg";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav")) return "wav";
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "m4a";
  if (m.includes("webm")) return "webm";
  if (m.includes("flac")) return "flac";
  return "ogg";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!LOVABLE_API_KEY) return json({ error: "LOVABLE_API_KEY não configurado" }, 500);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Não autenticado" }, 401);

    // Validate JWT
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claims?.claims?.sub) return json({ error: "Não autorizado" }, 401);

    const body = await req.json().catch(() => ({}));
    const messageId = body.message_id as string | undefined;
    const force = !!body.force;
    if (!messageId) return json({ error: "message_id é obrigatório" }, 400);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: msg, error: msgErr } = await admin
      .from("messages")
      .select("id, type, media_url, transcription")
      .eq("id", messageId)
      .maybeSingle();

    if (msgErr || !msg) return json({ error: "Mensagem não encontrada" }, 404);
    if (msg.type !== "audio") return json({ error: "Mensagem não é um áudio" }, 400);
    if (msg.transcription && !force) {
      return json({ transcription: msg.transcription, cached: true });
    }
    if (!msg.media_url) return json({ error: "Áudio sem URL de mídia" }, 400);

    // Download audio bytes
    const path = extractStoragePath(msg.media_url);
    let audioBytes: Uint8Array | null = null;
    let mime = "audio/ogg";

    if (path) {
      const { data: fileData, error: dlErr } = await admin.storage.from("chat-media").download(path);
      if (dlErr || !fileData) return json({ error: `Falha ao baixar áudio: ${dlErr?.message}` }, 500);
      audioBytes = new Uint8Array(await fileData.arrayBuffer());
      mime = fileData.type || mime;
    } else {
      // External URL fallback
      const r = await fetch(msg.media_url);
      if (!r.ok) return json({ error: "Falha ao baixar áudio externo" }, 500);
      audioBytes = new Uint8Array(await r.arrayBuffer());
      mime = r.headers.get("content-type") || mime;
    }

    const b64 = bytesToBase64(audioBytes);
    const format = mimeToFormat(mime);

    // Call Lovable AI Gateway with audio (OpenAI-compatible input_audio for Gemini)
    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "Você transcreve áudios em português brasileiro. Devolva APENAS o texto transcrito, sem comentários, sem aspas, sem prefixos. Preserve pontuação e nomes próprios. Se o áudio não tiver fala, responda exatamente: [áudio sem fala].",
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Transcreva este áudio:" },
              { type: "input_audio", input_audio: { data: b64, format } },
            ],
          },
        ],
      }),
    });

    if (aiResp.status === 429) return json({ error: "Limite de requisições atingido. Tente em instantes." }, 429);
    if (aiResp.status === 402) return json({ error: "Créditos da IA esgotados." }, 402);
    if (!aiResp.ok) {
      const t = await aiResp.text();
      console.error("AI gateway error:", aiResp.status, t);
      return json({ error: "Erro no gateway de IA", detail: t }, 500);
    }

    const data = await aiResp.json();
    const text: string = (data?.choices?.[0]?.message?.content || "").trim();
    if (!text) return json({ error: "Transcrição vazia" }, 500);

    await admin.from("messages").update({ transcription: text }).eq("id", messageId);

    return json({ transcription: text, cached: false });
  } catch (e: any) {
    console.error("transcribe-audio error:", e);
    return json({ error: e?.message || "Erro desconhecido" }, 500);
  }
});
