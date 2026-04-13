import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const normalizeReply = (value: string | null | undefined) =>
  String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

function resolveInteractiveOption(
  currentNode: any,
  replyText: string,
  replyOptionId?: string | null,
) {
  const templateButtons = currentNode.data?.templateButtons || [];
  const menuButtons = currentNode.data?.buttons || [];
  const listSections = currentNode.data?.listSections || [];
  const listRows = listSections.flatMap((section: any) => section.rows || []);

  let options: any[] = [];
  let handlePrefix = "";

  if (currentNode.type === "send_text") {
    options = templateButtons;
    handlePrefix = "btn-";
  } else if (currentNode.data?.menuType === "list") {
    options = listRows;
    handlePrefix = "menu-";
  } else {
    options = menuButtons;
    handlePrefix = "menu-";
  }

  let matchedOption = null;

  if (replyOptionId) {
    matchedOption = options.find((option: any) => String(option.id || "") === String(replyOptionId));
  }

  if (!matchedOption && replyText) {
    const normalizedReply = normalizeReply(replyText);
    matchedOption = options.find((option: any) => normalizeReply(option.title) === normalizedReply);
  }

  return {
    matchedOption,
    nextHandle: matchedOption ? `${handlePrefix}${matchedOption.id}` : null,
    replyValue: replyText || matchedOption?.title || "",
  };
}

function autoAdvanceCapturedReply(
  startNodeId: string | null | undefined,
  nodes: any[],
  edges: any[],
  variables: Record<string, any>,
  replyValue: string,
) {
  let nextNodeId = startNodeId || null;
  let nextVariables = { ...variables };
  let autoAdvanced = false;
  let guard = 0;

  while (nextNodeId && guard < 10) {
    guard += 1;
    const node = nodes.find((item: any) => item.id === nextNodeId);
    if (!node || node.type !== "wait_reply") break;
    if (!node.data?.saveToField) break;

    nextVariables[node.data.saveToField] = replyValue;
    nextVariables.last_reply = replyValue;

    const replyEdge = edges.find(
      (edge: any) => edge.source === nextNodeId && (edge.sourceHandle === "reply" || !edge.sourceHandle),
    );

    if (!replyEdge?.target) break;

    nextNodeId = replyEdge.target;
    autoAdvanced = true;
  }

  return { nextNodeId, nextVariables, autoAdvanced };
}

/** Calculate timeout_at from a node's timeout configuration */
function calculateTimeoutAt(nodeData: any): string | null {
  const hours = nodeData?.timeoutHours ?? 1;
  const minutes = nodeData?.timeoutMinutes ?? 0;
  const seconds = nodeData?.timeoutSeconds ?? 0;
  const totalMs = (hours * 3600 + minutes * 60 + seconds) * 1000;
  if (totalMs <= 0) return null;
  return new Date(Date.now() + totalMs).toISOString();
}

function getTemplatePlaceholderIndexes(content: string | null | undefined): number[] {
  if (!content) return [];

  const indexes = new Set<number>();
  for (const match of content.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0) {
      indexes.add(value);
    }
  }

  return [...indexes].sort((a, b) => a - b);
}

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
    const { leadId, botId, trigger, executionId, replyText, replyOptionId } = body;

    if (!leadId || !trigger) {
      return json({ error: "Missing leadId or trigger" }, 400);
    }

    // ===== MANUAL START or AUTOMATION =====
    if (trigger === "manual_start" || trigger === "automation" || trigger === "automation_bulk") {
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

    // ===== TIMEOUT (automation-engine detected expired timeout) =====
    if (trigger === "timeout") {
      if (!executionId) return json({ error: "Missing executionId for timeout" }, 400);

      const { data: execution } = await supabase
        .from("bot_executions")
        .select("*, bots(flow_json, current_version)")
        .eq("id", executionId)
        .eq("status", "waiting_reply")
        .single();

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

      const nodes = flowJson.nodes || [];
      const edges = flowJson.edges || [];

      // Find the timeout edge from the current node
      const timeoutEdge = edges.find(
        (e: any) =>
          e.source === execution.current_node_id &&
          (e.sourceHandle === "timeout" || e.sourceHandle === "no-response")
      );

      if (!timeoutEdge) {
        // No timeout path configured — complete the execution
        console.log(`[bot-engine] Timeout fired for node ${execution.current_node_id} but no timeout edge found, completing`);
        await supabase.from("bot_executions").update({
          status: "completed",
          completed_at: new Date().toISOString(),
          timeout_at: null,
        }).eq("id", executionId);
        return json({ completed: true, reason: "timeout_no_path" });
      }

      console.log(`[bot-engine] Timeout fired for execution ${executionId}, following timeout edge to ${timeoutEdge.target}`);

      // Clear timeout and continue
      await supabase.from("bot_executions").update({
        status: "active",
        timeout_at: null,
        variables: execution.variables,
      }).eq("id", executionId);

      const result = await executeFlow(
        supabase, supabaseUrl, serviceKey, authHeader,
        executionId, flowJson, timeoutEdge.target, execution.lead_id,
        (execution.variables as any) || {}
      );

      return json({ success: true, ...result });
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

      const nodes = flowJson.nodes || [];
      const edges = flowJson.edges || [];

      // Get lead data before fallback handling
      const { data: lead } = await supabase.from("crm_leads").select("phone").eq("id", leadId).single();

      // Update variables with reply
      const variables = { ...(execution.variables as any || {}), last_reply: replyText || "" };
      if (replyOptionId) {
        variables.last_reply_option_id = replyOptionId;
      }

      // If the current node has saveToField, store the reply under that name
      const currentNode = nodes.find((n: any) => n.id === execution.current_node_id);
      if (currentNode?.data?.saveToField) {
        variables[currentNode.data.saveToField] = replyText || "";
      }

      // Determine which edge to follow based on reply text
      let nextEdge = null;
      let replyValue = replyText || "";

      // For template buttons or menu buttons/list: match reply text to button handle
      if (currentNode && (currentNode.type === "send_text" || currentNode.type === "send_menu")) {
        const { matchedOption, nextHandle, replyValue: resolvedReplyValue } = resolveInteractiveOption(
          currentNode,
          replyText || "",
          replyOptionId,
        );
        replyValue = resolvedReplyValue;

        if (matchedOption && nextHandle) {
          nextEdge = edges.find((e: any) => e.source === execution.current_node_id && e.sourceHandle === nextHandle);
        }

        // If no button matched, try the generic reply edge
        if (!nextEdge) {
          nextEdge = edges.find((e: any) => e.source === execution.current_node_id && (e.sourceHandle === "reply" || !e.sourceHandle));
        }

        // FALLBACK: If still no edge found, re-send the menu and keep waiting
        if (!nextEdge && currentNode.type === "send_menu") {
          console.log(`[bot-engine] No edge for reply "${replyText}" at node ${execution.current_node_id}, re-sending menu`);
          if (lead?.phone) {
            await sendViaWhatsApp(supabaseUrl, serviceKey, authHeader, {
              lead_id: leadId,
              to: lead.phone,
              type: "text",
              message: "Por favor, selecione uma das opções do menu acima. 👆",
            });
          }
          // Reset timeout since lead interacted
          const newTimeoutAt = calculateTimeoutAt(currentNode.data);
          await supabase.from("bot_executions").update({ status: "waiting_reply", variables, timeout_at: newTimeoutAt }).eq("id", execution.id);
          return json({ success: true, waiting: true, reason: "re_prompted_menu" });
        }
      } else {
        // Standard wait_reply or other nodes: follow reply edge
        nextEdge = edges.find(
          (e: any) => e.source === execution.current_node_id && (e.sourceHandle === "reply" || !e.sourceHandle)
        );
      }

      if (!nextEdge) {
        console.log(`[bot-engine] No path found from node ${execution.current_node_id} after reply "${replyText}"`);
        await supabase.from("bot_executions").update({ status: "completed", completed_at: new Date().toISOString(), timeout_at: null }).eq("id", execution.id);
        return json({ completed: true, reason: "no_reply_path" });
      }

      let nextTargetNodeId = nextEdge.target;
      let nextVariables = variables;

      if (currentNode && (currentNode.type === "send_text" || currentNode.type === "send_menu")) {
        const autoAdvance = autoAdvanceCapturedReply(nextEdge.target, nodes, edges, variables, replyValue);
        nextTargetNodeId = autoAdvance.nextNodeId;
        nextVariables = autoAdvance.nextVariables;

        if (autoAdvance.autoAdvanced) {
          console.log(`[bot-engine] Auto-advanced captured reply from ${execution.current_node_id} to ${nextTargetNodeId}`);
        }
      }

      // Clear timeout since lead replied
      await supabase.from("bot_executions").update({ variables: nextVariables, status: "active", timeout_at: null }).eq("id", execution.id);

      if (!nextTargetNodeId) {
        await supabase.from("bot_executions").update({ status: "completed", completed_at: new Date().toISOString(), variables: nextVariables, timeout_at: null }).eq("id", execution.id);
        return json({ completed: true, reason: "flow_completed_after_reply" });
      }

      const result = await executeFlow(supabase, supabaseUrl, serviceKey, authHeader, execution.id, flowJson, nextTargetNodeId, leadId, nextVariables);
      return json({ success: true, ...result });
    }

    return json({ error: "Unknown trigger" }, 400);
  } catch (err: any) {
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
  } catch (err: any) {
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
    let result;
    try {
      result = await executeNode(supabase, supabaseUrl, serviceKey, authHeader, node, lead, vars, executionId);
    } catch (error: any) {
      console.error(`[bot-engine] Node execution failed at ${currentNodeId}:`, error?.message || error);
      await supabase.from("bot_executions").update({
        status: "error",
        completed_at: new Date().toISOString(),
        current_node_id: currentNodeId,
        variables: vars,
        timeout_at: null,
      }).eq("id", executionId);
      return { stopped_at: currentNodeId, reason: error?.message || "node_execution_failed" };
    }

    if (result.stop) {
      // Calculate timeout_at for waiting nodes
      let timeoutAt: string | null = null;
      if (result.status === "waiting_reply") {
        timeoutAt = calculateTimeoutAt(node.data);
        console.log(`[bot-engine] Waiting at node ${currentNodeId}, timeout_at: ${timeoutAt}`);
      }

      await supabase.from("bot_executions").update({
        status: result.status || "waiting_reply",
        current_node_id: currentNodeId,
        variables: vars,
        timeout_at: timeoutAt,
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
        timeout_at: null,
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

  const sendAndAssert = async (payload: Record<string, any>, context: string) => {
    const result = await sendViaWhatsApp(supabaseUrl, serviceKey, authHeader, payload);
    if (result?.error) {
      const details = result?.details ? ` ${JSON.stringify(result.details)}` : "";
      throw new Error(`${context}: ${result.error}${details}`);
    }
    return result;
  };

  const resolveTemplateParamValue = (rawValue: any, fallbackValue: string) => {
    if (rawValue == null) return fallbackValue;

    if (typeof rawValue === "string") {
      const resolved = replaceVars(rawValue).trim();
      return resolved || fallbackValue;
    }

    if (typeof rawValue === "object") {
      const candidate = rawValue.value ?? rawValue.variable ?? rawValue.text ?? rawValue.label ?? "";
      const resolved = replaceVars(String(candidate)).trim();
      return resolved || fallbackValue;
    }

    const resolved = replaceVars(String(rawValue)).trim();
    return resolved || fallbackValue;
  };

  const buildTemplateComponent = (componentType: "body" | "header", templateText: string | null | undefined) => {
    const placeholderIndexes = getTemplatePlaceholderIndexes(templateText);
    if (!placeholderIndexes.length) return null;

    const configuredParams = Array.isArray(data.templateParams)
      ? data.templateParams
      : Array.isArray(data.templateVariables)
        ? data.templateVariables
        : [];

    const safeFallback = (lead.name || variables.last_reply || "cliente").trim() || "cliente";
    const fallbackValues = [
      lead.name || safeFallback,
      variables.last_reply || safeFallback,
      lead.phone || safeFallback,
      lead.source || safeFallback,
      lead.last_message || safeFallback,
      lead.value != null ? String(lead.value) : safeFallback,
    ];

    return {
      type: componentType,
      parameters: placeholderIndexes.map((placeholderIndex, position) => {
        const configuredValue = configuredParams[placeholderIndex - 1] ?? configuredParams[position];
        const fallbackValue = String(fallbackValues[position] ?? safeFallback).trim() || safeFallback;

        return {
          type: "text",
          text: resolveTemplateParamValue(configuredValue, fallbackValue),
        };
      }),
    };
  };

  switch (node.type) {
    case "start":
      return {};

    case "send_text": {
      // If a template is selected, send as official WhatsApp template
      if (data.templateId && lead.phone) {
        let templateName = data.templateName;
        let templateLanguage = data.templateLanguage || "pt_BR";
        const { data: tplRow } = await supabase
          .from("crm_whatsapp_templates")
          .select("name, language, body_text, header_content")
          .eq("id", data.templateId)
          .single();
        if (tplRow) {
          templateName = tplRow.name;
          templateLanguage = tplRow.language || templateLanguage;
        }
        if (!templateName) {
          console.error(`[bot-engine] Template ${data.templateId} not found in DB`);
          return {};
        }

        const templateComponents = [
          buildTemplateComponent("header", tplRow?.header_content),
          buildTemplateComponent("body", tplRow?.body_text || data.text),
        ].filter(Boolean);

        console.log(`[bot-engine] Sending template ${templateName} with ${templateComponents.length} component(s) for node ${node.id}`);

        await sendAndAssert({
          lead_id: lead.id,
          to: lead.phone,
          type: "template",
          template_name: templateName,
          template_language: templateLanguage,
          template_components: templateComponents,
        }, `template_send_failed:${node.id}`);
        // Templates with buttons OR with timeout: wait for reply
        if ((data.templateButtons && Array.isArray(data.templateButtons) && data.templateButtons.length > 0) ||
            (data.timeoutHours > 0 || data.timeoutMinutes > 0 || data.timeoutSeconds > 0)) {
          return { stop: true, status: "waiting_reply", reason: "waiting_template_reply" };
        }
        return {};
      }

      // Otherwise send as plain text
      const text = replaceVars(data.text || "");
      if (text && lead.phone) {
        await sendAndAssert({
          lead_id: lead.id,
          to: lead.phone,
          type: "text",
          message: text,
        }, `text_send_failed:${node.id}`);
      }
      // If timeout is configured on plain text, wait for reply too
      if (data.timeoutHours > 0 || data.timeoutMinutes > 0 || data.timeoutSeconds > 0) {
        return { stop: true, status: "waiting_reply", reason: "waiting_text_reply" };
      }
      return {};
    }

    case "send_image": {
      const caption = replaceVars(data.caption || "");
      if (data.imageUrl && lead.phone) {
        await sendAndAssert({
          lead_id: lead.id,
          to: lead.phone,
          type: "image",
          media_url: data.imageUrl,
          message: caption || undefined,
        }, `image_send_failed:${node.id}`);
      }
      return {};
    }

    case "send_audio": {
      if (data.audioUrl && lead.phone) {
        await sendAndAssert({
          lead_id: lead.id,
          to: lead.phone,
          type: "audio",
          media_url: data.audioUrl,
          audio_voice: true,
        }, `audio_send_failed:${node.id}`);
      }
      return {};
    }

    case "send_file": {
      const caption = replaceVars(data.caption || "");
      const fileType = data.fileType || "document";
      if (data.fileUrl && lead.phone) {
        await sendAndAssert({
          lead_id: lead.id,
          to: lead.phone,
          type: fileType,
          media_url: data.fileUrl,
          message: caption || undefined,
        }, `file_send_failed:${node.id}`);
      }
      return {};
    }

    case "send_video": {
      const caption = replaceVars(data.caption || "");
      if (data.videoUrl && lead.phone) {
        await sendAndAssert({
          lead_id: lead.id,
          to: lead.phone,
          type: "video",
          media_url: data.videoUrl,
          message: caption || undefined,
        }, `video_send_failed:${node.id}`);
      }
      return {};
    }

    case "delay": {
      // Legacy delay block — cap at 10s inline
      const amount = data.delaySeconds || 5;
      const unit = data.unit || "seconds";
      let ms = amount * 1000;
      if (unit === "minutes") ms = amount * 60 * 1000;
      if (unit === "hours") ms = amount * 3600 * 1000;
      const maxDelay = 10000;
      if (ms > maxDelay) ms = maxDelay;
      await new Promise((r) => setTimeout(r, ms));
      return {};
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
      if (lead.phone) {
        const menuBody = replaceVars(data.bodyText || data.body || data.text || "Escolha uma opção:");
        const buttons = data.buttons || [];
        const listSections = data.listSections || [];
        
        if (data.menuType === "list" && listSections.length > 0) {
          const waSections = listSections.map((s: any) => ({
            title: (s.title || "").slice(0, 24),
            rows: (s.rows || []).map((r: any) => ({
              id: r.id || String(Math.random()).slice(2, 10),
              title: (r.title || "").slice(0, 24),
              description: (r.description || "").slice(0, 72),
            })),
          }));
          await sendAndAssert({
            lead_id: lead.id,
            to: lead.phone,
            type: "interactive",
            interactive_type: "list",
            body: menuBody,
            header: data.headerText ? replaceVars(data.headerText) : undefined,
            footer: data.footerText ? replaceVars(data.footerText) : undefined,
            button_text: data.buttonLabel || "Ver opções",
            sections: waSections,
          }, `menu_list_send_failed:${node.id}`);
        } else if (buttons.length > 0) {
          await sendAndAssert({
            lead_id: lead.id,
            to: lead.phone,
            type: "interactive",
            interactive_type: "button",
            body: menuBody,
            buttons: buttons.slice(0, 3).map((b: any) => ({
              type: "reply",
              reply: { id: b.id, title: (b.title || "").slice(0, 20) },
            })),
          }, `menu_button_send_failed:${node.id}`);
        } else {
          await sendAndAssert({
            lead_id: lead.id,
            to: lead.phone,
            type: "text",
            message: menuBody,
          }, `menu_text_send_failed:${node.id}`);
        }
      }
      return { stop: true, status: "waiting_reply", reason: "waiting_menu_reply" };
    }

    case "transfer_human": {
      return { stop: true, status: "completed", reason: "transferred_to_human" };
    }

    case "trigger_bot": {
      if (data.botId) {
        // Complete current execution and start the new bot
        await supabase.from("bot_executions").update({
          status: "completed",
          completed_at: new Date().toISOString(),
          timeout_at: null,
        }).eq("id", executionId);

        await fetch(`${supabaseUrl}/functions/v1/bot-engine`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceKey}`,
            apikey: serviceKey,
          },
          body: JSON.stringify({
            leadId: lead.id,
            botId: data.botId,
            trigger: "automation",
          }),
        });

        return { stop: true, status: "completed", reason: "triggered_another_bot" };
      }
      return {};
    }

    default:
      return {};
  }
}
