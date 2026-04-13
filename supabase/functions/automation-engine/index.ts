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

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const results: Record<string, number> = {
    progressive_reengagement: 0,
    lead_stale: 0,
    no_show: 0,
    time_window: 0,
    bot_timeout: 0,
    before_scheduled: 0,
  };

  try {
    // =========================================================
    // 0. BOT TIMEOUT — check waiting_reply executions with expired timeout_at
    // =========================================================
    const { data: expiredExecutions } = await supabase
      .from("bot_executions")
      .select("id, lead_id")
      .eq("status", "waiting_reply")
      .not("timeout_at", "is", null)
      .lte("timeout_at", new Date().toISOString())
      .limit(50);

    for (const exec of expiredExecutions || []) {
      try {
        console.log(`[AUTOMATION-ENGINE] Bot timeout fired for execution ${exec.id}, lead ${exec.lead_id}`);
        const resp = await fetch(`${supabaseUrl}/functions/v1/bot-engine`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceKey}`,
            apikey: serviceKey,
          },
          body: JSON.stringify({
            leadId: exec.lead_id,
            executionId: exec.id,
            trigger: "timeout",
          }),
        });
        const respText = await resp.text();
        console.log(`[AUTOMATION-ENGINE] Bot timeout response for ${exec.id}: ${resp.status} ${respText.substring(0, 200)}`);
        results.bot_timeout++;
      } catch (e: any) {
        console.error(`[AUTOMATION-ENGINE] Bot timeout error for ${exec.id}:`, e.message);
      }
    }

    // =========================================================
    // 1. PROGRESSIVE REENGAGEMENT
    // =========================================================
    const { data: reengagementAutomations } = await supabase
      .from("crm_automations")
      .select("*")
      .eq("trigger_type", "progressive_reengagement")
      .eq("is_active", true);

    for (const auto of reengagementAutomations || []) {
      const config = (auto.action_config || {}) as Record<string, any>;
      const layers = (config.layers || []) as Array<{ delay_minutes: number; action_type: string; action_config: Record<string, any> }>;
      if (!layers.length) continue;

      const { data: leads } = await supabase
        .from("crm_leads")
        .select("id, phone, last_inbound_at, last_outbound_at")
        .eq("stage_id", auto.stage_id)
        .not("automation_paused", "is", true);

      for (const lead of leads || []) {
        if (!lead.last_outbound_at) continue;
        const lastOut = new Date(lead.last_outbound_at).getTime();
        const lastIn = lead.last_inbound_at ? new Date(lead.last_inbound_at).getTime() : 0;

        if (lastIn > lastOut) {
          await supabase
            .from("crm_automation_queue")
            .update({ status: "cancelled" })
            .eq("automation_id", auto.id)
            .eq("lead_id", lead.id)
            .eq("status", "pending");
          continue;
        }

        const minutesSinceLastOut = (Date.now() - lastOut) / 60000;

        for (let i = 0; i < layers.length; i++) {
          const layer = layers[i];
          if (minutesSinceLastOut < layer.delay_minutes) continue;

          const { data: existing } = await supabase
            .from("crm_automation_queue")
            .select("id")
            .eq("automation_id", auto.id)
            .eq("lead_id", lead.id)
            .eq("layer_index", i)
            .in("status", ["pending", "sent"])
            .limit(1);

          if (existing && existing.length > 0) continue;

          await supabase.from("crm_automation_queue").insert({
            automation_id: auto.id,
            lead_id: lead.id,
            action_type: layer.action_type || auto.action_type,
            action_config: layer.action_config || config,
            scheduled_at: new Date().toISOString(),
            layer_index: i,
            status: "pending",
          });
          results.progressive_reengagement++;
        }
      }
    }

    // =========================================================
    // 2. LEAD STALE (parado há X dias)
    // =========================================================
    const { data: staleAutomations } = await supabase
      .from("crm_automations")
      .select("*")
      .eq("trigger_type", "lead_stale")
      .eq("is_active", true);

    for (const auto of staleAutomations || []) {
      const config = (auto.action_config || {}) as Record<string, any>;
      const staleDays = config.stale_days || 7;
      const cutoff = new Date(Date.now() - staleDays * 86400000).toISOString();

      const { data: leads } = await supabase
        .from("crm_leads")
        .select("id, phone, updated_at, last_message_at")
        .eq("stage_id", auto.stage_id)
        .not("automation_paused", "is", true)
        .lt("updated_at", cutoff);

      for (const lead of leads || []) {
        const { data: existing } = await supabase
          .from("crm_automation_queue")
          .select("id")
          .eq("automation_id", auto.id)
          .eq("lead_id", lead.id)
          .in("status", ["pending", "sent"])
          .limit(1);

        if (existing && existing.length > 0) continue;

        await sendAction(supabase, supabaseUrl, serviceKey, auto.action_type, config, lead.id, lead.phone);

        if (config.target_stage_id) {
          await supabase.from("crm_leads").update({ stage_id: config.target_stage_id }).eq("id", lead.id);
        }

        await supabase.from("crm_automation_queue").insert({
          automation_id: auto.id,
          lead_id: lead.id,
          action_type: auto.action_type,
          action_config: config,
          scheduled_at: new Date().toISOString(),
          status: "sent",
          layer_index: 0,
        });
        results.lead_stale++;
      }
    }

    // =========================================================
    // 3. NO-SHOW
    // =========================================================
    const { data: noShowAutomations } = await supabase
      .from("crm_automations")
      .select("*")
      .eq("trigger_type", "no_show")
      .eq("is_active", true);

    for (const auto of noShowAutomations || []) {
      const config = (auto.action_config || {}) as Record<string, any>;
      const hoursAfter = config.hours_after || 2;
      const cutoffTime = new Date(Date.now() - hoursAfter * 3600000).toISOString();

      const { data: appointments } = await supabase
        .from("crm_appointments")
        .select("id, lead_id, scheduled_date, scheduled_time, status")
        .eq("status", "confirmed")
        .lt("scheduled_date", new Date().toISOString().split("T")[0]);

      for (const appt of appointments || []) {
        const { data: lead } = await supabase
          .from("crm_leads")
          .select("id, phone, stage_id")
          .eq("id", appt.lead_id)
          .eq("stage_id", auto.stage_id)
          .maybeSingle();

        if (!lead) continue;

        const { data: existing } = await supabase
          .from("crm_automation_queue")
          .select("id")
          .eq("automation_id", auto.id)
          .eq("lead_id", lead.id)
          .in("status", ["pending", "sent"])
          .limit(1);

        if (existing && existing.length > 0) continue;

        const steps = (config.steps || []) as Array<{ delay_minutes: number; action_type: string; action_config: Record<string, any> }>;
        if (steps.length > 0) {
          for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            await supabase.from("crm_automation_queue").insert({
              automation_id: auto.id,
              lead_id: lead.id,
              action_type: step.action_type || auto.action_type,
              action_config: step.action_config || config,
              scheduled_at: new Date(Date.now() + step.delay_minutes * 60000).toISOString(),
              layer_index: i,
              status: "pending",
            });
          }
        } else {
          await sendAction(supabase, supabaseUrl, serviceKey, auto.action_type, config, lead.id, lead.phone);
          await supabase.from("crm_automation_queue").insert({
            automation_id: auto.id,
            lead_id: lead.id,
            action_type: auto.action_type,
            action_config: config,
            scheduled_at: new Date().toISOString(),
            status: "sent",
            layer_index: 0,
          });
        }

        if (config.target_stage_id) {
          await supabase.from("crm_leads").update({ stage_id: config.target_stage_id }).eq("id", lead.id);
        }

        results.no_show++;
      }
    }

    // =========================================================
    // 5. BEFORE_SCHEDULED — fire X time before appointment/task
    // =========================================================
    const { data: beforeScheduledAutomations } = await supabase
      .from("crm_automations")
      .select("*")
      .eq("trigger_type", "before_scheduled")
      .eq("is_active", true);

    for (const auto of beforeScheduledAutomations || []) {
      const config = (auto.action_config || {}) as Record<string, any>;
      const beforeAmount = config.before_amount ?? 1;
      const beforeUnit = config.before_unit || "hours";
      const scheduledType = config.scheduled_type || "appointment";

      // Convert before_amount to milliseconds
      let beforeMs = 0;
      switch (beforeUnit) {
        case "seconds": beforeMs = beforeAmount * 1000; break;
        case "minutes": beforeMs = beforeAmount * 60000; break;
        case "hours": beforeMs = beforeAmount * 3600000; break;
        case "days": beforeMs = beforeAmount * 86400000; break;
      }

      const now = Date.now();
      const TZ_OFFSET = "-03:00";
      const CRON_GRACE_MS = 90 * 1000;

      // Check appointments
      if (scheduledType === "appointment" || scheduledType === "both") {
        const { data: appointments } = await supabase
          .from("crm_appointments")
          .select("id, lead_id, scheduled_date, scheduled_time")
          .in("status", ["confirmed", "pending"]);

        console.log(`[BEFORE_SCHEDULED] Checking ${appointments?.length || 0} appointments, beforeMs=${beforeMs}, now=${new Date(now).toISOString()}`);

        for (const appt of appointments || []) {
          const { data: lead } = await supabase
            .from("crm_leads")
            .select("id, phone, stage_id")
            .eq("id", appt.lead_id)
            .eq("stage_id", auto.stage_id)
            .maybeSingle();
          if (!lead) continue;

          const timeStr = appt.scheduled_time || "00:00:00";
          const scheduledAt = new Date(`${appt.scheduled_date}T${timeStr}${TZ_OFFSET}`).getTime();
          const fireAt = scheduledAt - beforeMs;
          const withinWindow = now >= fireAt && now <= scheduledAt + CRON_GRACE_MS;

          console.log(`[BEFORE_SCHEDULED] Appt ${appt.id}: scheduledAt=${new Date(scheduledAt).toISOString()}, fireAt=${new Date(fireAt).toISOString()}, now=${new Date(now).toISOString()}, withinWindow=${withinWindow}`);

          if (!withinWindow) continue;

          const { data: existing } = await supabase
            .from("crm_automation_queue")
            .select("id")
            .eq("automation_id", auto.id)
            .eq("lead_id", lead.id)
            .gte("created_at", new Date(scheduledAt - 86400000 * 7).toISOString())
            .in("status", ["pending", "sent"])
            .limit(1);
          if (existing && existing.length > 0) continue;

          console.log(`[BEFORE_SCHEDULED] FIRING for lead ${lead.id}, appt ${appt.id}`);
          await sendAction(supabase, supabaseUrl, serviceKey, auto.action_type, config, lead.id, lead.phone);
          await supabase.from("crm_automation_queue").insert({
            automation_id: auto.id,
            lead_id: lead.id,
            action_type: auto.action_type,
            action_config: config,
            scheduled_at: new Date().toISOString(),
            status: "sent",
            layer_index: 0,
          });
          results.before_scheduled++;
        }
      }

      // Check tasks
      if (scheduledType === "task" || scheduledType === "both") {
        const { data: tasks } = await supabase
          .from("crm_tasks")
          .select("id, lead_id, due_date")
          .eq("status", "pending");

        for (const task of tasks || []) {
          const { data: lead } = await supabase
            .from("crm_leads")
            .select("id, phone, stage_id")
            .eq("id", task.lead_id)
            .eq("stage_id", auto.stage_id)
            .maybeSingle();
          if (!lead) continue;

          const scheduledAt = new Date(task.due_date).getTime();
          const fireAt = scheduledAt - beforeMs;
          const withinWindow = now >= fireAt && now <= scheduledAt + CRON_GRACE_MS;

          if (!withinWindow) continue;

          const { data: existing } = await supabase
            .from("crm_automation_queue")
            .select("id")
            .eq("automation_id", auto.id)
            .eq("lead_id", lead.id)
            .gte("created_at", new Date(scheduledAt - 86400000 * 7).toISOString())
            .in("status", ["pending", "sent"])
            .limit(1);
          if (existing && existing.length > 0) continue;

          await sendAction(supabase, supabaseUrl, serviceKey, auto.action_type, config, lead.id, lead.phone);
          await supabase.from("crm_automation_queue").insert({
            automation_id: auto.id,
            lead_id: lead.id,
            action_type: auto.action_type,
            action_config: config,
            scheduled_at: new Date().toISOString(),
            status: "sent",
            layer_index: 0,
          });
          results.before_scheduled++;
        }
      }
    }

    // =========================================================
    // 6. PROCESS PENDING QUEUE (time_window + scheduled items)
    // =========================================================
    const { data: pendingQueue } = await supabase
      .from("crm_automation_queue")
      .select("*, crm_automations:automation_id(action_config, trigger_type)")
      .eq("status", "pending")
      .lte("scheduled_at", new Date().toISOString())
      .order("scheduled_at")
      .limit(100);

    for (const item of pendingQueue || []) {
      const autoConfig = ((item as any).crm_automations?.action_config || {}) as Record<string, any>;
      const triggerType = (item as any).crm_automations?.trigger_type;

      if (triggerType === "time_window" || autoConfig.time_window) {
        const tw = autoConfig.time_window || autoConfig;
        const startHour = tw.start_hour ?? 8;
        const endHour = tw.end_hour ?? 18;
        const allowedDays = (tw.days_of_week || [0, 1, 2, 3, 4, 5, 6]) as number[];

        const now = new Date();
        const currentHour = now.getHours();
        const currentDay = now.getDay();

        if (!allowedDays.includes(currentDay) || currentHour < startHour || currentHour >= endHour) {
          const nextDate = getNextValidWindow(startHour, allowedDays);
          await supabase.from("crm_automation_queue")
            .update({ scheduled_at: nextDate.toISOString() })
            .eq("id", item.id);
          continue;
        }
      }

      const { data: lead } = await supabase
        .from("crm_leads")
        .select("phone")
        .eq("id", item.lead_id)
        .single();

      await sendAction(supabase, supabaseUrl, serviceKey, item.action_type, item.action_config as Record<string, any>, item.lead_id, lead?.phone);

      await supabase.from("crm_automation_queue")
        .update({ status: "sent", updated_at: new Date().toISOString() })
        .eq("id", item.id);

      results.time_window++;
    }

    console.log("[AUTOMATION-ENGINE] Results:", JSON.stringify(results));

    return new Response(JSON.stringify({ success: true, results }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[AUTOMATION-ENGINE] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function getNextValidWindow(startHour: number, allowedDays: number[]): Date {
  const now = new Date();
  const next = new Date(now);
  next.setHours(startHour, 0, 0, 0);

  if (now.getHours() < startHour && allowedDays.includes(now.getDay())) {
    return next;
  }

  for (let i = 1; i <= 7; i++) {
    next.setDate(now.getDate() + i);
    next.setHours(startHour, 0, 0, 0);
    if (allowedDays.includes(next.getDay())) {
      return next;
    }
  }
  next.setDate(now.getDate() + 1);
  next.setHours(startHour, 0, 0, 0);
  return next;
}

async function sendAction(
  supabase: any,
  supabaseUrl: string,
  serviceKey: string,
  actionType: string,
  config: Record<string, any>,
  leadId: string,
  phone: string | null
) {
  try {
    switch (actionType) {
      case "send_template":
        if (config.template_id && phone) {
          const { data: tpl } = await supabase
            .from("crm_whatsapp_templates")
            .select("name, language")
            .eq("id", config.template_id)
            .single();
          if (tpl) {
            await fetch(`${supabaseUrl}/functions/v1/send-whatsapp-message`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
              body: JSON.stringify({ lead_id: leadId, to: phone, type: "template", template_name: tpl.name, template_language: tpl.language }),
            }).then(r => r.text());
          }
        }
        break;

      case "send_bot":
        if (config.bot_id) {
          await fetch(`${supabaseUrl}/functions/v1/bot-engine`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
            body: JSON.stringify({ leadId, botId: config.bot_id, trigger: "automation" }),
          }).then(r => r.text());
        }
        break;

      case "send_audio":
        if (config.audio_url && phone) {
          await fetch(`${supabaseUrl}/functions/v1/send-whatsapp-message`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
            body: JSON.stringify({ lead_id: leadId, to: phone, type: "audio", media_url: config.audio_url }),
          }).then(r => r.text());
        }
        break;

      case "send_file":
        if (config.file_url && phone) {
          await fetch(`${supabaseUrl}/functions/v1/send-whatsapp-message`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
            body: JSON.stringify({ lead_id: leadId, to: phone, type: "document", media_url: config.file_url, filename: config.filename || "arquivo" }),
          }).then(r => r.text());
        }
        break;

      case "add_tag": {
        const tag = config.tag as string;
        if (tag) {
          const { data: lead } = await supabase.from("crm_leads").select("tags").eq("id", leadId).single();
          const existing = (lead?.tags || []) as string[];
          if (!existing.includes(tag)) {
            await supabase.from("crm_leads").update({ tags: [...existing, tag] }).eq("id", leadId);
          }
        }
        break;
      }

      case "notify_owner": {
        const { data: lead } = await supabase.from("crm_leads").select("assigned_to, name").eq("id", leadId).single();
        if (lead?.assigned_to) {
          await supabase.from("crm_notifications").insert({
            user_id: lead.assigned_to,
            lead_id: leadId,
            title: config.notification_title || "Automação disparada",
            body: config.notification_body || `Automação acionada para o lead ${lead.name}`,
            type: "automation",
          });
        }
        break;
      }

      case "move_stage":
        if (config.target_stage_id) {
          await supabase.from("crm_leads").update({ stage_id: config.target_stage_id }).eq("id", leadId);
        }
        break;

      case "combo": {
        const actions = (config.actions || []) as Array<{ action_type: string; action_config: Record<string, any> }>;
        for (const sub of actions) {
          await sendAction(supabase, supabaseUrl, serviceKey, sub.action_type, sub.action_config || {}, leadId, phone);
        }
        break;
      }
    }
  } catch (e: any) {
    console.error(`[AUTOMATION-ENGINE] sendAction error (${actionType}):`, e.message);
  }
}
