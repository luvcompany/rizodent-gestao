import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Restrict to cron / service-role callers only
  const auth = req.headers.get("authorization") || "";
  const expected = `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`;
  if (auth !== expected) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });


  try {
    const { broadcast_id } = await req.json();
    if (!broadcast_id) return new Response(JSON.stringify({ error: "broadcast_id required" }), { status: 400, headers: corsHeaders });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Get broadcast + template
    const { data: bc } = await supabase.from("crm_broadcasts").select("*, crm_whatsapp_templates(*)").eq("id", broadcast_id).single();
    if (!bc) return new Response(JSON.stringify({ error: "Broadcast not found" }), { status: 404, headers: corsHeaders });

    const template = (bc as any).crm_whatsapp_templates;
    if (!template) return new Response(JSON.stringify({ error: "Template not found" }), { status: 404, headers: corsHeaders });

    // Process pending recipients in pages until none remain (or safety cap reached)
    let sentCount = 0;
    let failedCount = 0;
    const PAGE = 200;
    const MAX_TOTAL = 5000; // safety cap per invocation
    let processed = 0;

    while (processed < MAX_TOTAL) {
      const { data: recipients, error: fetchErr } = await supabase
        .from("crm_broadcast_recipients")
        .select("id, lead_id, crm_leads(phone, name)")
        .eq("broadcast_id", broadcast_id)
        .eq("status", "pending")
        .limit(PAGE);

      if (fetchErr) break;
      if (!recipients || recipients.length === 0) break;

      for (const r of recipients) {
        const lead = (r as any).crm_leads;
        if (!lead?.phone) {
          await supabase.from("crm_broadcast_recipients").update({ status: "failed", error: "no phone" }).eq("id", r.id);
          failedCount++;
          processed++;
          continue;
        }

        try {
          const resp = await fetch(`${supabaseUrl}/functions/v1/send-whatsapp-message`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
            body: JSON.stringify({
              lead_id: r.lead_id,
              template_name: template.name,
              language: template.language || "pt_BR",
            }),
          });

          if (resp.status === 429) {
            // Rate-limited: back off and retry next pass
            await new Promise(res => setTimeout(res, 2000));
            continue;
          }
          if (resp.ok) {
            await supabase.from("crm_broadcast_recipients").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", r.id);
            sentCount++;
          } else {
            const err = await resp.text();
            await supabase.from("crm_broadcast_recipients").update({ status: "failed", error: err.slice(0, 200) }).eq("id", r.id);
            failedCount++;
          }
        } catch (e: any) {
          await supabase.from("crm_broadcast_recipients").update({ status: "failed", error: e.message?.slice(0, 200) }).eq("id", r.id);
          failedCount++;
        }
        processed++;
        // Throttle ~80ms (~12 msg/s, well below WA limit)
        await new Promise(res => setTimeout(res, 80));
      }
    }

    // Decide final status: only "completed" when nothing remains pending.
    const { count: stillPending } = await supabase
      .from("crm_broadcast_recipients")
      .select("id", { count: "exact", head: true })
      .eq("broadcast_id", broadcast_id)
      .eq("status", "pending");

    const finalStatus = (stillPending && stillPending > 0)
      ? "running"
      : (sentCount > 0 ? "completed" : "failed");

    await supabase.from("crm_broadcasts").update({
      sent_count: sentCount,
      status: finalStatus,
    }).eq("id", broadcast_id);

    return new Response(JSON.stringify({ sent: sentCount, failed: failedCount, pending: stillPending ?? 0, status: finalStatus }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
});
