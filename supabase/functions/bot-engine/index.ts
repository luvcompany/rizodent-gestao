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

  try {
    const { leadId, trigger, message, newStageId, messageType } = await req.json();

    if (trigger === "inbound_message") {
      return await handleInboundMessage(supabase, leadId, message);
    } else if (trigger === "check_timeouts") {
      return await handleCheckTimeouts(supabase);
    } else if (trigger === "stage_changed") {
      return await handleStageChanged(supabase, leadId, newStageId);
    }

    return json({ error: "Unknown trigger" }, 400);
  } catch (err) {
    return json({ error: err.message }, 500);
  }
});

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ─── TRIGGER HANDLERS ───

async function handleInboundMessage(supabase: any, leadId: string, message?: string) {
  const lead = await getLead(supabase, leadId);
  if (!lead || lead.automation_paused) return json({ skipped: true, reason: "paused" });

  // Update last_inbound_at
  await supabase.from("crm_leads").update({ last_inbound_at: new Date().toISOString() }).eq("id", leadId);

  const { data: exec } = await supabase
    .from("bot_executions")
    .select("*, current_node:bot_nodes(*)")
    .eq("lead_id", leadId)
    .in("status", ["active", "waiting_reply", "waiting_timeout"])
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!exec) return json({ skipped: true, reason: "no_active_execution" });

  // Find matching output based on waiting_for
  const { data: outputs } = await supabase
    .from("bot_node_outputs")
    .select("*")
    .eq("node_id", exec.current_node_id);

  let nextNodeId: string | null = null;

  if (exec.waiting_for === "any_reply") {
    const match = outputs?.find((o: any) => o.condition_type === "any_reply");
    nextNodeId = match?.next_node_id || null;
  } else if (exec.waiting_for?.startsWith("button_")) {
    const btnMatch = outputs?.find(
      (o: any) => o.condition_type === "button" && o.condition_value === message
    );
    nextNodeId = btnMatch?.next_node_id || null;
    if (!nextNodeId) {
      const anyMatch = outputs?.find((o: any) => o.condition_type === "any_reply");
      nextNodeId = anyMatch?.next_node_id || null;
    }
  }

  if (!nextNodeId) return json({ skipped: true, reason: "no_matching_output" });

  const { data: nextNode } = await supabase.from("bot_nodes").select("*").eq("id", nextNodeId).single();
  if (!nextNode) return json({ error: "next_node_not_found" }, 404);

  await supabase.from("bot_executions").update({ status: "active", current_node_id: nextNodeId }).eq("id", exec.id);
  await logExecution(supabase, exec.id, exec.current_node_id, "reply_received", message || "");

  await executeNode(supabase, exec, nextNode, leadId);
  return json({ success: true });
}

async function handleCheckTimeouts(supabase: any) {
  const { data: execs } = await supabase
    .from("bot_executions")
    .select("*")
    .eq("status", "waiting_timeout")
    .lte("timeout_at", new Date().toISOString());

  if (!execs?.length) return json({ processed: 0 });

  let processed = 0;
  for (const exec of execs) {
    const lead = await getLead(supabase, exec.lead_id);
    if (!lead || lead.automation_paused) continue;

    const { data: outputs } = await supabase
      .from("bot_node_outputs")
      .select("*")
      .eq("node_id", exec.current_node_id)
      .eq("condition_type", "timeout");

    const timeoutOutput = outputs?.[0];
    if (!timeoutOutput?.next_node_id) {
      await supabase.from("bot_executions").update({ status: "completed", finished_at: new Date().toISOString() }).eq("id", exec.id);
      continue;
    }

    const { data: nextNode } = await supabase.from("bot_nodes").select("*").eq("id", timeoutOutput.next_node_id).single();
    if (!nextNode) continue;

    await supabase.from("bot_executions").update({ status: "active", current_node_id: nextNode.id }).eq("id", exec.id);
    await logExecution(supabase, exec.id, exec.current_node_id, "timeout_triggered", "");

    // Increment follow_up_count
    await supabase.from("crm_leads").update({ follow_up_count: (lead.follow_up_count || 0) + 1 }).eq("id", exec.lead_id);

    await executeNode(supabase, exec, nextNode, exec.lead_id);
    processed++;
  }

  return json({ processed });
}

async function handleStageChanged(supabase: any, leadId: string, newStageId: string) {
  // Cancel all active executions
  await supabase
    .from("bot_executions")
    .update({ status: "cancelled", cancel_reason: "stage_changed", finished_at: new Date().toISOString() })
    .eq("lead_id", leadId)
    .in("status", ["active", "waiting_reply", "waiting_timeout"]);

  // Check if final stage
  const { data: stageConfig } = await supabase
    .from("stage_bot_config")
    .select("*")
    .eq("stage_id", newStageId)
    .maybeSingle();

  if (stageConfig?.is_final_stage) {
    return json({ success: true, reason: "final_stage" });
  }

  // Start new bot if configured
  if (stageConfig?.bot_id && stageConfig.active) {
    const { data: startNode } = await supabase
      .from("bot_nodes")
      .select("*")
      .eq("bot_id", stageConfig.bot_id)
      .eq("is_start_node", true)
      .maybeSingle();

    if (startNode) {
      const { data: newExec } = await supabase
        .from("bot_executions")
        .insert({
          bot_id: stageConfig.bot_id,
          lead_id: leadId,
          current_node_id: startNode.id,
          status: "active",
        })
        .select()
        .single();

      await logExecution(supabase, newExec.id, startNode.id, "bot_started", `stage: ${newStageId}`);
      await executeNode(supabase, newExec, startNode, leadId);
    }
  }

  return json({ success: true });
}

// ─── NODE EXECUTOR ───

async function executeNode(supabase: any, execution: any, node: any, leadId: string) {
  const lead = await getLead(supabase, leadId);
  if (!lead || lead.automation_paused) return;

  // Check final stage
  const { data: stageConfig } = await supabase
    .from("stage_bot_config")
    .select("is_final_stage")
    .eq("stage_id", lead.stage_id)
    .maybeSingle();
  if (stageConfig?.is_final_stage) {
    await supabase.from("bot_executions").update({ status: "completed", finished_at: new Date().toISOString() }).eq("id", execution.id);
    return;
  }

  const config = node.config || {};

  switch (node.type) {
    case "message_text": {
      let text = config.message || "";
      text = text.replace(/\{\{nome\}\}/g, lead.name || "");
      text = text.replace(/\{\{telefone\}\}/g, lead.phone || "");

      await callSendWhatsapp(supabase, {
        lead_id: leadId, to: lead.phone, message: text, type: "text",
      });
      await supabase.from("crm_leads").update({ last_outbound_at: new Date().toISOString() }).eq("id", leadId);
      await logExecution(supabase, execution.id, node.id, "message_text_sent", text);

      const nextOutput = await getDefaultOutput(supabase, node.id);
      if (nextOutput?.next_node_id) {
        const { data: next } = await supabase.from("bot_nodes").select("*").eq("id", nextOutput.next_node_id).single();
        await supabase.from("bot_executions").update({ current_node_id: next.id }).eq("id", execution.id);
        await executeNode(supabase, execution, next, leadId);
      }
      break;
    }

    case "message_template": {
      await callSendWhatsapp(supabase, {
        lead_id: leadId, to: lead.phone, type: "template",
        template_name: config.template_name, template_language: config.template_language || "pt_BR",
        template_components: config.template_components || [],
      });
      await supabase.from("crm_leads").update({ last_outbound_at: new Date().toISOString() }).eq("id", leadId);
      await logExecution(supabase, execution.id, node.id, "template_sent", config.template_name);

      const nextOutput = await getDefaultOutput(supabase, node.id);
      if (nextOutput?.next_node_id) {
        const { data: next } = await supabase.from("bot_nodes").select("*").eq("id", nextOutput.next_node_id).single();
        await supabase.from("bot_executions").update({ current_node_id: next.id }).eq("id", execution.id);
        await executeNode(supabase, execution, next, leadId);
      }
      break;
    }

    case "message_audio": {
      await callSendWhatsapp(supabase, {
        lead_id: leadId, to: lead.phone, type: "audio", media_url: config.audio_url,
      });
      await supabase.from("crm_leads").update({ last_outbound_at: new Date().toISOString() }).eq("id", leadId);
      await logExecution(supabase, execution.id, node.id, "audio_sent", config.audio_url);

      const nextOutput = await getDefaultOutput(supabase, node.id);
      if (nextOutput?.next_node_id) {
        const { data: next } = await supabase.from("bot_nodes").select("*").eq("id", nextOutput.next_node_id).single();
        await supabase.from("bot_executions").update({ current_node_id: next.id }).eq("id", execution.id);
        await executeNode(supabase, execution, next, leadId);
      }
      break;
    }

    case "wait": {
      const waitType = config.type || "timeout";
      const updates: any = { waiting_since: new Date().toISOString(), current_node_id: node.id };

      if (waitType === "timeout" || waitType === "both") {
        const hours = config.hours || 1;
        const timeoutAt = new Date(Date.now() + hours * 3600000).toISOString();
        updates.status = "waiting_timeout";
        updates.timeout_at = timeoutAt;
      }
      if (waitType === "reply" || waitType === "both") {
        updates.waiting_for = "any_reply";
        if (waitType === "reply") updates.status = "waiting_reply";
      }

      await supabase.from("bot_executions").update(updates).eq("id", execution.id);
      await logExecution(supabase, execution.id, node.id, "wait_started", `type: ${waitType}`);
      break;
    }

    case "condition": {
      const field = config.field;
      const operator = config.operator || "equals";
      const value = config.value;
      const leadValue = (lead as any)[field] || "";

      let matched = false;
      if (operator === "equals") matched = String(leadValue) === String(value);
      else if (operator === "not_equals") matched = String(leadValue) !== String(value);
      else if (operator === "contains") matched = String(leadValue).includes(String(value));
      else if (operator === "greater_than") matched = Number(leadValue) > Number(value);
      else if (operator === "less_than") matched = Number(leadValue) < Number(value);

      const condType = matched ? "field_match" : "field_no_match";
      const { data: outputs } = await supabase
        .from("bot_node_outputs")
        .select("*")
        .eq("node_id", node.id)
        .eq("condition_type", condType);

      const output = outputs?.[0];
      await logExecution(supabase, execution.id, node.id, "condition_evaluated", `${field} ${operator} ${value} => ${matched}`);

      if (output?.next_node_id) {
        const { data: next } = await supabase.from("bot_nodes").select("*").eq("id", output.next_node_id).single();
        await supabase.from("bot_executions").update({ current_node_id: next.id }).eq("id", execution.id);
        await executeNode(supabase, execution, next, leadId);
      }
      break;
    }

    case "action_move_stage": {
      const targetStageId = config.stage_id;
      await supabase.from("crm_leads").update({ stage_id: targetStageId }).eq("id", leadId);
      await logExecution(supabase, execution.id, node.id, "stage_moved", targetStageId);

      // Trigger stage_changed (will cancel this execution)
      await callBotEngine(supabase, { leadId, trigger: "stage_changed", newStageId: targetStageId });
      break;
    }

    case "action_set_field": {
      const fieldName = config.field;
      const fieldValue = config.value;
      await supabase.from("crm_leads").update({ [fieldName]: fieldValue }).eq("id", leadId);
      await logExecution(supabase, execution.id, node.id, "field_set", `${fieldName} = ${fieldValue}`);

      const nextOutput = await getDefaultOutput(supabase, node.id);
      if (nextOutput?.next_node_id) {
        const { data: next } = await supabase.from("bot_nodes").select("*").eq("id", nextOutput.next_node_id).single();
        await supabase.from("bot_executions").update({ current_node_id: next.id }).eq("id", execution.id);
        await executeNode(supabase, execution, next, leadId);
      }
      break;
    }

    case "action_add_tag": {
      const tag = config.tag;
      const currentTags = lead.tags || [];
      if (!currentTags.includes(tag)) {
        await supabase.from("crm_leads").update({ tags: [...currentTags, tag] }).eq("id", leadId);
      }
      await logExecution(supabase, execution.id, node.id, "tag_added", tag);

      const nextOutput = await getDefaultOutput(supabase, node.id);
      if (nextOutput?.next_node_id) {
        const { data: next } = await supabase.from("bot_nodes").select("*").eq("id", nextOutput.next_node_id).single();
        await supabase.from("bot_executions").update({ current_node_id: next.id }).eq("id", execution.id);
        await executeNode(supabase, execution, next, leadId);
      }
      break;
    }

    case "action_end_bot": {
      await supabase.from("bot_executions").update({ status: "completed", finished_at: new Date().toISOString() }).eq("id", execution.id);
      await logExecution(supabase, execution.id, node.id, "bot_ended", "");
      break;
    }

    default:
      await logExecution(supabase, execution.id, node.id, "unknown_node_type", node.type);
  }
}

// ─── HELPERS ───

async function getLead(supabase: any, leadId: string) {
  const { data } = await supabase.from("crm_leads").select("*").eq("id", leadId).single();
  return data;
}

async function getDefaultOutput(supabase: any, nodeId: string) {
  const { data } = await supabase
    .from("bot_node_outputs")
    .select("*")
    .eq("node_id", nodeId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data;
}

async function logExecution(supabase: any, executionId: string, nodeId: string | null, action: string, result: string) {
  await supabase.from("bot_execution_logs").insert({
    execution_id: executionId,
    node_id: nodeId,
    action,
    result,
  });
}

async function callSendWhatsapp(supabase: any, payload: any) {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-whatsapp-message`;
  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify(payload),
  });
}

async function callBotEngine(supabase: any, payload: any) {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/bot-engine`;
  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify(payload),
  });
}
