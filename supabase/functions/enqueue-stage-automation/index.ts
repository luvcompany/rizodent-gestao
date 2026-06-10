import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type AppRole = "crc" | "gerente" | "posvenda" | "superadmin" | "crc_legacy";

const allowedManagerRoles = new Set<AppRole>(["crc", "gerente", "posvenda", "superadmin"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return json({ error: "Método não permitido" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return json({ error: "Usuário não autenticado" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const anon = createClient(supabaseUrl, anonKey);
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: userData, error: authError } = await anon.auth.getUser(token);
    if (authError || !userData.user) return json({ error: "Sessão inválida" }, 401);

    const body = await req.json().catch(() => ({}));
    const automationId = String(body.automation_id || "");
    const force = Boolean(body.force);
    if (!automationId) return json({ error: "Automação não informada" }, 400);
    console.log(`[enqueue-stage-automation] user=${userData.user.id} automation=${automationId} force=${force}`);


    const [{ data: profile }, { data: roleRow }] = await Promise.all([
      admin.from("profiles").select("tenant_id").eq("id", userData.user.id).maybeSingle(),
      admin.from("user_roles").select("role").eq("user_id", userData.user.id).maybeSingle(),
    ]);

    const role = roleRow?.role as AppRole | undefined;
    if (!role || !allowedManagerRoles.has(role)) {
      return json({ error: "Sem permissão para disparar automações" }, 403);
    }

    const { data: automation, error: autoError } = await admin
      .from("crm_automations")
      .select("id, stage_id, action_type, action_config, is_active, tenant_id")
      .eq("id", automationId)
      .maybeSingle();

    if (autoError) throw autoError;
    if (!automation) return json({ error: "Automação não encontrada" }, 404);
    if (!automation.is_active) return json({ error: "Automação inativa" }, 400);

    const actionType = String(automation.action_type || "");
    const actionConfig = (automation.action_config || {}) as Record<string, unknown>;
    if (!actionConfig.send_to_all_existing) {
      return json({ error: "A opção de enviar para todos não está marcada" }, 400);
    }
    if (actionType === "send_template" && !actionConfig.template_id) {
      return json({ error: "Selecione um template antes de disparar" }, 400);
    }
    if (actionType === "send_bot" && !actionConfig.bot_id) {
      return json({ error: "Selecione um bot antes de disparar" }, 400);
    }
    if (!actionType.startsWith("send_")) {
      return json({ error: "Somente disparos de mensagem podem ser enviados em massa" }, 400);
    }

    const { data: stage, error: stageError } = await admin
      .from("crm_stages")
      .select("id, pipeline_id, tenant_id")
      .eq("id", automation.stage_id)
      .maybeSingle();
    if (stageError) throw stageError;
    if (!stage) return json({ error: "Etapa não encontrada" }, 404);

    const { data: pipeline, error: pipelineError } = await admin
      .from("crm_pipelines")
      .select("id, tenant_id, allowed_roles")
      .eq("id", stage.pipeline_id)
      .maybeSingle();
    if (pipelineError) throw pipelineError;
    if (!pipeline) return json({ error: "Funil não encontrado" }, 404);

    const userTenantId = profile?.tenant_id as string | null | undefined;
    const pipelineTenantId = (pipeline as any).tenant_id as string | null | undefined;
    if (role !== "superadmin" && (!userTenantId || pipelineTenantId !== userTenantId)) {
      return json({ error: "Este funil não pertence ao seu cliente" }, 403);
    }

    const allowedRoles = ((pipeline as any).allowed_roles || []) as string[];
    if (role !== "superadmin" && allowedRoles.length > 0 && !allowedRoles.includes(role)) {
      return json({ error: "Seu perfil não tem acesso a este funil" }, 403);
    }

    const leads = await fetchAllLeads(admin, automation.stage_id, pipelineTenantId || userTenantId || null);
    const eligibleLeads = leads.filter((lead) => {
      const digits = String(lead.phone || "").replace(/\D/g, "");
      return digits.length >= 8;
    });

    if (eligibleLeads.length === 0) {
      return json({ success: true, inserted: 0, total_leads: leads.length, message: "Nenhum lead com telefone encontrado nesta etapa" });
    }

    let inserted = 0;
    const batchSize = 500;
    for (let i = 0; i < eligibleLeads.length; i += batchSize) {
      const rows = eligibleLeads.slice(i, i + batchSize).map((lead) => ({
        automation_id: automation.id,
        lead_id: lead.id,
        action_type: actionType,
        action_config: actionConfig,
        scheduled_at: new Date().toISOString(),
        status: "pending",
        layer_index: 0,
      }));
      const { data, error } = await admin.from("crm_automation_queue").insert(rows).select("id");
      if (error) throw error;
      inserted += data?.length || rows.length;
    }

    fetch(`${supabaseUrl}/functions/v1/automation-engine`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
      body: JSON.stringify({ pending_batch_limit: 500 }),
    }).catch((error) => console.error("[enqueue-stage-automation] automation-engine kick failed", error));

    return json({ success: true, inserted, total_leads: leads.length });
  } catch (error) {
    console.error("[enqueue-stage-automation] error", error);
    return json({ error: error instanceof Error ? error.message : "Erro ao enfileirar disparos" }, 500);
  }
});

async function fetchAllLeads(admin: any, stageId: string, tenantId: string | null) {
  const leads: Array<{ id: string; phone: string | null }> = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    let query = admin
      .from("crm_leads")
      .select("id, phone")
      .eq("stage_id", stageId)
      .range(from, from + pageSize - 1);
    if (tenantId) query = query.eq("tenant_id", tenantId);
    const { data, error } = await query;
    if (error) throw error;
    if (!data?.length) break;
    leads.push(...data);
    if (data.length < pageSize) break;
  }
  return leads;
}

function json(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}