// One-shot helper: aplica file_size_limit=10MB e allowed_mime_types=imagens
// nos buckets públicos `avatars` e `tenant-logos`. Não altera `chat-media`.
// Chamado uma vez pelo agente via curl; pode ser removido depois. Requer
// header x-admin-secret == SUPABASE_SERVICE_ROLE_KEY para evitar abuso.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const provided = req.headers.get("x-admin-secret") || "";
  if (provided !== SR) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const buckets = ["avatars", "tenant-logos"];
  const payload = {
    public: true,
    file_size_limit: 10485760,
    allowed_mime_types: ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"],
  };
  const results: Record<string, unknown> = {};
  for (const b of buckets) {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/bucket/${b}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${SR}`,
        apikey: SR,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const txt = await r.text();
    results[b] = { status: r.status, body: txt };
  }
  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
