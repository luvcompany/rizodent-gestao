import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { authorizeInternal } from "../_shared/internalAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}
function mimeToFormat(mime: string): string {
  const m = (mime || "").toLowerCase();
  if (m.includes("ogg") || m.includes("opus")) return "ogg";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav")) return "wav";
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "m4a";
  if (m.includes("webm")) return "webm";
  if (m.includes("flac")) return "flac";
  return "ogg";
}

async function transcribeAudio(mediaUrl: string, supabase: any, apiKey: string): Promise<string | null> {
  const path = extractStoragePath(mediaUrl);
  let bytes: Uint8Array;
  let mime = "audio/ogg";
  if (path) {
    const { data, error } = await supabase.storage.from("chat-media").download(path);
    if (error || !data) return null;
    bytes = new Uint8Array(await data.arrayBuffer());
    mime = (data as Blob).type || mime;
  } else {
    const r = await fetch(mediaUrl);
    if (!r.ok) return null;
    bytes = new Uint8Array(await r.arrayBuffer());
    mime = r.headers.get("content-type") || mime;
  }
  const b64 = bytesToBase64(bytes);
  const format = mimeToFormat(mime);
  const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: "Você transcreve áudios em PT-BR. Devolva APENAS o texto transcrito. Se não houver fala, responda: [áudio sem fala]." },
        { role: "user", content: [{ type: "text", text: "Transcreva:" }, { type: "input_audio", input_audio: { data: b64, format } }] },
      ],
    }),
  });
  if (!aiResp.ok) return null;
  const j = await aiResp.json();
  return (j?.choices?.[0]?.message?.content || "").trim() || null;
}

function parseJsonTolerant(text: string): { reply: string; action: string; action_reason?: string } | null {
  if (!text) return null;
  // strip code fences
  let t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  // try direct
  try {
    const o = JSON.parse(t);
    if (typeof o.reply === "string") return { reply: o.reply, action: o.action === "handoff" ? "handoff" : "reply", action_reason: o.action_reason };
  } catch (_) { /* noop */ }
  // try first {...} block
  const m = t.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const o = JSON.parse(m[0]);
      if (typeof o.reply === "string") return { reply: o.reply, action: o.action === "handoff" ? "handoff" : "reply", action_reason: o.action_reason };
    } catch (_) { /* noop */ }
  }
  return null;
}

const DEFAULT_KB = `A Bia é atendente da clínica odontológica Rizodent (interior da Bahia; unidades em Itabuna, Guanambi, Ipiaú e Vitória da Conquista). Objetivo: acolher, tirar dúvidas, tratar objeções e AGENDAR a avaliação gratuita (com raio-x incluso). Tom PT-BR informal, caloroso, humano; mensagens curtas (1-3 linhas); no máximo 1 emoji; nunca dizer que é robô/IA a menos que perguntem.

Regras de ouro: nunca deixe o preço travar (converta em avaliação gratuita + raio-x); ofereça SEMPRE 2 horários fechados; fale de pagamento (cartão, boleto, carnê, entrada baixa); dor = urgência + handoff; pergunte a cidade cedo; não aceitamos convênios externos; avaliação é gratuita e inclui raio-x panorâmico.

Faixas: facetas ~R$350–550/dente; manutenção de aparelho ~R$90/mês. Nunca jogue valor cheio de protocolo (R$9–14 mil) sem antes falar de entrada/parcela.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") || "";
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const auth = await authorizeInternal(req, supabase, { allowUserJwt: true });
    if (!auth.ok) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json().catch(() => ({}));
    const leadId = body.lead_id as string | undefined;
    const triggerMsgId = (body.trigger_message_id as string | undefined) || null;
    if (!leadId) {
      return new Response(JSON.stringify({ error: "lead_id é obrigatório" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Load active config
    const { data: config } = await supabase
      .from("ai_assistant_config")
      .select("*")
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!config) return new Response(JSON.stringify({ skipped: "no_config" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (config.copilot_enabled === false) {
      return new Response(JSON.stringify({ skipped: "copilot_disabled" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Load lead
    const { data: lead } = await supabase
      .from("crm_leads")
      .select("id, tenant_id, name, phone, source, tags, cidade, servico_interesse, value, notes")
      .eq("id", leadId)
      .maybeSingle();
    if (!lead) return new Response(JSON.stringify({ error: "Lead não encontrado" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Load last ~60 messages (only meaningful types)
    const { data: msgsDesc } = await supabase
      .from("messages")
      .select("id, direction, type, content, media_url, transcription, created_at")
      .eq("lead_id", leadId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(60);
    const msgs = (msgsDesc || []).reverse();

    if (!msgs.length) {
      return new Response(JSON.stringify({ skipped: "no_messages" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Transcribe pending audios
    const pending = msgs.filter((m: any) => m.type === "audio" && !m.transcription && m.media_url);
    if (pending.length && LOVABLE_API_KEY) {
      for (const m of pending) {
        try {
          const t = await transcribeAudio(m.media_url, supabase, LOVABLE_API_KEY);
          if (t) {
            m.transcription = t;
            await supabase.from("messages").update({ transcription: t }).eq("id", m.id);
          }
        } catch (_) { /* ignore */ }
      }
    }

    // Build chat history (inbound=user, outbound=assistant)
    const history: Array<{ role: "user" | "assistant"; content: string }> = [];
    for (const m of msgs) {
      const role = m.direction === "inbound" ? "user" : "assistant";
      let content = "";
      if (m.type === "audio") content = m.transcription ? m.transcription : "[áudio não transcrito]";
      else if (m.type === "image") content = m.content ? `[imagem] ${m.content}` : "[imagem]";
      else if (m.type === "video") content = m.content ? `[vídeo] ${m.content}` : "[vídeo]";
      else if (m.type === "document") content = m.content ? `[documento] ${m.content}` : "[documento]";
      else content = (m.content || "").trim();
      if (!content) continue;
      history.push({ role, content });
    }
    if (!history.length) {
      return new Response(JSON.stringify({ skipped: "no_text_history" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const kb = (config.knowledge_base && String(config.knowledge_base).trim()) || DEFAULT_KB;
    const persona = config.assistant_display_name || "Bia";

    const leadInfo = [
      `Nome: ${lead.name || "—"}`,
      `Telefone: ${lead.phone || "—"}`,
      `Cidade: ${lead.cidade || "—"}`,
      `Serviço de interesse: ${lead.servico_interesse || "—"}`,
      `Origem: ${lead.source || "—"}`,
      `Tags: ${(lead.tags || []).join(", ") || "—"}`,
      `Anotações internas: ${lead.notes || "—"}`,
    ].join("\n");

    const systemPrompt = `Você é a "${persona}", atendente humana da Rizodent. Responda em PT-BR informal, caloroso, mensagens curtas (1-3 linhas), no máximo 1 emoji. Nunca diga que é robô/IA a menos que perguntem.

=== BASE DE CONHECIMENTO ===
${kb}

=== DADOS DO LEAD ===
${leadInfo}

=== TAREFA ===
Gere a PRÓXIMA mensagem que deve ser enviada agora ao paciente, com base no histórico. Decida também a ação:
- action="reply" → resposta direta ao paciente.
- action="handoff" → quando houver dor forte/urgência, reclamação, pedido de humano, ou negociação de preço complexa.

Responda SOMENTE com JSON válido no formato:
{"reply":"...","action":"reply"|"handoff","action_reason":"motivo curto"}`;

    const modelId: string = config.model || "google/gemini-3-flash-preview";
    let aiText = "";
    let usedModel = modelId;

    if (modelId.startsWith("anthropic/") && ANTHROPIC_API_KEY) {
      const anthropicModel = modelId.replace(/^anthropic\//, "");
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: anthropicModel,
          max_tokens: 600,
          system: systemPrompt,
          messages: history.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      if (!r.ok) {
        const t = await r.text();
        return new Response(JSON.stringify({ error: `anthropic ${r.status}: ${t}` }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      usedModel = modelId;
      const j = await r.json();
      aiText = (j?.content || []).map((c: any) => c?.text || "").join("\n").trim();
    } else {
      // Fallback to Lovable AI Gateway (also used when Anthropic key is missing)
      const fallbackModel = modelId.startsWith("anthropic/") ? "google/gemini-2.5-flash" : modelId;
      usedModel = fallbackModel;
      aiText = (j?.content || []).map((c: any) => c?.text || "").join("\n").trim();
    } else {
      if (!LOVABLE_API_KEY) {
        return new Response(JSON.stringify({ error: "LOVABLE_API_KEY não configurado" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: "system", content: systemPrompt }, ...history],
        }),
      });
      if (r.status === 429) return new Response(JSON.stringify({ error: "rate_limited" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (r.status === 402) return new Response(JSON.stringify({ error: "credits_exhausted" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (!r.ok) {
        const t = await r.text();
        return new Response(JSON.stringify({ error: `gateway ${r.status}: ${t}` }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const j = await r.json();
      aiText = j?.choices?.[0]?.message?.content || "";
    }

    const parsed = parseJsonTolerant(aiText);
    if (!parsed || !parsed.reply.trim()) {
      return new Response(JSON.stringify({ error: "parse_failed", raw: aiText }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Mark prior pending as superseded
    await supabase
      .from("ai_reply_suggestions")
      .update({ status: "superseded", decided_at: new Date().toISOString() })
      .eq("lead_id", leadId)
      .eq("status", "pending");

    const insert = {
      lead_id: leadId,
      tenant_id: lead.tenant_id || null,
      trigger_message_id: triggerMsgId,
      suggested_text: parsed.reply.trim(),
      action: parsed.action,
      action_reason: parsed.action_reason || null,
      status: "pending",
      model: usedModel,
    };
    const { data: row, error: insErr } = await supabase
      .from("ai_reply_suggestions")
      .insert(insert)
      .select()
      .single();
    if (insErr) {
      return new Response(JSON.stringify({ error: insErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ suggestion: row }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("generate-reply-suggestion error:", e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
