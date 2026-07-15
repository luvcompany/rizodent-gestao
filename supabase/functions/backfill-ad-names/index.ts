// Backfill ad_id_mapping.ad_name calling Graph API using the same tokens the
// whatsapp-webhook uses (integrations rows where key LIKE 'whatsapp_%' +
// env WHATSAPP_TOKEN as last resort). Tolerant to per-ad failures.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const tenantId = url.searchParams.get("tenant_id");
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "500", 10), 2000);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Coleta tokens: mesma fonte do whatsapp-webhook enrichment
    const tokens: string[] = [];
    try {
      const { data: integs } = await supabase
        .from("integrations")
        .select("config")
        .like("key", "whatsapp_%");
      for (const i of integs || []) {
        const t = (i.config as any)?.access_token;
        if (t && !tokens.includes(t)) tokens.push(t);
      }
    } catch (_) { /* skip */ }
    const envTok = Deno.env.get("WHATSAPP_TOKEN") || "";
    if (envTok && !tokens.includes(envTok)) tokens.push(envTok);
    if (tokens.length === 0) {
      return new Response(JSON.stringify({ error: "no meta tokens available" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Descobre quais ad_ids precisam. ad_id_mapping é global (sem tenant_id),
    // então filtramos por tenant via crm_leads quando tenant_id informado.
    let adIds: string[] = [];
    if (tenantId) {
      const { data: leads } = await supabase
        .from("crm_leads")
        .select("ad_id")
        .eq("tenant_id", tenantId)
        .not("ad_id", "is", null)
        .limit(5000);
      const set = new Set<string>();
      for (const l of leads || []) if ((l as any).ad_id) set.add((l as any).ad_id);
      if (set.size === 0) {
        return new Response(JSON.stringify({ message: "no ad_ids for tenant", tenant_id: tenantId, filled: 0, failed: 0 }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: rows } = await supabase
        .from("ad_id_mapping")
        .select("ad_id")
        .is("ad_name", null)
        .in("ad_id", Array.from(set))
        .limit(limit);
      adIds = (rows || []).map((r: any) => r.ad_id);
    } else {
      const { data: rows } = await supabase
        .from("ad_id_mapping")
        .select("ad_id")
        .is("ad_name", null)
        .limit(limit);
      adIds = (rows || []).map((r: any) => r.ad_id);
    }

    console.log(`[BACKFILL-AD-NAME] tenant=${tenantId || "ALL"} candidates=${adIds.length} tokens=${tokens.length}`);

    let filled = 0;
    let failed = 0;
    const failedIds: string[] = [];

    for (const adId of adIds) {
      let name: string | null = null;
      for (const token of tokens) {
        try {
          const res = await fetch(
            `https://graph.facebook.com/v21.0/${adId}?fields=name&access_token=${token}`,
          );
          if (!res.ok) {
            await res.text().catch(() => {});
            continue;
          }
          const j = await res.json();
          if (j?.name) { name = String(j.name); break; }
        } catch (_) { /* try next token */ }
      }
      if (name) {
        try {
          const { error } = await supabase
            .from("ad_id_mapping")
            .update({ ad_name: name, updated_at: new Date().toISOString() })
            .eq("ad_id", adId);
          if (error) { failed++; failedIds.push(adId); }
          else filled++;
        } catch (_) { failed++; failedIds.push(adId); }
      } else {
        failed++;
        failedIds.push(adId);
      }
      // rate limit leve
      await new Promise((r) => setTimeout(r, 120));
    }

    const result = {
      tenant_id: tenantId,
      candidates: adIds.length,
      filled,
      failed,
      failed_sample: failedIds.slice(0, 20),
    };
    console.log(`[BACKFILL-AD-NAME] done`, JSON.stringify(result));
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[BACKFILL-AD-NAME] fatal:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
