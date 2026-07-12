// bot-engine v2 - skipMarkAsRead scope fix
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";
import { authorizeInternal, unauthorizedResponse } from "../_shared/internalAuth.ts";

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

// Extrai um nome de pessoa da resposta do lead usando Lovable AI.
// Retorna { name: string | null, confidence: "high"|"medium"|"low" }.
// Nunca lança erro — em caso de falha retorna { name: null, confidence: "low" }.
async function extractFullNameWithAI(
  raw: string | null | undefined,
): Promise<{ name: string | null; confidence: "high" | "medium" | "low" }> {
  const text = String(raw || "").normalize("NFKC").trim();
  if (!text) return { name: null, confidence: "low" };
  if (text.length > 240) return { name: null, confidence: "low" };

  const apiKey = Deno.env.get("LOVABLE_API_KEY") || "";
  if (!apiKey) {
    console.warn("[bot-engine] LOVABLE_API_KEY ausente — extração de nome desabilitada");
    return { name: null, confidence: "low" };
  }

  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          {
            role: "system",
            content:
              "Você extrai o NOME PRÓPRIO de uma pessoa a partir de uma mensagem em português (Brasil). " +
              "Responda SOMENTE com JSON válido no formato: " +
              `{"name": string|null, "confidence": "high"|"medium"|"low"}. ` +
              "Regras: (1) Se a mensagem contiver um nome de pessoa (ex.: \"Meu nome é João\", \"Sou a Ana Silva\", \"João\", \"Maria das Dores\"), retorne o nome com capitalização correta e confidence high se vier completo (nome + sobrenome) ou medium se for só primeiro nome. " +
              "(2) Se for uma pergunta, saudação, pedido de informação ou qualquer texto sem nome próprio (ex.: \"Olá\", \"Quero informações\", \"Quanto custa?\", \"Bom dia\"), retorne {\"name\": null, \"confidence\": \"low\"}. " +
              "(3) NUNCA invente nomes.",
          },
          { role: "user", content: text },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
      }),
    });

    if (!resp.ok) {
      console.warn(`[bot-engine] extractFullNameWithAI HTTP ${resp.status}`);
      return { name: null, confidence: "low" };
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);
    const name = typeof parsed?.name === "string" ? parsed.name.trim() : null;
    const confidence = ["high", "medium", "low"].includes(parsed?.confidence)
      ? parsed.confidence
      : "low";

    if (!name || name.length < 2 || name.length > 80) {
      return { name: null, confidence: "low" };
    }
    return { name, confidence };
  } catch (err) {
    console.warn("[bot-engine] extractFullNameWithAI error:", err);
    return { name: null, confidence: "low" };
  }
}

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

/** Detect canonical cidade / servico_interesse from an interactive reply text. */
function detectLeadFieldsFromReply(text: string): { cidade?: string; servico?: string } {
  const out: { cidade?: string; servico?: string } = {};
  if (!text) return out;
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (t.includes("itabuna")) out.cidade = "Itabuna";
  else if (t.includes("guanambi")) out.cidade = "Guanambi";
  else if (t.includes("ipiau")) out.cidade = "Ipiaú";
  else if (t.includes("vca") || t.includes("vitoria") || t.includes("conquista")) out.cidade = "Vitória da Conquista";

  if (t.includes("implante") || t.includes("zigomatic")) out.servico = "Implante";
  else if (t.includes("protese") || t.includes("protocolo") || t.includes("dentadura")) out.servico = "Prótese/Protocolo";
  else if (t.includes("faceta") || t.includes("lente")) out.servico = "Facetas/Lentes";
  else if (t.includes("clareamento")) out.servico = "Clareamento";
  else if (t.includes("aparelho") || t.includes("ortodont")) out.servico = "Ortodontia";
  else if (
    t.includes("limpeza") || t.includes("restaura") || t.includes("canal") ||
    t.includes("extra") || t.includes("dor") || t.includes("urgenc")
  ) out.servico = "Clínico Geral";

  return out;
}


// Compute due_date for a task created by the bot. Supports modes: hours, days,
// days_at_time, next_day_first, next_business_day, specific. All times use
// Brazil timezone (America/Sao_Paulo / UTC-3, no DST).
async function computeTaskDueDate(supabase: any, data: any): Promise<string> {
  const TZ_OFFSET_MIN = -180; // -03:00
  const mode = (data?.dueMode as string) || "hours";

  // Build a Date representing a given Y-M-D H:M in Brazil time, returned as UTC instant.
  const brtDate = (y: number, m: number, d: number, hh: number, mm: number) => {
    // Construct ISO string with explicit -03:00 offset
    const iso = `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}T${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}:00-03:00`;
    return new Date(iso);
  };

  // Get current Brazil-time Y/M/D
  const nowUtc = new Date();
  const nowBrt = new Date(nowUtc.getTime() + (TZ_OFFSET_MIN - nowUtc.getTimezoneOffset()) * 60000);
  const curY = nowBrt.getUTCFullYear();
  const curM = nowBrt.getUTCMonth() + 1;
  const curD = nowBrt.getUTCDate();

  const parseTime = (t: string | undefined, fallback: string) => {
    const [hh, mm] = (t || fallback).split(":").map((v) => parseInt(v, 10) || 0);
    return { hh, mm };
  };

  switch (mode) {
    case "days": {
      const days = Math.max(1, Number(data.dueDays) || 1);
      return new Date(Date.now() + days * 86400000).toISOString();
    }
    case "days_at_time": {
      const days = Math.max(1, Number(data.dueDays) || 1);
      const { hh, mm } = parseTime(data.dueTime, "09:00");
      const target = brtDate(curY, curM, curD + days, hh, mm);
      return target.toISOString();
    }
    case "next_day_first": {
      const { hh, mm } = parseTime(data.dueTime, "08:00");
      return brtDate(curY, curM, curD + 1, hh, mm).toISOString();
    }
    case "next_business_day": {
      const { hh, mm } = parseTime(data.dueTime, "09:00");
      // Load holidays once (date strings)
      const { data: holidays } = await supabase
        .from("dashboard_holidays")
        .select("data");
      const holidaySet = new Set<string>((holidays || []).map((h: any) => h.data));
      // Walk forward from tomorrow until we find a weekday that's not a holiday
      let offset = 1;
      while (offset < 30) {
        const candidate = brtDate(curY, curM, curD + offset, hh, mm);
        const candidateBrt = new Date(candidate.getTime() - 3 * 3600000); // shift to BRT components
        const dow = candidateBrt.getUTCDay(); // 0=Sun, 6=Sat
        const ymd = `${candidateBrt.getUTCFullYear()}-${String(candidateBrt.getUTCMonth()+1).padStart(2,"0")}-${String(candidateBrt.getUTCDate()).padStart(2,"0")}`;
        if (dow !== 0 && dow !== 6 && !holidaySet.has(ymd)) {
          return candidate.toISOString();
        }
        offset++;
      }
      // Fallback: 1 day from now
      return new Date(Date.now() + 86400000).toISOString();
    }
    case "specific": {
      if (data.dueDate) {
        const { hh, mm } = parseTime(data.dueTime, "09:00");
        const [y, m, d] = String(data.dueDate).split("-").map((v) => parseInt(v, 10));
        return brtDate(y, m, d, hh, mm).toISOString();
      }
      return new Date(Date.now() + 86400000).toISOString();
    }
    case "hours":
    default: {
      const hours = Number(data.dueHours) || 24;
      return new Date(Date.now() + hours * 3600000).toISOString();
    }
  }
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

    // Real auth: accept internal service-role calls OR a valid logged-in user JWT.
    // (Frontend invokes via supabase.functions.invoke which forwards the user's JWT.)
    const auth = await authorizeInternal(req, supabase, { allowUserJwt: true });
    if (!auth.ok) {
      console.warn("[bot-engine] Unauthorized");
      return unauthorizedResponse(corsHeaders);
    }

    // authHeader used for downstream service calls (send-whatsapp-message, etc.)
    const authHeader = req.headers.get("Authorization") || `Bearer ${serviceKey}`;

    const body = await req.json();
    const { leadId, botId, trigger, executionId, replyText, replyOptionId } = body;

    if (!leadId || !trigger) {
      return json({ error: "Missing leadId or trigger" }, 400);
    }

    // ===== MANUAL START or AUTOMATION =====
    if (trigger === "manual_start" || trigger === "automation" || trigger === "automation_bulk") {
      if (!botId) return json({ error: "Missing botId" }, 400);

      // For automation triggers (stage on_enter/on_create_or_enter, etc.), do NOT
      // restart a bot that is already mid-flow for this same lead+bot. Otherwise a
      // multi-step follow-up gets cancelled at msg1 every time the lead's stage
      // re-fires the automation, and only the first message ever gets sent.
      // Manual starts (user clicked) keep the previous "restart" behaviour.
      //
      // BUT: if an execution looks STUCK (active for > 10min, or waiting_reply
      // without a timeout, or with timeout long expired and never picked up by
      // the cron), we cancel it and restart fresh. Without this watchdog, a
      // single failure leaves the lead unable to ever receive this bot again.
      if (trigger === "automation" || trigger === "automation_bulk") {
        const { data: existingForBot } = await supabase
          .from("bot_executions")
          .select("id, status, started_at, timeout_at, updated_at")
          .eq("lead_id", leadId)
          .eq("bot_id", botId)
          .in("status", ["active", "waiting_reply"])
          .order("started_at", { ascending: false })
          .limit(1);

        if (existingForBot && existingForBot.length > 0) {
          const exec: any = existingForBot[0];
          const now = Date.now();
          const startedMs = new Date(exec.started_at).getTime();
          const updatedMs = exec.updated_at ? new Date(exec.updated_at).getTime() : startedMs;
          const ageMin = (now - startedMs) / 60000;
          const idleMin = (now - updatedMs) / 60000;
          const timeoutExpiredHoursAgo = exec.timeout_at
            ? (now - new Date(exec.timeout_at).getTime()) / 3600000
            : 0;

          const isStuck =
            (exec.status === "active" && idleMin > 10) ||
            (exec.status === "waiting_reply" && !exec.timeout_at && ageMin > 60 * 24 * 7) ||
            (exec.status === "waiting_reply" && exec.timeout_at && timeoutExpiredHoursAgo > 1);

          if (!isStuck) {
            console.log(`[bot-engine] Skipping automation start: bot ${botId} already running for lead ${leadId} (execution ${exec.id}, status=${exec.status}, ageMin=${ageMin.toFixed(1)})`);
            return json({ success: true, skipped: true, reason: "already_running", executionId: exec.id });
          }

          console.log(`[bot-engine] Detected STUCK execution ${exec.id} for lead ${leadId} bot ${botId} (status=${exec.status}, ageMin=${ageMin.toFixed(1)}, idleMin=${idleMin.toFixed(1)}, timeoutExpiredHoursAgo=${timeoutExpiredHoursAgo.toFixed(1)}). Cancelling and starting fresh.`);
          await supabase
            .from("bot_executions")
            .update({ status: "error", completed_at: new Date().toISOString(), timeout_at: null })
            .eq("id", exec.id);
        }
      }

      // Cancel any active executions for this lead (different bots, or manual restart)
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
        .select("*, bots(flow_json, current_version, mark_as_read)")
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

      // Input validation (ex: nome completo). Se falhar, re-pergunta e mantém waiting_reply
      // até esgotar tentativas. Aplica só quando NÃO é interação com botão/menu.
      const validateAs = currentNode?.data?.validateAs as string | undefined;
      const isInteractiveReply = !!replyOptionId
        || (currentNode && (currentNode.type === "send_text" || currentNode.type === "send_menu"));
      if (validateAs && validateAs !== "none" && !isInteractiveReply) {
        let valid = true;
        if (validateAs === "full_name") valid = isLikelyFullName(replyText);

        if (!valid) {
          const attemptsKey = `__invalid_attempts_${execution.current_node_id}`;
          const attempts = Number((variables as any)[attemptsKey] || 0) + 1;
          const MAX_ATTEMPTS = 2;

          if (attempts <= MAX_ATTEMPTS) {
            const promptMsg =
              (currentNode?.data?.invalidReplyMessage as string) ||
              "Só pra confirmar, me diga seu nome completo (nome e sobrenome), por favor 🙂";
            if (lead?.phone) {
              const skipMark = (execution as any).bots?.mark_as_read === false;
              await sendViaWhatsApp(supabaseUrl, serviceKey, authHeader, {
                lead_id: leadId,
                to: lead.phone,
                type: "text",
                message: promptMsg,
              }, skipMark);
            }
            const newTimeoutAt = calculateTimeoutAt(currentNode?.data);
            (variables as any)[attemptsKey] = attempts;
            await supabase.from("bot_executions").update({
              status: "waiting_reply",
              variables,
              timeout_at: newTimeoutAt,
            }).eq("id", execution.id);
            console.log(`[bot-engine] Invalid ${validateAs} (attempt ${attempts}/${MAX_ATTEMPTS}) at node ${execution.current_node_id}, re-prompted`);
            return json({ success: true, waiting: true, reason: "re_prompted_invalid_reply" });
          }

          // Excedeu tentativas: encerra a execução para intervenção humana
          console.log(`[bot-engine] Invalid ${validateAs} exhausted at node ${execution.current_node_id}, completing`);
          await supabase.from("bot_executions").update({
            status: "completed",
            completed_at: new Date().toISOString(),
            timeout_at: null,
          }).eq("id", execution.id);
          return json({ completed: true, reason: `${validateAs}_validation_exhausted` });
        }
      }

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
            const skipMark = (execution as any).bots?.mark_as_read === false;
            await sendViaWhatsApp(supabaseUrl, serviceKey, authHeader, {
              lead_id: leadId,
              to: lead.phone,
              type: "text",
              message: "Por favor, selecione uma das opções do menu acima. 👆",
            }, skipMark);
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

      // Auto-persist cidade / servico_interesse detected from interactive reply
      try {
        const detected = detectLeadFieldsFromReply(replyValue || replyText || "");
        if (detected.cidade || detected.servico) {
          const { data: leadCur } = await supabase
            .from("crm_leads")
            .select("cidade, servico_interesse")
            .eq("id", leadId)
            .single();
          const updates: Record<string, string> = {};
          if (detected.cidade && !leadCur?.cidade) updates.cidade = detected.cidade;
          if (detected.servico && !leadCur?.servico_interesse) updates.servico_interesse = detected.servico;
          if (Object.keys(updates).length > 0) {
            await supabase.from("crm_leads").update(updates).eq("id", leadId);
            console.log(`[BOT] lead ${leadId} ${Object.entries(updates).map(([k, v]) => `${k}=${v}`).join(" ")}`);
          }
        }
      } catch (e) {
        console.error("[bot-engine] detectLeadFieldsFromReply error", e);
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
  payload: Record<string, any>,
  skipMarkAsRead: boolean = false,
) {
  const url = `${supabaseUrl}/functions/v1/send-whatsapp-message`;
  try {
    const finalPayload = skipMarkAsRead ? { ...payload, skip_mark_as_read: true } : payload;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
        apikey: serviceKey,
      },
      body: JSON.stringify(finalPayload),
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

// ===== Send message via the instagram-send-message edge (canal Instagram) =====
// Recebe o MESMO payload dos nós (type/message/media_url/interactive) e traduz
// para a API do instagram-send-message. IG DM não tem lista/botão nativo aqui,
// então menus (type=interactive) são renderizados como texto numerado.
async function sendViaInstagram(
  supabaseUrl: string,
  serviceKey: string,
  authHeader: string,
  leadId: string,
  payload: Record<string, any>,
) {
  const url = `${supabaseUrl}/functions/v1/instagram-send-message`;
  const type = payload.type;
  let body: Record<string, any> | null = null;

  if (type === "image" || type === "video" || type === "audio") {
    if (!payload.media_url) return {};
    body = { lead_id: leadId, message_type: type, media_url: payload.media_url, message: payload.message || undefined };
  } else if (type === "interactive") {
    const lines: string[] = [];
    if (payload.header) lines.push(String(payload.header));
    if (payload.body) lines.push(String(payload.body));
    const opts: string[] = [];
    (payload.sections || []).forEach((s: any) => (s.rows || []).forEach((r: any) => opts.push(r.title || "")));
    (payload.buttons || []).forEach((b: any) => opts.push(b.reply?.title || b.title || ""));
    opts.filter(Boolean).forEach((o, i) => lines.push(`${i + 1}. ${o}`));
    if (payload.footer) lines.push(String(payload.footer));
    const msg = lines.filter(Boolean).join("\n");
    if (!msg) return {};
    body = { lead_id: leadId, message: msg, message_type: "dm" };
  } else {
    // text, template (fallback de texto) e demais com conteúdo textual
    const msg = payload.message || payload.text || payload.body || "";
    if (!msg) return {};
    body = { lead_id: leadId, message: String(msg), message_type: "dm" };
  }

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader, apikey: serviceKey },
      body: JSON.stringify(body),
    });
    const result = await resp.json();
    if (!resp.ok) {
      console.error("instagram-send-message error:", JSON.stringify(result));
      return { error: result?.error || "instagram_send_failed", details: result };
    }
    return result;
  } catch (err: any) {
    console.error("instagram-send-message call error:", err);
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

  // Resolve bot's "mark as read" preference. When false, outbound messages do
  // NOT bump last_outbound_at, so the conversation keeps appearing as
  // "aguardando resposta" in the CRM lists.
  const { data: execRow } = await supabase
    .from("bot_executions")
    .select("bot_id")
    .eq("id", executionId)
    .single();
  const { data: botRow } = execRow?.bot_id
    ? await supabase.from("bots").select("mark_as_read, channels").eq("id", execRow.bot_id).single()
    : { data: null } as any;
  const skipMarkAsRead = botRow ? botRow.mark_as_read === false : false;

  // Canal do lead + gate por bot.channels (escolha de canal por bot). WhatsApp = tem
  // phone; Instagram = tem instagram_user_id. Se o bot não roda no canal do lead, não
  // executa (default '{whatsapp}' preserva os bots atuais).
  const leadChannel = (lead as any).instagram_user_id ? "instagram" : "whatsapp";
  const botChannels: string[] = Array.isArray((botRow as any)?.channels) && (botRow as any).channels.length
    ? (botRow as any).channels
    : ["whatsapp"];
  if (!botChannels.includes(leadChannel)) {
    await supabase.from("bot_executions")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", executionId);
    return { reason: `channel_not_enabled:${leadChannel}` };
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
      result = await executeNode(supabase, supabaseUrl, serviceKey, authHeader, node, lead, vars, executionId, skipMarkAsRead);
    } catch (error: any) {
      console.error(`[bot-engine] Node execution failed at ${currentNodeId}:`, error?.message || error);
      // Instead of killing the bot, try to follow the timeout edge to continue the flow
      const timeoutEdge = edges.find(
        (e: any) => e.source === currentNodeId && (e.sourceHandle === "timeout" || e.sourceHandle === "no-response")
      );
      if (timeoutEdge) {
        console.log(`[bot-engine] Node ${currentNodeId} failed but has timeout edge, scheduling timeout fallback`);
        const timeoutAt = calculateTimeoutAt(node.data) || new Date(Date.now() + 60000).toISOString();
        await supabase.from("bot_executions").update({
          status: "waiting_reply",
          current_node_id: currentNodeId,
          variables: vars,
          timeout_at: timeoutAt,
        }).eq("id", executionId);
        return { stopped_at: currentNodeId, reason: "node_failed_waiting_timeout" };
      }
      // No timeout edge — mark as error
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
      // Fallback: if node continued (no stop) but only has a "reply" edge,
      // treat it as the continuation edge (covers send_text/menu nodes connected
      // straight to the next action via the green "Resposta" handle).
      if (!nextNodeId) {
        const replyEdge = edges.find((e: any) => e.source === currentNodeId && e.sourceHandle === "reply");
        if (replyEdge) {
          console.log(`[bot-engine] No default edge from ${currentNodeId}, falling back to reply edge -> ${replyEdge.target}`);
          nextNodeId = replyEdge.target;
        }
      }
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
  executionId: string,
  skipMarkAsRead: boolean = false
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
    const result = lead.instagram_user_id
      ? await sendViaInstagram(supabaseUrl, serviceKey, authHeader, lead.id, payload)
      : await sendViaWhatsApp(supabaseUrl, serviceKey, authHeader, payload, skipMarkAsRead);
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
          .select("name, language, body_text, header_content, header_type")
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

        // Build template components — handle IMAGE/VIDEO/DOCUMENT headers specially
        const headerType = (tplRow?.header_type || "").toUpperCase();
        const templateComponents: any[] = [];

        if (headerType === "IMAGE" && tplRow?.header_content) {
          templateComponents.push({
            type: "header",
            parameters: [{ type: "image", image: { link: tplRow.header_content } }],
          });
        } else if (headerType === "VIDEO" && tplRow?.header_content) {
          templateComponents.push({
            type: "header",
            parameters: [{ type: "video", video: { link: tplRow.header_content } }],
          });
        } else if (headerType === "DOCUMENT" && tplRow?.header_content) {
          templateComponents.push({
            type: "header",
            parameters: [{ type: "document", document: { link: tplRow.header_content } }],
          });
        } else {
          const headerComp = buildTemplateComponent("header", tplRow?.header_content);
          if (headerComp) templateComponents.push(headerComp);
        }

        const bodyComp = buildTemplateComponent("body", tplRow?.body_text || data.text);
        if (bodyComp) templateComponents.push(bodyComp);

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
      if (text && (lead.phone || lead.instagram_user_id)) {
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
      if (data.imageUrl && (lead.phone || lead.instagram_user_id)) {
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
      if (data.audioUrl && (lead.phone || lead.instagram_user_id)) {
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
      if (data.videoUrl && (lead.phone || lead.instagram_user_id)) {
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
        const dueDate = await computeTaskDueDate(supabase, data);
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
      if (lead.phone || lead.instagram_user_id) {
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
