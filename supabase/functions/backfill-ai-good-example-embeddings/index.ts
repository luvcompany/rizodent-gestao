import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { authorizeInternal } from "../_shared/internalAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EMBEDDING_MODEL = "openai/text-embedding-3-small";

async function embed(apiKey: string, input: string): Promise<{ embedding: number[] | null; error: string | null }> {
  if (!apiKey) return { embedding: null, error: "missing_lovable_api_key" };
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input }),
    });
    const raw = await res.text();
    if (!res.ok) return { embedding: null, error: `${res.status}: ${raw.slice(0, 500)}` };
    const json = JSON.parse(raw);
    const embedding = json?.data?.[0]?.embedding;
    return Array.isArray(embedding) ? { embedding, error: null } : { embedding: null, error: "empty_embedding" };
  } catch (e: any) {
    return { embedding: null, error: e?.message || String(e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") || "";
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const auth = await authorizeInternal(req, supabase, { allowUserJwt: true });
    if (!auth.ok) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 200);

    const { data: rows, error: fetchError } = await supabase
      .from("ai_good_examples")
      .select("id, context")
      .is("embedding", null)
      .order("created_at", { ascending: true })
      .limit(limit);

    if (fetchError) {
      return new Response(JSON.stringify({ error: fetchError.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const processed: any[] = [];
    for (const row of rows || []) {
      const context = String((row as any).context || "").trim();
      if (!context) {
        await supabase.from("ai_good_examples").update({ embedding_error: "empty_context" }).eq("id", (row as any).id);
        processed.push({ id: (row as any).id, embedded: false, error: "empty_context" });
        continue;
      }

      const result = await embed(LOVABLE_API_KEY, context);
      await supabase
        .from("ai_good_examples")
        .update({
          embedding: result.embedding as any,
          embedding_model: result.embedding ? EMBEDDING_MODEL : null,
          embedding_error: result.error,
          embedded_at: result.embedding ? new Date().toISOString() : null,
        })
        .eq("id", (row as any).id);
      processed.push({ id: (row as any).id, embedded: !!result.embedding, error: result.error });
    }

    return new Response(JSON.stringify({ ok: true, count: processed.length, processed }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("backfill-ai-good-example-embeddings error:", e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});