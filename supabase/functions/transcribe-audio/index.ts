import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { resolveCaller, assertMessageInTenant } from "../_shared/authz.ts";

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

function extractStoragePath(url: string, bucket: string): string | null {
  if (!url) return null;
  const pub = `/storage/v1/object/public/${bucket}/`;
  const sig = `/storage/v1/object/sign/${bucket}/`;
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

function mimeToExt(mime: string): string {
  const m = (mime || "").toLowerCase();
  if (m.includes("ogg") || m.includes("opus")) return "ogg";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav")) return "wav";
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "m4a";
  if (m.includes("webm")) return "webm";
  if (m.includes("flac")) return "flac";
  return "ogg";
}

async function transcribeWithOpenAI(
  audioBytes: Uint8Array,
  mime: string,
  model: string,
  apiKey: string,
): Promise<string> {
  const ext = mimeToExt(mime);
  const form = new FormData();
  const blob = new Blob([audioBytes], { type: mime || "audio/ogg" });
  form.append("file", blob, `audio.${ext}`);
  form.append("model", model);
  form.append("language", "pt");
  form.append("response_format", "text");
  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`openai ${r.status}: ${t.substring(0, 300)}`);
  }
  return (await r.text()).trim();
}

async function transcribeWithLovableGatewaySTT(
  audioBytes: Uint8Array,
  mime: string,
  apiKey: string,
): Promise<string> {
  const ext = mimeToExt(mime);
  const form = new FormData();
  const blob = new Blob([audioBytes], { type: mime || "audio/webm" });
  form.append("file", blob, `audio.${ext}`);
  form.append("model", "openai/gpt-4o-mini-transcribe");
  const r = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!r.ok) {
    const t = await r.text();
    console.error("[transcribe-audio] Lovable STT error:", r.status, t);
    throw new Error(`lovable-stt ${r.status}: ${t.substring(0, 400)}`);
  }
  const data = await r.json().catch(() => ({} as any));
  return String(data?.text || "").trim();
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

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const caller = await resolveCaller(req, admin);
    if (!caller.ok) return json({ error: caller.error }, caller.status);

    const body = await req.json().catch(() => ({}));
    const messageId = body.message_id as string | undefined;
    const callId = body.call_id as string | undefined;
    const force = !!body.force;
    if (!messageId && !callId) return json({ error: "message_id ou call_id é obrigatório" }, 400);

    let mediaUrl: string | null = null;
    let existingTranscription: string | null = null;
    let sourceTable: "messages" | "whatsapp_calls" = "messages";
    let sourceId = "";

    let agentUrl: string | null = null;
    let leadUrl: string | null = null;

    if (messageId) {
      const tenantCheck = await assertMessageInTenant(admin, messageId, caller);
      if (!tenantCheck.ok) return json({ error: tenantCheck.error }, tenantCheck.status);

      const { data: msg, error: msgErr } = await admin
        .from("messages")
        .select("id, type, media_url, transcription")
        .eq("id", messageId)
        .maybeSingle();

      if (msgErr || !msg) return json({ error: "Mensagem não encontrada" }, 404);
      if (msg.type !== "audio" && msg.type !== "call") return json({ error: "Mensagem não é um áudio" }, 400);
      mediaUrl = msg.media_url;
      existingTranscription = msg.transcription;
      sourceId = msg.id;
    } else if (callId) {
      const { data: call, error: callErr } = await admin
        .from("whatsapp_calls")
        .select("id, tenant_id, recording_url, recording_url_agent, recording_url_lead, transcription")
        .eq("id", callId)
        .maybeSingle();
      if (callErr || !call) return json({ error: "Ligação não encontrada" }, 404);
      if (!caller.isSuperadmin && call.tenant_id !== caller.tenantId) return json({ error: "Sem permissão para esta ligação" }, 403);
      mediaUrl = call.recording_url;
      agentUrl = (call as any).recording_url_agent || null;
      leadUrl = (call as any).recording_url_lead || null;
      existingTranscription = call.transcription;
      sourceTable = "whatsapp_calls";
      sourceId = call.id;
    }

    if (existingTranscription && !force) {
      return json({ transcription: existingTranscription, cached: true });
    }
    if (!mediaUrl) return json({ error: "Áudio sem URL de mídia" }, 400);

    // Download audio bytes — try call-recordings first, then chat-media, else external
    let audioBytes: Uint8Array | null = null;
    let mime = "audio/ogg";
    const callPath = extractStoragePath(mediaUrl, "call-recordings");
    const chatPath = callPath ? null : extractStoragePath(mediaUrl, "chat-media");

    if (callPath) {
      const { data: fileData, error: dlErr } = await admin.storage.from("call-recordings").download(callPath);
      if (dlErr || !fileData) return json({ error: `Falha ao baixar gravação: ${dlErr?.message}` }, 500);
      audioBytes = new Uint8Array(await fileData.arrayBuffer());
      mime = fileData.type || "audio/webm";
    } else if (chatPath) {
      const { data: fileData, error: dlErr } = await admin.storage.from("chat-media").download(chatPath);
      if (dlErr || !fileData) return json({ error: `Falha ao baixar áudio: ${dlErr?.message}` }, 500);
      audioBytes = new Uint8Array(await fileData.arrayBuffer());
      mime = fileData.type || mime;
    } else {
      const r = await fetch(mediaUrl);
      if (!r.ok) return json({ error: "Falha ao baixar áudio externo" }, 500);
      audioBytes = new Uint8Array(await r.arrayBuffer());
      mime = r.headers.get("content-type") || mime;
    }

    // Read configured transcription model
    const { data: cfg } = await admin
      .from("ai_assistant_config")
      .select("transcription_model")
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const transcriptionModel: string = (cfg as any)?.transcription_model || "google/gemini-2.5-flash";

    let text = "";
    const isCallRecording = !!callPath || sourceTable === "whatsapp_calls" || mime.toLowerCase().includes("webm");

    if (isCallRecording) {
      // Gravações de ligação (webm/opus) — usa STT dedicado do Lovable Gateway
      try {
        text = await transcribeWithLovableGatewaySTT(audioBytes, mime, LOVABLE_API_KEY);
      } catch (e: any) {
        console.error("[transcribe-audio] Lovable STT failed:", e?.message);
        return json({ error: "Erro ao transcrever gravação", detail: e?.message }, 502);
      }
    } else if (transcriptionModel.startsWith("openai/")) {
      const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
      if (!OPENAI_API_KEY) {
        return json({ error: "OPENAI_API_KEY não configurada no backend." }, 500);
      }
      const openaiModel = transcriptionModel.replace(/^openai\//, "");
      try {
        text = await transcribeWithOpenAI(audioBytes, mime, openaiModel, OPENAI_API_KEY);
      } catch (e: any) {
        console.error("OpenAI transcription error:", e?.message);
        return json({ error: "Erro na transcrição OpenAI", detail: e?.message }, 502);
      }
    } else {
      // Default: Lovable AI Gateway with Gemini (input_audio) para áudios normais do chat
      const b64 = bytesToBase64(audioBytes);
      const format = mimeToFormat(mime);
      const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: transcriptionModel,
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
      text = (data?.choices?.[0]?.message?.content || "").trim();
    }

    if (!text) return json({ error: "Transcrição vazia" }, 500);

    await admin.from(sourceTable).update({ transcription: text }).eq("id", sourceId);

    return json({ transcription: text, cached: false });
  } catch (e: any) {
    console.error("transcribe-audio error:", e);
    return json({ error: e?.message || "Erro desconhecido" }, 500);
  }
});
