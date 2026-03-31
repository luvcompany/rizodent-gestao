import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const now = new Date().toISOString();
  let processed = 0;

  try {
    // ── STEP 1: Process waiting_disparo1 ──
    const { data: d1Queue } = await supabase
      .from("crm_followup_queue")
      .select("*, crm_followup_configs(*)")
      .eq("status", "waiting_disparo1")
      .lte("disparo1_scheduled_at", now);

    for (const item of d1Queue || []) {
      const config = item.crm_followup_configs;
      if (!config) continue;

      // Check if lead responded
      const responded = await checkLeadResponded(supabase, item.lead_id, item.created_at);
      if (responded) {
        await markResponded(supabase, item, config);
        processed++;
        continue;
      }

      // Check if lead moved to a stop stage
      const { data: lead } = await supabase
        .from("crm_leads")
        .select("stage_id, phone, automation_paused")
        .eq("id", item.lead_id)
        .single();

      if (!lead || lead.automation_paused) {
        await supabase.from("crm_followup_queue").update({ status: "paused", updated_at: now }).eq("id", item.id);
        continue;
      }

      if (config.stop_on_stages?.includes(lead.stage_id)) {
        await supabase.from("crm_followup_queue").update({ status: "paused", updated_at: now }).eq("id", item.id);
        continue;
      }

      // Send disparo1
      await sendFollowUpMessage(supabase, item.lead_id, lead.phone, config.disparo1_type, config.disparo1_content, config.disparo1_template_id);

      // Schedule disparo2
      const d2Time = new Date(Date.now() + config.disparo2_delay_minutes * 60000).toISOString();
      await supabase.from("crm_followup_queue").update({
        status: "waiting_disparo2",
        disparo1_sent_at: now,
        disparo2_scheduled_at: d2Time,
        updated_at: now,
      }).eq("id", item.id);

      // Move to follow-up stage if configured
      if (config.move_to_stage_id) {
        await supabase.from("crm_leads").update({
          stage_id: config.move_to_stage_id,
          updated_at: now,
        }).eq("id", item.lead_id);
      }

      processed++;
    }

    // ── STEP 2: Process waiting_disparo2 ──
    const { data: d2Queue } = await supabase
      .from("crm_followup_queue")
      .select("*, crm_followup_configs(*)")
      .eq("status", "waiting_disparo2")
      .lte("disparo2_scheduled_at", now);

    for (const item of d2Queue || []) {
      const config = item.crm_followup_configs;
      if (!config) continue;

      // Check if lead responded
      const responded = await checkLeadResponded(supabase, item.lead_id, item.disparo1_sent_at || item.created_at);
      if (responded) {
        await markResponded(supabase, item, config);
        processed++;
        continue;
      }

      const { data: lead } = await supabase
        .from("crm_leads")
        .select("stage_id, phone, automation_paused")
        .eq("id", item.lead_id)
        .single();

      if (!lead || lead.automation_paused) {
        await supabase.from("crm_followup_queue").update({ status: "paused", updated_at: now }).eq("id", item.id);
        continue;
      }

      if (config.stop_on_stages?.includes(lead.stage_id)) {
        await supabase.from("crm_followup_queue").update({ status: "paused", updated_at: now }).eq("id", item.id);
        continue;
      }

      // Check max attempts
      const newAttemptCount = (item.attempt_count || 0) + 1;
      if (newAttemptCount >= config.max_attempts) {
        await supabase.from("crm_followup_queue").update({
          status: "completed",
          attempt_count: newAttemptCount,
          updated_at: now,
        }).eq("id", item.id);
        continue;
      }

      // Send disparo2
      await sendFollowUpMessage(supabase, item.lead_id, lead.phone, config.disparo2_type, config.disparo2_content, config.disparo2_template_id);

      // Restart cycle: back to waiting_disparo1
      const d1Time = new Date(Date.now() + config.disparo1_delay_minutes * 60000).toISOString();
      await supabase.from("crm_followup_queue").update({
        status: "waiting_disparo1",
        disparo2_sent_at: now,
        disparo1_scheduled_at: d1Time,
        attempt_count: newAttemptCount,
        updated_at: now,
      }).eq("id", item.id);

      processed++;
    }

    console.log(`[followup-engine] Processed ${processed} items`);
    return new Response(JSON.stringify({ success: true, processed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[followup-engine] Error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function checkLeadResponded(supabase: any, leadId: string, since: string): Promise<boolean> {
  const { data: lastMsg } = await supabase
    .from("messages")
    .select("direction, created_at")
    .eq("lead_id", leadId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return lastMsg?.direction === "inbound";
}

async function markResponded(supabase: any, item: any, config: any) {
  const now = new Date().toISOString();
  await supabase.from("crm_followup_queue").update({
    status: "responded",
    updated_at: now,
  }).eq("id", item.id);

  // Move lead back to return stage
  if (config.return_to_stage_id) {
    await supabase.from("crm_leads").update({
      stage_id: config.return_to_stage_id,
      updated_at: now,
    }).eq("id", item.lead_id);
  }
}

async function sendFollowUpMessage(
  supabase: any,
  leadId: string,
  phone: string | null,
  type: string,
  content: string | null,
  templateId: string | null
) {
  if (!phone) {
    console.log(`[followup-engine] Lead ${leadId} has no phone, skipping send`);
    return;
  }

  const payload: any = {
    lead_id: leadId,
    to: phone,
  };

  if (type === "template" && templateId) {
    const { data: tpl } = await supabase
      .from("crm_whatsapp_templates")
      .select("name, language")
      .eq("id", templateId)
      .single();

    if (tpl) {
      payload.type = "template";
      payload.template_name = tpl.name;
      payload.template_language = tpl.language || "pt_BR";
    } else {
      // Fallback to text
      payload.type = "text";
      payload.message = content || "Olá! Podemos ajudar?";
    }
  } else if (type === "audio" && content) {
    payload.type = "audio";
    payload.media_url = content;
    payload.audio_voice = true;
  } else if (type === "file" && content) {
    payload.type = "document";
    payload.media_url = content;
    payload.message = "";
  } else {
    payload.type = "text";
    payload.message = content || "Olá! Podemos ajudar?";
  }

  try {
    const sendUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-whatsapp-message`;
    const res = await fetch(sendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    console.log(`[followup-engine] Sent ${type} to lead ${leadId}: ${res.status}`, JSON.stringify(data));
  } catch (err: any) {
    console.error(`[followup-engine] Failed to send to lead ${leadId}:`, err.message);
  }
}
