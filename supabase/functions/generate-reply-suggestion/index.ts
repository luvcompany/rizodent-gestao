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
  const original = text.trim();
  // strip ``` or ''' fences anywhere
  let t = text.replace(/```(?:json)?/gi, "").replace(/'''(?:json)?/gi, "").trim();

  const tryParse = (s: string) => {
    try {
      const o = JSON.parse(s);
      if (o && typeof o.reply === "string" && o.reply.trim()) {
        return { reply: o.reply, action: o.action === "handoff" ? "handoff" : "reply", action_reason: o.action_reason };
      }
    } catch (_) { /* noop */ }
    return null;
  };

  // direct
  const direct = tryParse(t);
  if (direct) return direct;

  // collect all balanced {...} candidates and try the LAST valid one first
  const candidates: string[] = [];
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== "{") continue;
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < t.length; j++) {
      const c = t[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
      } else {
        if (c === '"') inStr = true;
        else if (c === "{") depth++;
        else if (c === "}") {
          depth--;
          if (depth === 0) { candidates.push(t.substring(i, j + 1)); break; }
        }
      }
    }
  }
  for (let k = candidates.length - 1; k >= 0; k--) {
    const cleaned = candidates[k]
      .replace(/,\s*}/g, "}")
      .replace(/,\s*]/g, "]")
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
    const ok = tryParse(cleaned);
    if (ok) return ok;
  }

  // Last resort: extract the "reply" string field from a possibly-truncated JSON
  // (handles cases where the model hit max_tokens mid-object).
  const replyMatch = t.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)/);
  if (replyMatch) {
    try {
      // Unescape JSON string sequences (\n, \", \\ etc.) safely
      const raw = JSON.parse(`"${replyMatch[1].replace(/"/g, '\\"')}"`);
      const reply = String(raw).trim();
      if (reply) {
        const actionMatch = t.match(/"action"\s*:\s*"(reply|handoff)"/);
        const reasonMatch = t.match(/"action_reason"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        return {
          reply,
          action: actionMatch?.[1] === "handoff" ? "handoff" : "reply",
          action_reason: reasonMatch ? reasonMatch[1] : undefined,
        };
      }
    } catch (_) { /* noop */ }
  }

  // Safe fallback: some models ignore the JSON-only instruction and return the
  // patient-facing message as plain text. Accept it ONLY when it is clearly not
  // JSON/code/serialized data, so malformed JSON is never sent to the patient.
  const jsonish = /^[\s`']*[{\[]/.test(original)
    || /"(?:reply|action|action_reason)"\s*:/.test(original)
    || /```|'''/.test(original);
  const plain = t
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .trim();
  if (!jsonish && plain && plain.length <= 4000) {
    return { reply: plain, action: "reply", action_reason: "plain_text_model_response" };
  }
  return null;
}

const DEFAULT_KB = `A Bia é atendente da clínica odontológica Rizodent (interior da Bahia; unidades em Itabuna, Guanambi, Ipiaú e Vitória da Conquista). Objetivo: acolher, tirar dúvidas, tratar objeções e AGENDAR a avaliação gratuita (com raio-x incluso). Tom PT-BR informal, caloroso, humano; mensagens curtas (1-3 linhas); no máximo 1 emoji; nunca dizer que é robô/IA a menos que perguntem.

Regras de ouro: nunca deixe o preço travar (converta em avaliação gratuita + raio-x); ofereça SEMPRE 2 horários fechados; fale de pagamento (cartão, boleto, carnê, entrada baixa); dor = urgência + handoff; pergunte a cidade cedo; não aceitamos convênios externos; avaliação é gratuita e inclui raio-x panorâmico.

Faixas: facetas ~R$350–550/dente; manutenção de aparelho ~R$90/mês. Nunca jogue valor cheio de protocolo (R$9–14 mil) sem antes falar de entrada/parcela.`;

// Endereços oficiais por unidade (texto exato dos templates de agendamento).
// Se a unidade do lead não estiver aqui, a IA NÃO deve enviar endereço.
const UNIT_ADDRESSES: Record<string, string> = {
  "itabuna": "Avenida Cinquentenário, 375, ao lado da Jan e Ju e em frente ao banco Bradesco",
  "guanambi": "Rua dos Expedicionários, 71 - Centro, ao lado do banco Santander",
  "vitoria da conquista": "Rua Monsenhor Olímpio, 37 - Centro, ao lado da Esquina Embalagens",
  "conquista": "Rua Monsenhor Olímpio, 37 - Centro, ao lado da Esquina Embalagens",
  "ipiau": "Praça Ruy Barbosa, 122 - Centro, em frente à Praça Ruy Barbosa",
};

function normalizeCity(s: string | null | undefined): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]/g, "")
    .trim();
}

function resolveUnitAddress(cidade: string | null | undefined, kb: string): string | null {
  const key = normalizeCity(cidade);
  if (!key) return null;
  // 1) Lookup hardcoded table
  if (UNIT_ADDRESSES[key]) return UNIT_ADDRESSES[key];
  // 2) Try to extract from KB lines like "Endereço Itabuna: ..." ou "Itabuna: Rua ..."
  const lines = (kb || "").split(/\r?\n/);
  for (const ln of lines) {
    const m = ln.match(/^\s*(?:endere[çc]o\s+)?([A-Za-zÀ-ÿ\s]+?)\s*[:\-–]\s*(.+)$/i);
    if (!m) continue;
    if (normalizeCity(m[1]) === key && /\d/.test(m[2])) return m[2].trim();
  }
  return null;
}

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

    // Load lead (incluindo stage_id para resolver a etapa atual)
    const { data: lead } = await supabase
      .from("crm_leads")
      .select("id, tenant_id, name, phone, source, tags, cidade, servico_interesse, value, notes, stage_id, titulo_anuncio, descricao_anuncio, nome_anuncio")
      .eq("id", leadId)
      .maybeSingle();
    if (!lead) return new Response(JSON.stringify({ error: "Lead não encontrado" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Resolver nome da etapa atual
    let stageName: string | null = null;
    if (lead.stage_id) {
      const { data: stg } = await supabase
        .from("crm_stages")
        .select("name")
        .eq("id", lead.stage_id)
        .maybeSingle();
      stageName = stg?.name || null;
    }

    // Carrega TODAS as mensagens do lead em ordem cronológica (paginado).
    const PAGE = 1000;
    let allMsgs: any[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("messages")
        .select("id, direction, type, content, media_url, transcription, created_at")
        .eq("lead_id", leadId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error || !data?.length) break;
      allMsgs.push(...data);
      if (data.length < PAGE) break;
    }

    // Guarda de custo: se estourar 400 mensagens, mantém 50 iniciais + 350 finais.
    let omittedCount = 0;
    let omittedAfterIndex = -1;
    if (allMsgs.length > 400) {
      const head = allMsgs.slice(0, 50);
      const tail = allMsgs.slice(-350);
      omittedCount = allMsgs.length - head.length - tail.length;
      omittedAfterIndex = head.length - 1;
      allMsgs = [...head, ...tail];
    }
    const msgs = allMsgs;

    if (!msgs.length) {
      return new Response(JSON.stringify({ skipped: "no_messages" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Transcreve TODOS os áudios pendentes ANTES de montar o contexto (await sequencial).
    // Marca os que falharem para a IA não assumir o conteúdo.
    const pending = msgs.filter((m: any) => m.type === "audio" && !m.transcription && m.media_url);
    if (pending.length && LOVABLE_API_KEY) {
      for (const m of pending) {
        try {
          const t = await transcribeAudio(m.media_url, supabase, LOVABLE_API_KEY);
          if (t) {
            m.transcription = t;
            await supabase.from("messages").update({ transcription: t }).eq("id", m.id);
          } else {
            m._transcribe_failed = true;
          }
        } catch (_) {
          m._transcribe_failed = true;
        }
      }
    }

    // Carrega notas da conversa (crm_conversation_notes) para ancorar por after_message_id
    // ou expor como "anotações da equipe" no bloco de fatos.
    const { data: convNotesRaw } = await supabase
      .from("crm_conversation_notes")
      .select("id, after_message_id, content, created_at, author_id")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: true });
    const convNotes = convNotesRaw || [];
    const notesByAnchor = new Map<string, any[]>();
    const unanchoredNotes: any[] = [];
    for (const n of convNotes) {
      if (n.after_message_id) {
        const arr = notesByAnchor.get(n.after_message_id) || [];
        arr.push(n);
        notesByAnchor.set(n.after_message_id, arr);
      } else {
        unanchoredNotes.push(n);
      }
    }

    // Helper: timestamp local Bahia (UTC-3) no formato [dd/MM HH:mm]
    const fmtBahia = (iso: string) => {
      const d = new Date(new Date(iso).getTime() - 3 * 60 * 60 * 1000);
      const dd = String(d.getUTCDate()).padStart(2, "0");
      const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
      const hh = String(d.getUTCHours()).padStart(2, "0");
      const mi = String(d.getUTCMinutes()).padStart(2, "0");
      return `[${dd}/${mm} ${hh}:${mi}]`;
    };

    // Build chat history (inbound=user, outbound=assistant) em ordem cronológica
    // com timestamp prefixado e notas ancoradas injetadas logo após a mensagem.
    const history: Array<{ role: "user" | "assistant"; content: string }> = [];
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      const role = m.direction === "inbound" ? "user" : "assistant";
      let content = "";
      if (m.type === "audio") {
        if (m.transcription) content = `[áudio transcrito]: ${m.transcription}`;
        else content = "[áudio não transcrito — não assuma o conteúdo]";
      }
      else if (m.type === "image") content = m.content ? `[imagem] ${m.content}` : "[imagem]";
      else if (m.type === "video") content = m.content ? `[vídeo] ${m.content}` : "[vídeo]";
      else if (m.type === "document") content = m.content ? `[documento] ${m.content}` : "[documento]";
      else content = (m.content || "").trim();
      if (content) {
        history.push({ role, content: `${fmtBahia(m.created_at)} ${content}` });
      }
      // Marcador de mensagens omitidas (só quando há corte por custo)
      if (i === omittedAfterIndex && omittedCount > 0) {
        history.push({
          role: "user",
          content: `[... ${omittedCount} mensagens antigas omitidas por tamanho — foram preservadas apenas as primeiras 50 e as últimas 350 ...]`,
        });
      }
      // Nota interna ancorada logo após esta mensagem
      const anchored = notesByAnchor.get(m.id);
      if (anchored && anchored.length) {
        for (const n of anchored) {
          history.push({
            role: "user",
            content: `${fmtBahia(n.created_at)} [NOTA INTERNA DA EQUIPE — NÃO enviar ao cliente]: ${String(n.content || "").trim()}`,
          });
        }
      }
    }
    if (!history.length) {
      return new Response(JSON.stringify({ skipped: "no_text_history" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Carrega histórico de etapas (últimas 5) para explicar o "porquê" da etapa atual.
    let stageHistoryBlock = "";
    try {
      const { data: sh } = await supabase
        .from("crm_lead_stage_history")
        .select("entered_at, stage_id, from_stage_id")
        .eq("lead_id", leadId)
        .order("entered_at", { ascending: false })
        .limit(5);
      const rows = (sh || []).reverse();
      if (rows.length) {
        const stageIds = Array.from(new Set(rows.flatMap((r: any) => [r.stage_id, r.from_stage_id]).filter(Boolean)));
        const { data: stagesLookup } = await supabase
          .from("crm_stages")
          .select("id, name")
          .in("id", stageIds);
        const nameById = new Map((stagesLookup || []).map((s: any) => [s.id, s.name]));
        const lines = rows.map((r: any) => {
          const to = nameById.get(r.stage_id) || "?";
          const from = r.from_stage_id ? (nameById.get(r.from_stage_id) || "?") : "(início)";
          return `${fmtBahia(r.entered_at)} ${from} → ${to}`;
        });
        stageHistoryBlock = `\n\n=== HISTÓRICO DE ETAPAS (últimas ${lines.length}) ===\n${lines.join("\n")}`;
      }
    } catch (_) { /* opcional */ }

    // Bloco de anotações não ancoradas (observações fixadas pela equipe)
    let teamNotesBlock = "";
    if (unanchoredNotes.length) {
      const lines = unanchoredNotes
        .slice(-10)
        .map((n: any) => `${fmtBahia(n.created_at)} ${String(n.content || "").trim().slice(0, 500)}`);
      teamNotesBlock = `\n\n=== ANOTAÇÕES DA EQUIPE (leia com prioridade, NÃO enviar ao cliente) ===\n${lines.join("\n")}`;
    }

    // Observação do lead promovida
    const leadNotesBlock = (lead.notes && String(lead.notes).trim())
      ? `\n\n=== OBSERVAÇÃO DO LEAD (leia com prioridade) ===\n${String(lead.notes).trim().slice(0, 1500)}`
      : "";

    const kb = (config.knowledge_base && String(config.knowledge_base).trim()) || DEFAULT_KB;
    const persona = config.assistant_display_name || "Bia";
    const unitAddress = resolveUnitAddress(lead.cidade, kb);

    // === 7A: Carrega Diretrizes e Restrições ativas do tenant ===
    let diretrizesBlock = "";
    let restricoesBlock = "";
    try {
      const { data: rules } = await supabase
        .from("ai_assistant_rules")
        .select("kind, text")
        .eq("active", true)
        .eq("tenant_id", lead.tenant_id)
        .order("created_at", { ascending: true });
      const dirs = (rules || []).filter((r: any) => r.kind === "diretriz").map((r: any) => r.text);
      const rests = (rules || []).filter((r: any) => r.kind === "restricao").map((r: any) => r.text);
      if (dirs.length) {
        diretrizesBlock = `\n\n=== DIRETRIZES (siga sempre) ===\n${dirs.map((t: string, i: number) => `${i + 1}. ${t}`).join("\n")}`;
      }
      if (rests.length) {
        restricoesBlock = `\n\n=== RESTRIÇÕES (NUNCA faça — prioridade máxima, vencem qualquer outra regra) ===\n${rests.map((t: string, i: number) => `${i + 1}. ${t}`).join("\n")}`;
      }
    } catch (_) { /* sem regras */ }

    // === 7C: Aprendizado — usa correções recentes sempre, e RAG quando houver embeddings ===
    let examplesBlock = "";
    try {
      const learnedExamples = new Map<string, any>();
      const addLearned = (items: any[] | null | undefined) => {
        for (const item of items || []) {
          if (item?.id && !learnedExamples.has(item.id)) learnedExamples.set(item.id, item);
        }
      };

      const { data: recentCorrections } = await supabase
        .from("ai_good_examples")
        .select("id, context, ideal_reply, rejected_reply, source, created_at")
        .eq("tenant_id", lead.tenant_id)
        .not("rejected_reply", "is", null)
        .order("created_at", { ascending: false })
        .limit(6);
      addLearned(recentCorrections as any[]);

      const { data: recentApproved } = await supabase
        .from("ai_good_examples")
        .select("id, context, ideal_reply, rejected_reply, source, created_at")
        .eq("tenant_id", lead.tenant_id)
        .order("created_at", { ascending: false })
        .limit(4);
      addLearned(recentApproved as any[]);

      const lastInbound = history.filter((m) => m.role === "user").slice(-3).map((m) => m.content).join("\n");
      if (LOVABLE_API_KEY && lastInbound.trim()) {
        try {
          const er = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
            method: "POST",
            headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model: "openai/text-embedding-3-small", input: lastInbound }),
          });
          if (er.ok) {
            const ej = await er.json();
            const emb = ej?.data?.[0]?.embedding;
            if (Array.isArray(emb)) {
              const { data: matches } = await supabase.rpc("match_good_examples", {
                query_embedding: emb,
                match_count: 4,
                filter_tenant: lead.tenant_id,
                filter_cidade: lead.cidade || null,
                filter_servico: lead.servico_interesse || null,
              });
              addLearned(matches as any[]);
            }
          }
        } catch (_) { /* busca semântica opcional */ }
      }

      const examples = Array.from(learnedExamples.values()).slice(0, 8);
      if (examples.length) {
        examplesBlock = `\n\n=== CORREÇÕES E EXEMPLOS APRENDIDOS COM A EQUIPE (prioridade alta) ===
Use estes casos como guia. Quando houver "Resposta rejeitada", NÃO repita o mesmo padrão/abordagem; siga a "Resposta correta" adaptando ao lead atual. Não copie nomes, cidades, horários ou valores de outro caso.\n` +
          examples.map((m, i) => {
            const rejected = m.rejected_reply ? `\nResposta rejeitada pela equipe: ${m.rejected_reply}` : "";
            return `Exemplo ${i + 1}:\nContexto: ${String(m.context || "").slice(0, 1200)}${rejected}\nResposta correta: ${m.ideal_reply}`;
          }).join("\n\n");
        }
    } catch (_) { /* RAG opcional */ }

    // Hora local Bahia (UTC-3) para saudação correta
    const nowBahia = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const hourBA = nowBahia.getUTCHours();
    const minBA = nowBahia.getUTCMinutes();
    const nowMinutesBA = hourBA * 60 + minBA;
    let saudacao = "Boa noite";
    if (hourBA >= 5 && hourBA < 12) saudacao = "Bom dia";
    else if (hourBA >= 12 && hourBA < 18) saudacao = "Boa tarde";

    // Horário comercial configurado — decide se a Bia pode confirmar horário direto.
    const shiftStartStr = String((config as any).shift_start || "07:29");
    const shiftEndStr = String((config as any).shift_end || "18:00");
    const parseHMM = (s: string) => {
      const [h, m] = s.split(":").map((x) => parseInt(x, 10) || 0);
      return h * 60 + m;
    };
    const inShift = nowMinutesBA >= parseHMM(shiftStartStr) && nowMinutesBA <= parseHMM(shiftEndStr);


    // Primeiro nome do lead
    const firstName = (lead.name || "").trim().split(/\s+/)[0] || "";

    // Bloco de anúncio (espelhar tema quando vier de ad)
    const hasAd = !!((lead as any).titulo_anuncio || (lead as any).descricao_anuncio || (lead as any).nome_anuncio);
    const adBlock = hasAd
      ? `\n\n=== ANÚNCIO DE ORIGEM (espelhe o tema com empatia ANTES de perguntar) ===
Título: ${(lead as any).titulo_anuncio || "—"}
Descrição: ${(lead as any).descricao_anuncio || "—"}
Nome do anúncio: ${(lead as any).nome_anuncio || "—"}
Origem (source): ${lead.source || "—"}
Use isso para abrir com acolhimento que conecte com o problema/dor do anúncio (ex.: anúncio sobre "dente faltando / vergonha de sorrir" → "imagino o quanto incomoda, mas fica tranquila(o), a gente resolve"). NUNCA invente conteúdo que não esteja acima e NUNCA cite a palavra "anúncio"/"campanha" ao cliente.`
      : "";

    // Bloco de FATOS CONFIRMADOS — âncora obrigatória
    const factsBlock = `=== FATOS CONFIRMADOS (use EXATAMENTE, nunca invente nem troque) ===
Nome do cliente: ${lead.name || "[não informado — pergunte]"}
Primeiro nome (use na saudação): ${firstName || "[não informado]"}
Cidade/Unidade: ${lead.cidade || "[não informado — pergunte]"}
Telefone: ${lead.phone || "—"}
Serviço de interesse: ${lead.servico_interesse || "[não informado — pergunte]"}
Etapa atual: ${stageName || "—"}
Endereço da unidade: ${unitAddress || "[NÃO CADASTRADO — NÃO envie endereço; diga que confirma em seguida]"}
Hora atual (America/Bahia, UTC-3): ${String(hourBA).padStart(2, "0")}:${String(nowBahia.getUTCMinutes()).padStart(2, "0")}
Horário comercial da clínica: ${shiftStartStr}–${shiftEndStr} (America/Bahia). AGORA está ${inShift ? "DENTRO" : "FORA"} do expediente.
Saudação correta para AGORA: "${saudacao}" (use ESTA, nunca outra)${adBlock}${leadNotesBlock}${teamNotesBlock}${stageHistoryBlock}


Use SEMPRE o nome e a cidade exatos acima. É PROIBIDO usar outro nome de cliente ou outra cidade.
Lead ID interno (não mencione ao cliente): ${lead.id}`;

    const systemPrompt = `Você é a "${persona}", atendente HUMANA da Rizodent. Responda em PT-BR informal, caloroso, mensagens curtas (1-3 linhas), no máximo 1 emoji.

=== IDENTIDADE (regra absoluta) ===
Você é humana. NUNCA diga que é IA, bot, robô, assistente virtual ou automação — nem mesmo se perguntarem (desconverse: "sou a ${persona}, da equipe da Rizodent 😊"). NUNCA mencione limitações técnicas como "não consigo abrir links", "não consigo ouvir áudio", "não consigo ver vídeo/imagem", "não tenho acesso a", "não consigo acessar". Se chegar um link/vídeo/imagem/áudio que você não interpretou, peça com naturalidade: "Me conta com suas palavras o que você está buscando, que eu te ajudo 😊" — sem citar motivo técnico.

=== SAUDAÇÃO ===
Use SEMPRE o "Primeiro nome" dos FATOS CONFIRMADOS na abertura (ex.: "Oi, ${firstName || "[nome]"}!"). Use a "Saudação correta para AGORA" dos FATOS — NUNCA "Bom dia" à tarde/noite. Se não houver primeiro nome, use "Oi!" neutro. Só cumprimente uma vez por janela; se já cumprimentou recentemente, vá direto ao ponto.

=== ANTI-ALUCINAÇÃO (regra absoluta) ===
Você só pode afirmar o que está (a) nos FATOS CONFIRMADOS ou (b) explicitamente dito na conversa. NUNCA invente nome, cidade, endereço, ponto de referência, horário, data, valor, condição NEM ações do cliente. É PROIBIDO afirmar que o cliente "já conseguiu falar com a equipe", "já agendou", "já recebeu", "já viu", "já confirmou" sem isso estar explícito no histórico. Se não está claro, pergunte — não suponha.

=== RESPEITAR O COMBINADO E CONTINUIDADE TEMPORAL ===
Leia TODA a conversa antes de responder. Cada mensagem do histórico vem prefixada com "[dd/mm hh:mm]" no fuso America/Bahia — use isso para respeitar a ordem, não repetir assunto já resolvido e reengajar com naturalidade se a última interação foi há muito tempo. Respeite o que a equipe já combinou (horário, data, valor, condição, telefone passado, encaminhamento para recepção) — NÃO altere, NÃO ofereça agendamento novo se a equipe já direcionou. Se a etapa atual for de desfecho (Desqualificado, Ganho, Compareceu, Perdido, Não contratado, Cliente, Nutrição), NÃO reinicie fluxo de agendamento do zero — apenas dê continuidade ao que já foi combinado. Notas internas (linhas "[NOTA INTERNA DA EQUIPE — NÃO enviar ao cliente]") são direcionadores da equipe: siga-as, mas NUNCA repita seu conteúdo textual para o cliente. Use sempre o nome dos FATOS CONFIRMADOS.

=== ENDEREÇOS ===
Só envie endereço se estiver no campo "Endereço da unidade" dos FATOS. Se "NÃO CADASTRADO", diga que confirma e retorna — NUNCA invente rua, número, bairro ou ponto de referência.

=== ESPELHAR ANÚNCIO ===
Quando houver bloco "ANÚNCIO DE ORIGEM" nos FATOS, ABRA reconhecendo com empatia o tema/dor antes de perguntar. Linguagem humana, sem citar "anúncio"/"campanha".

${restricoesBlock}${diretrizesBlock}

=== BASE DE CONHECIMENTO ===
${kb}${examplesBlock}

=== RACIOCÍNIO ANTES DE RESPONDER (siga esta ordem mental) ===
1. LEIA A ÚLTIMA MENSAGEM DO LEAD PRIMEIRO. Se tem pergunta, dúvida, medo, objeção ou informação nova (ex.: "posso levar acompanhante?", "tenho medo", "moro em outra cidade"), RESPONDA ISSO antes de qualquer script ou agendamento. Nunca ignore o conteúdo livre da mensagem para seguir roteiro.
2. AGENDAMENTO — solicitação vs. confirmado:
   • Se o horário/data veio de formulário, anúncio ou preferência do próprio lead e NÃO há mensagem anterior da equipe confirmando (nem etapa "Agendado" no histórico de etapas), trate como SOLICITAÇÃO.
   • Se AGORA está DENTRO do horário comercial (ver FATOS), você PODE confirmar o horário pedido diretamente com naturalidade (ex.: "perfeito, ${firstName || "tudo bem"}, tô te confirmando pra [dia] às [hora]"), desde que o horário pedido também caia no expediente.
   • Se AGORA está FORA do horário comercial, ou o horário pedido está fora do expediente, NÃO confirme — diga que vai verificar a disponibilidade e retorna ("já verifico a agenda e te confirmo em seguida"). NUNCA escreva "já anotei seu agendamento" se não houve confirmação real.
   • Se há confirmação prévia explícita no histórico ou etapa "Agendado", apenas reforce o combinado, sem reabrir.
3. PRIMEIRO CONTATO VIA FORMULÁRIO/ANÚNCIO: saudação curta (1 linha, com primeiro nome) e vá direto ao ponto. NADA de parágrafos longos de boas-vindas.
4. ACOLHIMENTO EMOCIONAL: se o lead demonstra medo, insegurança, dor ou frustração, ACOLHA em 1 frase antes de qualquer dado operacional (horário, endereço, valor).
5. CONTINUIDADE: use os timestamps [dd/mm hh:mm] para NÃO repetir o que já foi dito e para reengajar com naturalidade se ficou tempo sem falar.
6. UMA PERGUNTA POR VEZ: se faltar informação, pergunte só a mais importante — nunca empilhe 2-3 perguntas na mesma mensagem.
7. ETAPA/DESFECHO: respeite a etapa atual dos FATOS. Se for Desqualificado/Ganho/Compareceu/Cliente/Nutrição, NÃO reinicie fluxo de agendamento — apenas dê continuidade.

=== TAREFA ===

Gere a PRÓXIMA mensagem a enviar AGORA ao paciente. Decida a ação:
- action="reply" → resposta direta.
- action="handoff" → dor forte/urgência, reclamação, pedido de humano, ou negociação de preço complexa.

Responda SOMENTE com JSON válido:
{"reply":"...","action":"reply"|"handoff","action_reason":"motivo curto"}`;

    // Injeta os FATOS como primeira mensagem do usuário, antes do histórico real.
    const anchoredHistory: Array<{ role: "user" | "assistant"; content: string }> = [
      { role: "user", content: factsBlock },
      { role: "assistant", content: "Entendido. Vou usar exatamente esses dados e não inventar nada fora deles." },
      ...history,
    ];

    const modelId: string = config.model || "google/gemini-3-flash-preview";
    let usedModel = modelId;

    async function callModel(extraInstruction?: string): Promise<string> {
      const sys = extraInstruction ? `${systemPrompt}\n\n${extraInstruction}` : systemPrompt;
      if (modelId.startsWith("anthropic/") && ANTHROPIC_API_KEY) {
        const anthropicModel = modelId.replace(/^anthropic\//, "");
        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          // Anthropic exige que a última mensagem seja do usuário (sem prefill).
          const anthMessages = anchoredHistory.map((m) => ({ role: m.role, content: m.content }));
          while (anthMessages.length > 1 && anthMessages[anthMessages.length - 1].role === "assistant") {
            anthMessages.pop();
          }
          if (anthMessages.length === 0 || anthMessages[anthMessages.length - 1].role !== "user") {
            anthMessages.push({ role: "user", content: "Com base em tudo acima, gere a próxima resposta no formato JSON solicitado." });
          }
          body: JSON.stringify({
            model: anthropicModel,
            max_tokens: 2048,
            system: sys,
            messages: anthMessages,
          }),
        });
        if (!r.ok) {
          const t = await r.text();
          throw new Error(`anthropic ${r.status}: ${t}`);
        }
        usedModel = modelId;
        const j = await r.json();
        return (j?.content || []).map((c: any) => c?.text || "").join("\n").trim();
      }
      if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY não configurado");
      const fallbackModel = modelId.startsWith("anthropic/") ? "google/gemini-2.5-flash" : modelId;
      usedModel = fallbackModel;
      const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: fallbackModel,
          max_tokens: 2048,
          messages: [{ role: "system", content: sys }, ...anchoredHistory],
        }),
      });
      if (r.status === 429) throw new Error("__RATE_LIMITED__");
      if (r.status === 402) throw new Error("__CREDITS_EXHAUSTED__");
      if (!r.ok) {
        const t = await r.text();
        throw new Error(`gateway ${r.status}: ${t}`);
      }
      const j = await r.json();
      return j?.choices?.[0]?.message?.content || "";
    }

    let aiText = "";
    let parsed = null as ReturnType<typeof parseJsonTolerant>;
    try {
      aiText = await callModel();
      parsed = parseJsonTolerant(aiText);
      // Retry uma vez se veio vazio ou sem JSON parseável
      if (!parsed || !parsed.reply.trim()) {
        const reinforcement = `IMPORTANTE: sua última resposta veio vazia ou fora do formato. Responda AGORA somente com um objeto JSON em uma única linha, sem markdown, sem cercas de código, sem texto antes ou depois. Exemplo exato de formato: {"reply":"texto da mensagem","action":"reply","action_reason":"curto"}`;
        aiText = await callModel(reinforcement);
        parsed = parseJsonTolerant(aiText);
      }
      // NÃO usar texto cru como fallback: corre risco de enviar JSON bruto ao cliente.
      // Se ainda não parseou, o handler abaixo retorna empty_response e a UI mostra erro.
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (msg === "__RATE_LIMITED__") return new Response(JSON.stringify({ error: "rate_limited" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (msg === "__CREDITS_EXHAUSTED__") return new Response(JSON.stringify({ error: "credits_exhausted" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: msg }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!parsed || !parsed.reply.trim()) {
      return new Response(JSON.stringify({ error: "empty_response", model: usedModel, raw: aiText }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
