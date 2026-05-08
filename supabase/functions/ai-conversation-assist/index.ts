import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

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
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
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

async function transcribeAudio(
  mediaUrl: string,
  supabase: any,
  apiKey: string,
): Promise<string | null> {
  const path = extractStoragePath(mediaUrl);
  let bytes: Uint8Array;
  let mime = "audio/ogg";
  if (path) {
    const { data, error } = await supabase.storage.from("chat-media").download(path);
    if (error || !data) throw new Error(`download failed: ${error?.message}`);
    bytes = new Uint8Array(await data.arrayBuffer());
    mime = (data as Blob).type || mime;
  } else {
    const r = await fetch(mediaUrl);
    if (!r.ok) throw new Error(`external fetch failed: ${r.status}`);
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
        {
          role: "system",
          content:
            "Você transcreve áudios em português brasileiro. Devolva APENAS o texto transcrito, sem comentários nem prefixos. Se não houver fala, responda exatamente: [áudio sem fala].",
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
  if (!aiResp.ok) {
    const t = await aiResp.text();
    throw new Error(`ai gateway ${aiResp.status}: ${t}`);
  }
  const j = await aiResp.json();
  return (j?.choices?.[0]?.message?.content || "").trim() || null;
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY não configurado");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const body = await req.json().catch(() => ({}));
    const leadId = body.lead_id as string | undefined;
    const mode = (body.mode as string) || "summary_and_suggestions"; // or "summary", "suggestions"
    const userQuestion = (body.question as string) || "";
    const force = body.force === true;

    if (!leadId) {
      return new Response(JSON.stringify({ error: "lead_id é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch config
    const { data: config } = await supabase
      .from("ai_assistant_config")
      .select("*")
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!config) {
      return new Response(JSON.stringify({ error: "Nenhuma configuração de IA ativa" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch lead
    const { data: lead } = await supabase
      .from("crm_leads")
      .select("id, name, phone, source, tags, cidade, servico_interesse, value, notes")
      .eq("id", leadId)
      .maybeSingle();

    if (!lead) {
      return new Response(JSON.stringify({ error: "Lead não encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch all messages (paginated)
    const PAGE = 1000;
    const allMsgs: any[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("messages")
        .select("id, direction, type, content, media_url, transcription, created_at, channel, status")
        .eq("lead_id", leadId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error || !data?.length) break;
      allMsgs.push(...data);
      if (data.length < PAGE) break;
    }

    // Auto-transcribe any audio messages that don't have a transcription yet
    const pending = allMsgs.filter(
      (m) => m.type === "audio" && !m.transcription && m.media_url,
    );
    if (pending.length > 0) {
      console.log(`Transcribing ${pending.length} pending audios for lead ${leadId}`);
      const CONCURRENCY = 3;
      for (let i = 0; i < pending.length; i += CONCURRENCY) {
        const batch = pending.slice(i, i + CONCURRENCY);
        await Promise.all(
          batch.map(async (m) => {
            try {
              const text = await transcribeAudio(m.media_url, supabase, LOVABLE_API_KEY);
              if (text) {
                m.transcription = text;
                await supabase.from("messages").update({ transcription: text }).eq("id", m.id);
              }
            } catch (e) {
              console.error(`Failed to transcribe message ${m.id}:`, e);
            }
          }),
        );
      }
    }

    if (allMsgs.length === 0) {
      return new Response(
        JSON.stringify({ error: "Esta conversa ainda não tem mensagens para analisar." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const transcript = allMsgs
      .map((m) => {
        const who = m.direction === "inbound" ? "PACIENTE" : "ATENDENTE";
        let txt: string;
        if (m.type === "audio") {
          txt = m.transcription ? `[áudio transcrito] ${m.transcription}` : "[áudio não transcrito]";
        } else {
          txt = (m.content || `[${m.type}]`).replace(/\s+/g, " ").trim();
        }
        const dt = new Date(m.created_at).toLocaleString("pt-BR");
        return `[${dt}] ${who}: ${txt}`;
      })
      .join("\n");

    const leadInfo = `
Nome: ${lead.name}
Telefone: ${lead.phone || "—"}
Cidade: ${lead.cidade || "—"}
Serviço de interesse: ${lead.servico_interesse || "—"}
Origem: ${lead.source || "—"}
Tags: ${(lead.tags || []).join(", ") || "—"}
Valor previsto: ${lead.value || 0}
Anotações internas: ${lead.notes || "—"}
`.trim();

    let userPrompt = "";
    if (mode === "summary") {
      userPrompt = `Resuma de forma objetiva (máx 6 bullets) o histórico abaixo do atendimento.\n\n=== LEAD ===\n${leadInfo}\n\n=== CONVERSA ===\n${transcript}`;
    } else if (mode === "suggestions") {
      userPrompt = `Com base no histórico abaixo, gere 3 a 5 sugestões práticas de próximas mensagens que o atendente pode enviar para avançar o paciente no funil. Cada sugestão deve estar pronta para ser copiada e enviada (em português brasileiro, tom ${config.tone}).\n\n=== LEAD ===\n${leadInfo}\n\n=== CONVERSA ===\n${transcript}`;
    } else if (mode === "ask" && userQuestion) {
      userPrompt = `Responda à pergunta do atendente sobre este atendimento.\n\nPergunta: ${userQuestion}\n\n=== LEAD ===\n${leadInfo}\n\n=== CONVERSA ===\n${transcript}`;
    } else {
      userPrompt = `Analise o histórico de atendimento abaixo e responda em DOIS blocos com cabeçalhos em markdown:

## Resumo
- Resumo objetivo em até 6 bullets (intenção do paciente, etapa atual, objeções, urgência, valores discutidos, próximos passos pendentes).

## Sugestões de Atendimento
- 3 a 5 sugestões práticas de próximas mensagens prontas para enviar (cada sugestão começando com "•" e em parágrafo único, em português brasileiro, tom ${config.tone}).

=== LEAD ===
${leadInfo}

=== CONVERSA (${allMsgs.length} mensagens) ===
${transcript}`;
    }

    const systemPrompt = [
      config.system_prompt,
      config.custom_instructions ? `\n\nInstruções adicionais:\n${config.custom_instructions}` : "",
      `\n\nTom de voz: ${config.tone}. Idioma: ${config.language}.`,
    ].join("");

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model || "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (aiResp.status === 429) {
      return new Response(JSON.stringify({ error: "Limite de requisições atingido. Tente novamente em instantes." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (aiResp.status === 402) {
      return new Response(JSON.stringify({ error: "Créditos da IA esgotados. Adicione créditos no workspace." }), {
        status: 402,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!aiResp.ok) {
      const t = await aiResp.text();
      console.error("AI gateway error:", aiResp.status, t);
      return new Response(JSON.stringify({ error: "Erro no gateway de IA" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await aiResp.json();
    const text = data?.choices?.[0]?.message?.content || "";

    return new Response(
      JSON.stringify({ result: text, message_count: allMsgs.length, model: config.model }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("ai-conversation-assist error:", e);
    return new Response(JSON.stringify({ error: e.message || "Erro desconhecido" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
