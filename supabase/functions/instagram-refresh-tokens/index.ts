import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const META_APP_ID = Deno.env.get("META_APP_ID") ?? "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";

const supabase = createClient(supabaseUrl, serviceRoleKey);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  const auth = req.headers.get("authorization") || "";
  const expected = `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`;
  if (auth !== expected) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });


  if (!META_APP_ID || !META_APP_SECRET) {
    return new Response(JSON.stringify({ error: "Missing META secrets" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const cutoff = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();

  const { data: rows, error: selErr } = await supabase
    .from("instagram_accounts")
    .select("id, page_access_token, long_lived_token_expires_at")
    .eq("is_active", true)
    .lt("long_lived_token_expires_at", cutoff);

  if (selErr) {
    console.error("[instagram-refresh-tokens] select error:", selErr);
    return new Response(JSON.stringify({ error: "DB error", details: selErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let refreshed = 0;
  let failed = 0;

  for (const row of rows ?? []) {
    if (!row.page_access_token) continue;
    try {
      const url = new URL("https://graph.facebook.com/v25.0/oauth/access_token");
      url.searchParams.set("grant_type", "fb_exchange_token");
      url.searchParams.set("client_id", META_APP_ID);
      url.searchParams.set("client_secret", META_APP_SECRET);
      url.searchParams.set("fb_exchange_token", row.page_access_token);

      const res = await fetch(url.toString());
      const json = await res.json();
      if (!res.ok || !json?.access_token) {
        console.error(`[instagram-refresh-tokens] refresh failed for ${row.id}:`, json);
        failed += 1;
        continue;
      }

      const newExpires = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
      const { error: upErr } = await supabase
        .from("instagram_accounts")
        .update({
          page_access_token: json.access_token,
          long_lived_token_expires_at: newExpires,
        })
        .eq("id", row.id);
      if (upErr) {
        console.error(`[instagram-refresh-tokens] update failed for ${row.id}:`, upErr);
        failed += 1;
      } else {
        refreshed += 1;
      }
    } catch (err) {
      console.error(`[instagram-refresh-tokens] exception for ${row.id}:`, err);
      failed += 1;
    }
  }

  console.log(`[instagram-refresh-tokens] done. refreshed=${refreshed} failed=${failed} candidates=${rows?.length ?? 0}`);
  return new Response(
    JSON.stringify({ refreshed, failed, candidates: rows?.length ?? 0 }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
