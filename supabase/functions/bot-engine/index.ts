import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const json = (data: any, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Validate auth - accept both user JWT and service role key
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const isServiceKey = token === serviceKey;
    if (!isServiceKey) {
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        return json({ error: "Unauthorized" }, 401);
      }
    }

    const body = await req.json();
    const { leadId, botId, trigger, executionId, replyText } = body;

    if (!leadId || !trigger) {
      return json({ error: "Missing leadId or trigger" }, 400);
    }

    // ===== MANUAL START =====
    if (trigger === "manual_start") {
      if (!botId) return json({ error: "Missing botId" }, 400);

      // Cancel any active executions for this lead
      await supabase
        .from("bot_executions")
        .update({ status: "cancelled", completed_at: new Date().toISOString() })
        .eq("lead_id", leadId)
        .in("status", ["active", "waiting_reply"]);

      // Get published bot version
      const { data: bot } = await supabase
        .from("bots")
        .select("id, flow_json, current_version")
        .eq("id", botId)
        .eq("status", "published")
        .single();

      if (!bot) return json({ error: "Bot not published" }, 404);

      // Get version
      let flowJson = bot.flow_json as any;
      let versionId = null;
      if (bot.current_version > 0) {
        const { data: version } = await supabase
          .from("bot_versions")
          .select("id, flow_json")
          .eq("bot_id", botId)
          .eq("version", bot.current_version)
          .single();
        if (version) {
          flowJson = version.flow_json;
          versionId = version.id;
        }
      }

      // Find start node
      const nodes = flowJson?.nodes || [];
      const startNode = nodes.find((n: any) => n.type === "start");
      if (!startNode) return json({ error: "No start node found" }, 400);

      // Create execution
      const { data: execution, error: execError } = await supabase
        .from("bot_executions")
        .insert({
          bot_id: botId,
          bot_version_id: versionId,
          lead_id: leadId,
          status: "active",
          current_node_id: startNode.id,
          variables: {},
        })
        .select()
        .single();

      if (execError) return json({ error: execError.message }, 500);

      // Execute from start node
      const result = await executeFlow(supabase, supabaseUrl, serviceKey, authHeader, execution.id, flowJson, startNode.id, leadId, {});
      return json({ success: true, executionId: execution.id, ...result });
    }

    // ===== CONTINUE (after reply) =====
    if (trigger === "continue") {
      if (!executionId && !leadId) return json({ error: "Missing executionId or leadId" }, 400);

      // Find active execution waiting for reply
      let query = supabase
        .from("bot_executions")
        .select("*, bots(flow_json, current_version)")
        .eq("status", "waiting_reply");

      if (executionId) {
        query = query.eq("id", executionId);
      } else {
        query = query.eq("lead_id", leadId);
      }

      const { data: execution } = await query.order("started_at", { ascending: false }).limit(1).single();
      if (!execution) return json({ skipped: true, reason: "no_waiting_execution" });

      // Get the flow
      let flowJson = (execution as any).bots?.flow_json;
      if (execution.bot_version_id) {
        const { data: version } = await supabase
          .from("bot_versions")
          .select("flow_json")
          .eq("id", execution.bot_version_id)
          .single();
        if (version) flowJson = version.flow_json;
      }

      if (!flowJson) return json({ error: "Flow not found" }, 404);

      // Update variables with reply
      const variables = { ...(execution.variables as any || {}), last_reply: replyText || "" };
      // If the current node has saveToField, store the reply under that name
      const currentNode = (flowJson.nodes || []).find((n: any) => n.id === execution.current_node_id);
      if (currentNode?.data?.saveToField) {
        variables[currentNode.data.saveToField] = replyText || "";
      }
      await supabase.from("bot_executions").update({ variables, status: "active" }).eq("id", execution.id);

      // Determine which edge to follow based on reply text
      const edges = flowJson.edges || [];
      let nextEdge = null;

      // For template buttons or menu buttons/list: match reply text to button handle
      if (currentNode && (currentNode.type === "send_text" || currentNode.type === "send_menu")) {
        const templateButtons = currentNode.data?.templateButtons || [];
        const menuButtons = currentNode.data?.buttons || [];
        const listSections = currentNode.data?.listSections || [];
        const listRows = listSections.flatMap((s: any) => s.rows || []);
        
        let allButtons: any[] = [];
        let handlePrefix = "";
        if (currentNode.type === "send_text") {
          allButtons = templateButtons;
          handlePrefix = "btn-";
        } else if (currentNode.data?.menuType === "list") {
          allButtons = listRows;
          handlePrefix = "menu-";
        } else {
          allButtons = menuButtons;
          handlePrefix = "menu-";
        }

        if (allButtons.length > 0 && replyText) {
          const normalizedReply = replyText.trim().toLowerCase();
          const matchedBtn = allButtons.find((btn: any) => 
            btn.title && btn.title.trim().toLowerCase() === normalizedReply
          );
          if (matchedBtn) {
            nextEdge = edges.find((e: any) => e.source === execution.current_node_id && e.sourceHandle === `${handlePrefix}${matchedBtn.id}`);
          }
        }
        // If no button matched, try the generic reply edge
        if (!nextEdge) {
          nextEdge = edges.find((e: any) => e.source === execution.current_node_id && (e.sourceHandle === "reply" || !e.sourceHandle));
        }
      } else {
        // Standard wait_reply or other nodes: follow reply edge
        nextEdge = edges.find(
          (e: any) => e.source === execution.current_node_id && (e.sourceHandle === "reply" || !e.sourceHandle)
        );
      }

      if (!nextEdge) {
        await supabase.from("bot_executions").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", execution.id);
        return json({ completed: true, reason: "no_reply_path" });
      }

      const result = await executeFlow(supabase, supabaseUrl, serviceKey, authHeader, execution.id, flowJson, nextEdge.target, leadId, variables);
      return json({ success: true, ...result });
    }

    return json({ error: "Unknown trigger" }, 400);
  } catch (err) {
    console.error("bot-engine error:", err);
    return json({ error: err.message }, 500);
  }
});

// ===== Send message via the shared send-whatsapp-message edge function =====
async function sendViaWhatsApp(
  supabaseUrl: string,
  serviceKey: string,
  authHeader: string,
  payload: Record<string, any>
) {
  const url = `${supabaseUrl}/functions/v1/send-whatsapp-message`;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
        apikey: serviceKey,
      },
      body: JSON.stringify(payload),
    });
    const result = await resp.json();
    if (!resp.ok) {
      console.error("send-whatsapp-message error:", JSON.stringify(result));
    }
    return result;
  } catch (err) {
    console.error("send-whatsapp-message call error:", err);
    return { error: err.message };
  }
}

// ===== Flow execution engine =====
async function executeFlow(
  supabase: any,
  supabaseUrl: string,
  serviceKey: string,
  authHeader: string,
  executionId: string,
  flowJson: any,
  startNodeId: string,
  leadId: string,
  variables: Record<string, any>
): Promise<{ stopped_at?: string; reason?: string }> {
  const nodes = flowJson.nodes || [];
  const edges = flowJson.edges || [];
  let currentNodeId = startNodeId;
  let vars = { ...variables };
  let stepsExecuted = 0;
  const MAX_STEPS = 100;

  // Get lead data
  const { data: lead } = await supabase.from("crm_leads").select("*").eq("id", leadId).single();
  if (!lead) {
    await supabase.from("bot_executions").update({ status: "error", completed_at: new Date().toISOString() }).eq("id", executionId);
    return { reason: "lead_not_found" };
  }

  while (currentNodeId && stepsExecuted < MAX_STEPS) {
    stepsExecuted++;
    const node = nodes.find((n: any) => n.id === currentNodeId);
    if (!node) break;

    // Log
    await supabase.from("bot_execution_logs").insert({
      execution_id: executionId,
      node_id: currentNodeId,
      action: `execute_${node.type}`,
      details: { data: node.data },
    });

    // Update current node
    await supabase.from("bot_executions").update({ current_node_id: currentNodeId, variables: vars }).eq("id", executionId);

    // Execute node
    const result = await executeNode(supabase, supabaseUrl, serviceKey, authHeader, node, lead, vars, executionId);

    if (result.stop) {
      await supabase.from("bot_executions").update({
        status: result.status || "waiting_reply",
        current_node_id: currentNodeId,
        variables: vars,
      }).eq("id", executionId);
      return { stopped_at: currentNodeId, reason: result.reason || "paused" };
    }

    if (result.variables) {
      vars = { ...vars, ...result.variables };
    }

    // Find next node
    let nextNodeId: string | null = null;

    if (result.outputHandle) {
      const edge = edges.find((e: any) => e.source === currentNodeId && e.sourceHandle === result.outputHandle);
      nextNodeId = edge?.target || null;
    } else {
      const edge = edges.find((e: any) => e.source === currentNodeId && (!e.sourceHandle || e.sourceHandle === null));
      nextNodeId = edge?.target || null;
    }

    if (!nextNodeId) {
      await supabase.from("bot_executions").update({
        status: "completed",
        completed_at: new Date().toISOString(),
        current_node_id: currentNodeId,
        variables: vars,
      }).eq("id", executionId);
      return { stopped_at: currentNodeId, reason: "flow_completed" };
    }

    currentNodeId = nextNodeId;
  }

  await supabase.from("bot_executions").update({
    status: "error",
    completed_at: new Date().toISOString(),
    variables: vars,
  }).eq("id", executionId);
  return { reason: "max_steps_reached" };
}

async function executeNode(
  supabase: any,
  supabaseUrl: string,
  serviceKey: string,
  authHeader: string,
  node: any,
  lead: any,
  variables: Record<string, any>,
  executionId: string
): Promise<{
  stop?: boolean;
  status?: string;
  reason?: string;
  outputHandle?: string;
  variables?: Record<string, any>;
}> {
  const data = node.data || {};

  const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const replaceVars = (text: string): string => {
    if (!text) return text;

    const replacements: Record<string, string> = {
      "lead.nome": lead.name || "",
      "lead.name": lead.name || "",
      "lead.telefone": lead.phone || "",
      "lead.phone": lead.phone || "",
      "lead.origem": lead.source || "",
      "lead.source": lead.source || "",
      "lead.etapa": lead.stage_id || "",
      "lead.stage": lead.stage_id || "",
      "lead.tags": Array.isArray(lead.tags) ? lead.tags.join(", ") : "",
      "lead.valor": lead.value != null ? String(lead.value) : "",
      "lead.notas": lead.notes || "",
      "lead.notes": lead.notes || "",
      "lead.ultima_mensagem": lead.last_message || "",
      "lead.last_message": lead.last_message || "",
      "lead.criado_em": lead.created_at ? new Date(lead.created_at).toLocaleDateString("pt-BR") : "",
      "lead.nome_anuncio": lead.nome_anuncio || "",
      "lead.titulo_anuncio": lead.titulo_anuncio || "",
      "lead.follow_up_count": lead.follow_up_count != null ? String(lead.follow_up_count) : "",
      "data.hoje": new Date().toLocaleDateString("pt-BR"),
      "data.hora": new Date().toLocaleTimeString("pt-BR"),
      "resposta.ultima": variables.last_reply || "",
      last_reply: variables.last_reply || "",
    };

    // Add all saved custom variables (from saveToField in wait_reply nodes)
    Object.entries(variables).forEach(([key, value]) => {
      if (!replacements[key]) {
        replacements[key] = String(value || "");
      }
    });

    return Object.entries(replacements).reduce((result, [key, value]) => {
      const bracketPattern = new RegExp(`\\[${escapeRegExp(key)}\\]`, "gi");
      const moustachePattern = new RegExp(`\\{\\{\\s*${escapeRegExp(key)}\\s*\\}\\}`, "gi");
      return result.replace(bracketPattern, value).replace(moustachePattern, value);
    }, text);
  };

  switch (node.type) {
    case "start":
      return {};

    case "send_text": {
      // If a template is selected, send as official WhatsApp template
      if (data.templateId && data.templateName && lead.phone) {
        const templateLanguage = data.templateLanguage || "pt_BR";
        await sendViaWhatsApp(supabaseUrl, serviceKey, authHeader, {
          lead_id: lead.id,
          to: lead.phone,
          type: "template",
          template_name: data.templateName,
          template_language: templateLanguage,
        });
        // If template has buttons, wait for reply
        if (data.templateButtons && Array.isArray(data.templateButtons) && data.templateButtons.length > 0) {
          return { stop: true, status: "waiting_reply", reason: "waiting_template_button" };
        }
        return {};
      }

      // Otherwise send as plain text
      const text = replaceVars(data.text || "");
      if (text && lead.phone) {
        await sendViaWhatsApp(supabaseUrl, serviceKey, authHeader, {
          lead_id: lead.id,
          to: lead.phone,
          type: "text",
          message: text,
        });
      }
      return {};
    }

    case "send_image": {
      const caption = replaceVars(data.caption || "");
      if (data.imageUrl && lead.phone) {
        await sendViaWhatsApp(supabaseUrl, serviceKey, authHeader, {
          lead_id: lead.id,
          to: lead.phone,
          type: "image",
          media_url: data.imageUrl,
          message: caption || undefined,
        });
      }
      return {};
    }

    case "send_audio": {
      if (data.audioUrl && lead.phone) {
        await sendViaWhatsApp(supabaseUrl, serviceKey, authHeader, {
          lead_id: lead.id,
          to: lead.phone,
          type: "audio",
          media_url: data.audioUrl,
          audio_voice: true,
        });
      }
      return {};
    }

    case "send_file": {
      const caption = replaceVars(data.caption || "");
      if (data.fileUrl && lead.phone) {
        await sendViaWhatsApp(supabaseUrl, serviceKey, authHeader, {
          lead_id: lead.id,
          to: lead.phone,
          type: "document",
          media_url: data.fileUrl,
          message: caption || undefined,
        });
      }
      return {};
    }

    case "send_video": {
      const caption = replaceVars(data.caption || "");
      if (data.videoUrl && lead.phone) {
        await sendViaWhatsApp(supabaseUrl, serviceKey, authHeader, {
          lead_id: lead.id,
          to: lead.phone,
          type: "video",
          media_url: data.videoUrl,
          message: caption || undefined,
        });
      }
      return {};
    }

    case "delay": {
      const amount = data.delaySeconds || 5;
      const unit = data.unit || "seconds";
      let ms = amount * 1000;
      if (unit === "minutes") ms = amount * 60 * 1000;
      if (unit === "hours") ms = amount * 3600 * 1000;

      if (ms <= 30000) {
        await new Promise((r) => setTimeout(r, ms));
        return {};
      }
      if (ms <= 300000) {
        await new Promise((r) => setTimeout(r, ms));
        return {};
      }
      return { stop: true, status: "active", reason: "delay_too_long" };
    }

    case "wait_reply": {
      return { stop: true, status: "waiting_reply", reason: "waiting_for_reply" };
    }

    case "condition": {
      const field = data.field || "";
      const operator = data.operator || "equals";
      const condValue = data.value || "";

      let fieldValue = "";
      if (field === "last_reply") fieldValue = variables.last_reply || "";
      else if (field === "lead.name") fieldValue = lead.name || "";
      else if (field === "lead.source") fieldValue = lead.source || "";
      else if (field === "lead.tags") fieldValue = (lead.tags || []).join(",");
      else if (field === "lead.stage") fieldValue = lead.stage_id || "";

      let result = false;
      switch (operator) {
        case "equals": result = fieldValue === condValue; break;
        case "not_equals": result = fieldValue !== condValue; break;
        case "contains": result = fieldValue.toLowerCase().includes(condValue.toLowerCase()); break;
        case "not_contains": result = !fieldValue.toLowerCase().includes(condValue.toLowerCase()); break;
        case "starts_with": result = fieldValue.toLowerCase().startsWith(condValue.toLowerCase()); break;
        case "is_empty": result = !fieldValue || fieldValue.trim() === ""; break;
        case "not_empty": result = !!fieldValue && fieldValue.trim() !== ""; break;
        default: result = false;
      }

      return { outputHandle: result ? "true" : "false" };
    }

    case "move_stage": {
      if (data.stageId && data.stageId !== lead.stage_id) {
        await supabase.from("crm_leads").update({ stage_id: data.stageId }).eq("id", lead.id);
        await supabase.from("crm_lead_stage_history").update({ exited_at: new Date().toISOString() })
          .eq("lead_id", lead.id).eq("stage_id", lead.stage_id).is("exited_at", null);
        await supabase.from("crm_lead_stage_history").insert({ lead_id: lead.id, stage_id: data.stageId });
        const { data: stages } = await supabase.from("crm_stages").select("id, name").in("id", [lead.stage_id, data.stageId]);
        const fromName = stages?.find((s: any) => s.id === lead.stage_id)?.name || "?";
        const toName = stages?.find((s: any) => s.id === data.stageId)?.name || "?";
        await supabase.from("messages").insert({
          lead_id: lead.id,
          content: `Etapa alterada: ${fromName} → ${toName} (Bot)`,
          type: "system",
          direction: "outbound",
          status: "sent",
        });
      }
      return {};
    }

    case "add_tag": {
      if (data.tag) {
        const currentTags = lead.tags || [];
        if (!currentTags.includes(data.tag)) {
          await supabase.from("crm_leads").update({ tags: [...currentTags, data.tag] }).eq("id", lead.id);
        }
      }
      return {};
    }

    case "remove_tag": {
      if (data.tag) {
        const currentTags = lead.tags || [];
        await supabase.from("crm_leads").update({ tags: currentTags.filter((t: string) => t !== data.tag) }).eq("id", lead.id);
      }
      return {};
    }

    case "add_note": {
      if (data.note) {
        const noteText = replaceVars(data.note);
        const existingNotes = lead.notes || "";
        const timestamp = new Date().toLocaleString("pt-BR");
        const updatedNotes = `${existingNotes}\n[${timestamp}] [Bot] ${noteText}`.trim();
        await supabase.from("crm_leads").update({ notes: updatedNotes }).eq("id", lead.id);
      }
      return {};
    }

    case "create_task": {
      if (data.title) {
        const dueDate = new Date(Date.now() + (data.dueHours || 24) * 3600 * 1000).toISOString();
        const taskNotes = data.taskNotes ? replaceVars(data.taskNotes) : null;
        await supabase.from("crm_tasks").insert({
          lead_id: lead.id,
          title: replaceVars(data.title),
          due_date: dueDate,
          status: "pending",
          type: data.taskType || "personalizado",
          notes: taskNotes,
        });
        await supabase.from("crm_leads").update({ has_task: true }).eq("id", lead.id);
      }
      return {};
    }

    case "send_menu": {
      // Send interactive menu via WhatsApp
      if (lead.phone) {
        const menuBody = replaceVars(data.body || data.text || "Escolha uma opção:");
        const buttons = data.buttons || [];
        
        if (data.menuType === "list" && data.sections) {
          // List menu
          await sendViaWhatsApp(supabaseUrl, serviceKey, authHeader, {
            lead_id: lead.id,
            to: lead.phone,
            type: "interactive",
            interactive_type: "list",
            body: menuBody,
            button_text: data.buttonText || "Ver opções",
            sections: data.sections,
          });
        } else if (buttons.length > 0) {
          // Button menu (max 3 buttons)
          await sendViaWhatsApp(supabaseUrl, serviceKey, authHeader, {
            lead_id: lead.id,
            to: lead.phone,
            type: "interactive",
            interactive_type: "button",
            body: menuBody,
            buttons: buttons.slice(0, 3).map((b: any) => ({
              type: "reply",
              reply: { id: b.id, title: (b.title || "").slice(0, 20) },
            })),
          });
        } else {
          // Fallback: send as text
          await sendViaWhatsApp(supabaseUrl, serviceKey, authHeader, {
            lead_id: lead.id,
            to: lead.phone,
            type: "text",
            message: menuBody,
          });
        }
      }
      // Always wait for reply after sending menu
      return { stop: true, status: "waiting_reply", reason: "waiting_menu_reply" };
    }

    case "transfer_human": {
      return { stop: true, status: "completed", reason: "transferred_to_human" };
    }

    default:
      return {};
  }
}
