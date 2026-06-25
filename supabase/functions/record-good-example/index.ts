import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { authorizeInternal } from "../_shared/internalAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

    const { lead_id, ideal_reply } = await req.json().catch(() => ({}));
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

    let embedding: number[] | null = null;
    if (LOVABLE_API_KEY) {
      try {
        const er = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
          method: "POST",
          headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "openai/text-embedding-3-small", input: context }),
        });
        if (er.ok) {
          const ej = await er.json();
          const emb = ej?.data?.[0]?.embedding;
          if (Array.isArray(emb)) embedding = emb;
        }
      } catch (_) { /* ignore */ }
    }

    const { error: insErr } = await supabase.from("ai_good_examples").insert({
      tenant_id: lead.tenant_id,
      lead_id: lead.id,
      context,
      ideal_reply: String(ideal_reply).trim(),
      cidade: lead.cidade || null,
      servico: lead.servico_interesse || null,
      embedding: embedding as any,
    });
    if (insErr) {
      return new Response(JSON.stringify({ error: insErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ ok: true, embedded: !!embedding }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("record-good-example error:", e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
