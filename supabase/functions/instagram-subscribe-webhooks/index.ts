import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GRAPH = "https://graph.facebook.com/v25.0";
const SUB_FIELDS = "messages,messaging_postbacks,message_reactions,messaging_seen,comments,mention";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: accounts, error } = await supabase
      .from("instagram_accounts")
      .select("id, name, page_id, page_access_token, instagram_account_id")
      .eq("is_active", true);

    if (error) throw error;

    const results: any[] = [];
    for (const acc of accounts ?? []) {
      if (!acc.page_id || !acc.page_access_token) {
        results.push({ name: acc.name, skipped: true, reason: "missing page_id or token" });
        continue;
      }
      try {
        const subResp = await fetch(`${GRAPH}/${acc.page_id}/subscribed_apps`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            subscribed_fields: SUB_FIELDS,
            access_token: acc.page_access_token,
          }),
        });
        const subData = await subResp.json();
        results.push({ name: acc.name, page_id: acc.page_id, ok: subResp.ok, response: subData });
        console.log(`[ig-subscribe] page=${acc.page_id} name=${acc.name} ok=${subResp.ok}`, subData);
      } catch (e) {
        results.push({ name: acc.name, page_id: acc.page_id, ok: false, error: String(e) });
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    console.error("[ig-subscribe] error", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
