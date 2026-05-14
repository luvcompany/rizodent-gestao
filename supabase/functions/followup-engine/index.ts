import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  const authHeader = req.headers.get("authorization") || "";
  const apiKeyHeader = req.headers.get("apikey") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const pub = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
  const allowed = [service, anon, pub].filter(Boolean);
  if (!allowed.includes(token) && !allowed.includes(apiKeyHeader)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  }


  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const now = new Date().toISOString();
  let processed = 0;

  try {
    // Get all active queue items that are due
    const { data: queue } = await supabase
      .from("crm_followup_queue")
      .select("*, crm_followup_configs(*)")
      .in("status", ["waiting_disparo1", "waiting_disparo2", "waiting"])
      .or(`disparo1_scheduled_at.lte.${now},disparo2_scheduled_at.lte.${now},next_scheduled_at.lte.${now}`);

    for (const item of queue || []) {
      const config = item.crm_followup_configs;
      if (!config) continue;

      // Parse disparos array (new format) or fall back to legacy columns
      const disparos = getDisparos(config);
      const currentIndex = item.current_disparo_index || 0;

      // Check if lead responded
      const sinceTime = item.disparo1_sent_at || item.created_at;
      const responded = await checkLeadResponded(supabase, item.lead_id, sinceTime);
      if (responded) {
        await markResponded(supabase, item, config);
        processed++;
        continue;
      }

      // Check lead status
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

      // Send current disparo
      if (currentIndex < disparos.length) {
        const disparo = disparos[currentIndex];
        await sendDisparoMessage(supabase, item.lead_id, lead.phone, disparo);

        const nextIndex = currentIndex + 1;
        if (nextIndex < disparos.length) {
          // Schedule next disparo
          const nextDelay = disparos[nextIndex].delay_minutes || 10;
          const nextTime = new Date(Date.now() + nextDelay * 60000).toISOString();
          await supabase.from("crm_followup_queue").update({
            current_disparo_index: nextIndex,
            next_scheduled_at: nextTime,
            status: "waiting",
            updated_at: now,
          }).eq("id", item.id);
        } else {
          // All disparos sent, check if we should restart the cycle
          const newAttempt = (item.attempt_count || 0) + 1;
          if (newAttempt >= config.max_attempts) {
            await supabase.from("crm_followup_queue").update({
              status: "completed",
              attempt_count: newAttempt,
              updated_at: now,
            }).eq("id", item.id);
          } else {
            // Restart cycle from disparo 0
            const restartDelay = disparos[0]?.delay_minutes || 10;
            const restartTime = new Date(Date.now() + restartDelay * 60000).toISOString();
            await supabase.from("crm_followup_queue").update({
              current_disparo_index: 0,
              next_scheduled_at: restartTime,
              status: "waiting",
              attempt_count: newAttempt,
              updated_at: now,
            }).eq("id", item.id);
          }
        }

        // Move to follow-up stage if configured (only on first disparo of first attempt)
        if (currentIndex === 0 && (item.attempt_count || 0) === 0 && config.move_to_stage_id) {
          await supabase.from("crm_leads").update({
            stage_id: config.move_to_stage_id,
            updated_at: now,
          }).eq("id", item.lead_id);
        }

        processed++;
      }
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

interface DisparoConfig {
  delay_minutes: number;
  content: string;
  audio_url: string | null;
  file_url: string | null;
  file_name: string | null;
  template_id: string | null;
}

function getDisparos(config: any): DisparoConfig[] {
  // New format: disparos JSONB array
  if (config.disparos && Array.isArray(config.disparos) && config.disparos.length > 0) {
    return config.disparos;
  }
  // Legacy format: disparo1/disparo2 columns
  const legacy: DisparoConfig[] = [];
  if (config.disparo1_type) {
    legacy.push({
      delay_minutes: config.disparo1_delay_minutes || 10,
      content: config.disparo1_content || "",
      audio_url: config.disparo1_type === "audio" ? config.disparo1_content : null,
      file_url: config.disparo1_type === "file" ? config.disparo1_content : null,
      file_name: null,
      template_id: config.disparo1_template_id,
    });
  }
  if (config.disparo2_type) {
    legacy.push({
      delay_minutes: config.disparo2_delay_minutes || 120,
      content: config.disparo2_content || "",
      audio_url: config.disparo2_type === "audio" ? config.disparo2_content : null,
      file_url: config.disparo2_type === "file" ? config.disparo2_content : null,
      file_name: null,
      template_id: config.disparo2_template_id,
    });
  }
  return legacy.length > 0 ? legacy : [{ delay_minutes: 10, content: "Olá! Podemos ajudar?", audio_url: null, file_url: null, file_name: null, template_id: null }];
}

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

  if (config.return_to_stage_id) {
    await supabase.from("crm_leads").update({
      stage_id: config.return_to_stage_id,
      updated_at: now,
    }).eq("id", item.lead_id);
  }
}

async function sendDisparoMessage(supabase: any, leadId: string, phone: string | null, disparo: DisparoConfig) {
  if (!phone) {
    console.log(`[followup-engine] Lead ${leadId} has no phone, skipping`);
    return;
  }

  const payload: any = { lead_id: leadId, to: phone };

  // Priority: template > audio > file > text
  if (disparo.template_id) {
    const { data: tpl } = await supabase
      .from("crm_whatsapp_templates")
      .select("name, language")
      .eq("id", disparo.template_id)
      .single();

    if (tpl) {
      payload.type = "template";
      payload.template_name = tpl.name;
      payload.template_language = tpl.language || "pt_BR";
    } else {
      payload.type = "text";
      payload.message = disparo.content || "Olá! Podemos ajudar?";
    }
  } else if (disparo.audio_url) {
    payload.type = "audio";
    payload.media_url = disparo.audio_url;
    payload.audio_voice = true;
    if (disparo.content) payload.message = disparo.content;
  } else if (disparo.file_url) {
    payload.type = "document";
    payload.media_url = disparo.file_url;
    payload.message = disparo.content || "";
  } else {
    payload.type = "text";
    payload.message = disparo.content || "Olá! Podemos ajudar?";
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
    console.log(`[followup-engine] Sent to lead ${leadId}: ${res.status}`, JSON.stringify(data));
  } catch (err: any) {
    console.error(`[followup-engine] Failed to send to lead ${leadId}:`, err.message);
  }
}
