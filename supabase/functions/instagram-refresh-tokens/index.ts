import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GRAPH = "https://graph.facebook.com/v25.0";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const META_APP_ID = Deno.env.get("META_APP_ID")!;
    const META_APP_SECRET = Deno.env.get("META_APP_SECRET")!;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const cutoff = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    const { data: accounts, error } = await supabase
      .from("instagram_accounts")
      .select("*")
      .eq("is_active", true)
      .lt("long_lived_token_expires_at", cutoff);

    if (error) throw error;

    console.log(`[refresh] Checking ${accounts?.length ?? 0} accounts near expiration`);

    let renewed = 0;
    const failures: any[] = [];

    for (const acc of accounts ?? []) {
      const refreshUrl = new URL(`${GRAPH}/oauth/access_token`);
      refreshUrl.searchParams.set("grant_type", "fb_exchange_token");
      refreshUrl.searchParams.set("client_id", META_APP_ID);
      refreshUrl.searchParams.set("client_secret", META_APP_SECRET);
      refreshUrl.searchParams.set("fb_exchange_token", acc.page_access_token);

      const resp = await fetch(refreshUrl.toString());
      const data = await resp.json();

      if (!resp.ok || !data.access_token) {
        console.error("[refresh] failed for", acc.id, JSON.stringify(data));
        failures.push({ id: acc.id, error: data });
        continue;
      }

      const newExpires = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
      const { error: updErr } = await supabase
        .from("instagram_accounts")
        .update({
          page_access_token: data.access_token,
          long_lived_token_expires_at: newExpires,
        })
        .eq("id", acc.id);

      if (updErr) {
        console.error("[refresh] update error", updErr);
        failures.push({ id: acc.id, error: updErr });
      } else {
        console.log("[refresh] renewed", acc.id, acc.name);
        renewed++;
      }
    }

    console.log(`[refresh] Done renewed=${renewed} failures=${failures.length}`);
    return new Response(
      JSON.stringify({ checked: accounts?.length ?? 0, renewed, failures }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[refresh] error", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
