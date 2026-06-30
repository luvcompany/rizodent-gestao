import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { authorizeInternal } from "../_shared/internalAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EMBEDDING_MODEL = "openai/text-embedding-3-small";

async function createEmbedding(apiKey: string, input: string): Promise<{ embedding: number[] | null; error: string | null }> {
  if (!apiKey) return { embedding: null, error: "missing_lovable_api_key" };
  try {
    const er = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input }),
    });
    const raw = await er.text();
    if (!er.ok) return { embedding: null, error: `${er.status}: ${raw.slice(0, 500)}` };
    const ej = JSON.parse(raw);
    const emb = ej?.data?.[0]?.embedding;
    return Array.isArray(emb) ? { embedding: emb, error: null } : { embedding: null, error: "empty_embedding" };
  } catch (e: any) {
    return { embedding: null, error: e?.message || String(e) };
  }
}

function normalizeText(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") || "";
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const auth = await authorizeInternal(req, supabase, { allowUserJwt: true });
    if (!auth.ok) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const {
      lead_id,
      ideal_reply,
      rejected_reply,
      source_suggestion_id,
      learn_from_pending = false,
      source = "approved_reply",
    } = await req.json().catch(() => ({}));
    if (!lead_id || !ideal_reply || !String(ideal_reply).trim()) {
      return new Response(JSON.stringify({ error: "lead_id e ideal_reply são obrigatórios" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: lead } = await supabase
      .from("crm_leads")
      .select("id, tenant_id, cidade, servico_interesse")
      .eq("id", lead_id)
      .maybeSingle();
    if (!lead) {
      return new Response(JSON.stringify({ error: "Lead não encontrado" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let pendingSuggestion: any = null;
    if (source_suggestion_id) {
      const { data } = await supabase
        .from("ai_reply_suggestions")
        .select("id, suggested_text, status")
        .eq("id", source_suggestion_id)
        .eq("lead_id", lead_id)
        .maybeSingle();
      pendingSuggestion = data || null;
    } else if (learn_from_pending) {
      const { data } = await supabase
        .from("ai_reply_suggestions")
        .select("id, suggested_text, status")
        .eq("lead_id", lead_id)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      pendingSuggestion = data || null;
    }

    const cleanIdeal = normalizeText(ideal_reply);
    const cleanRejected = normalizeText(rejected_reply || pendingSuggestion?.suggested_text || "");
    const hasCorrection = !!cleanRejected && cleanRejected !== cleanIdeal;

    if (learn_from_pending && !pendingSuggestion) {
      return new Response(JSON.stringify({ skipped: "no_pending_suggestion" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (learn_from_pending && pendingSuggestion && !hasCorrection) {
      return new Response(JSON.stringify({ skipped: "same_as_suggestion" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // contexto = últimas 3 mensagens inbound (texto/transcrição)
    const { data: msgsDesc } = await supabase
      .from("messages")
      .select("direction, type, content, transcription, created_at")
      .eq("lead_id", lead_id)
      .eq("direction", "inbound")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(3);
    const ctxParts = (msgsDesc || []).reverse().map((m: any) => {
      if (m.type === "audio") return m.transcription ? `[áudio]: ${m.transcription}` : "[áudio]";
      return (m.content || "").trim();
    }).filter(Boolean);
    const context = ctxParts.join("\n").slice(0, 4000);
    if (!context) {
      return new Response(JSON.stringify({ skipped: "no_context" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const embeddingResult = await createEmbedding(LOVABLE_API_KEY, context);

    if (pendingSuggestion?.id) {
      await supabase
        .from("ai_reply_suggestions")
        .update({
          status: learn_from_pending ? "discarded" : pendingSuggestion.status,
          decided_at: new Date().toISOString(),
          decided_by: auth.user?.id || null,
          final_text: cleanIdeal,
          was_edited: hasCorrection,
        })
        .eq("id", pendingSuggestion.id);
    }

    const { error: insErr } = await supabase.from("ai_good_examples").insert({
      tenant_id: lead.tenant_id,
      lead_id: lead.id,
      context,
      ideal_reply: cleanIdeal,
      rejected_reply: hasCorrection ? cleanRejected : null,
      source: hasCorrection ? "human_correction" : String(source || "approved_reply"),
      source_suggestion_id: pendingSuggestion?.id || source_suggestion_id || null,
      cidade: lead.cidade || null,
      servico: lead.servico_interesse || null,
      embedding: embeddingResult.embedding as any,
      embedding_model: embeddingResult.embedding ? EMBEDDING_MODEL : null,
      embedding_error: embeddingResult.error,
      embedded_at: embeddingResult.embedding ? new Date().toISOString() : null,
    });
    if (insErr) {
      return new Response(JSON.stringify({ error: insErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ ok: true, embedded: !!embeddingResult.embedding, corrected: hasCorrection, embedding_error: embeddingResult.error }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("record-good-example error:", e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
