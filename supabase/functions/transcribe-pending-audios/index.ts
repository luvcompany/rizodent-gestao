// Cron worker: transcribes inbound audio messages whose transcription is still NULL.
// Runs every ~3 min. Safety net for failures in the fire-and-forget triggers
// from whatsapp-webhook and instagram-lite-webhook.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { authorizeInternal, unauthorizedResponse } from "../_shared/internalAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH = 20;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const auth = await authorizeInternal(req, supabase, { cronSecretName: "transcribe_cron_token" });
  if (!auth.ok) {
    console.warn("[transcribe-cron] Unauthorized");
    return unauthorizedResponse(corsHeaders);
  }

  const stats = { fetched: 0, ok: 0, failed: 0, rate_limited: 0 };
  try {
    const { data: pending, error } = await supabase
      .from("messages")
      .select("id")
      .eq("type", "audio")
      .eq("direction", "inbound")
      .is("transcription", null)
      .not("media_url", "is", null)
      .order("created_at", { ascending: false })
      .limit(BATCH);

    if (error) throw error;

    const items = pending || [];
    stats.fetched = items.length;
    console.log(`[transcribe-cron] fetched=${items.length}`);

    for (const item of items) {
      try {
        const resp = await fetch(`${supabaseUrl}/functions/v1/transcribe-audio`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceKey}`,
            apikey: serviceKey,
          },
          body: JSON.stringify({ message_id: item.id }),
        });
        if (resp.status === 429 || resp.status === 402) {
          stats.rate_limited++;
          console.warn(`[transcribe-cron] msg ${item.id}: ${resp.status} — will retry next run`);
          break; // stop early to honor the gateway limit
        }
        if (!resp.ok) {
          stats.failed++;
          const t = await resp.text();
          console.error(`[transcribe-cron] msg ${item.id} failed (${resp.status}): ${t.substring(0, 200)}`);
        } else {
          stats.ok++;
        }
      } catch (e: any) {
        stats.failed++;
        console.error(`[transcribe-cron] msg ${item.id} error:`, e?.message);
      }
    }

    console.log(`[transcribe-cron] done`, stats);
    return new Response(JSON.stringify({ success: true, ...stats }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[transcribe-cron] fatal:", e?.message);
    return new Response(JSON.stringify({ error: e?.message, ...stats }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
