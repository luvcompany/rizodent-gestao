import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

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

    // Get pending recipients with lead phone
    const { data: recipients } = await supabase
      .from("crm_broadcast_recipients")
      .select("id, lead_id, crm_leads(phone, name)")
      .eq("broadcast_id", broadcast_id)
      .eq("status", "pending")
      .limit(500);

    let sentCount = 0;
    for (const r of recipients || []) {
      const lead = (r as any).crm_leads;
      if (!lead?.phone) {
        await supabase.from("crm_broadcast_recipients").update({ status: "failed", error: "no phone" }).eq("id", r.id);
        continue;
      }

      try {
        // Call send-whatsapp-message
        const resp = await fetch(`${supabaseUrl}/functions/v1/send-whatsapp-message`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({
            lead_id: r.lead_id,
            template_name: template.name,
            language: template.language || "pt_BR",
          }),
        });

        if (resp.ok) {
          await supabase.from("crm_broadcast_recipients").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", r.id);
          sentCount++;
        } else {
          const err = await resp.text();
          await supabase.from("crm_broadcast_recipients").update({ status: "failed", error: err.slice(0, 200) }).eq("id", r.id);
        }
      } catch (e: any) {
        await supabase.from("crm_broadcast_recipients").update({ status: "failed", error: e.message?.slice(0, 200) }).eq("id", r.id);
      }

      // Throttle ~50ms between sends
      await new Promise(res => setTimeout(res, 50));
    }

    // Update broadcast
    await supabase.from("crm_broadcasts").update({
      sent_count: sentCount,
      status: sentCount > 0 ? "completed" : "failed",
    }).eq("id", broadcast_id);

    return new Response(JSON.stringify({ sent: sentCount }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
});
