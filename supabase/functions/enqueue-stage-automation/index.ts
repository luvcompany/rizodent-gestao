import { createClient } from "npm:@supabase/supabase-js@2";
import { evaluateConditions, type ConditionsConfig } from "../_shared/automationConditions.ts";
import { filtrarMundo, numeroDoFunil } from "../_shared/mundoNumero.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type AppRole = "crc" | "gerente" | "posvenda" | "superadmin" | "crc_legacy" | "sdr";

const allowedManagerRoles = new Set<AppRole>(["crc", "gerente", "posvenda", "superadmin"]);
// Pedido do dono (10/09/2026): "o sdr também deve poder criar etapas, gatilhos,
// disparos e funis". A SDR criava a automação, clicava em Executar e tomava 403 —
// a tela abria e o recurso não funcionava. Agora ela dispara, MAS o disparo dela
// alcança SOMENTE os leads dos quais ela é a responsável (assigned_to), e só em
// etapa visível para a SDR. Sem essas duas travas o botão dela mandaria template
// para os leads das colegas — o acidente das 46 pessoas — e o total devolvido
// contaria leads na etapa "Contratado", que ela nunca pode ler.
const allowedDispatchRoles = new Set<AppRole>([...allowedManagerRoles, "sdr"]);
// Ordem = alcance. 'sdr' é a ÚLTIMA: quem acumula sdr + papel de gestão continua
// disparando como gestão (sem recorte), igual ao comportamento de hoje.
const rolePriority: AppRole[] = ["superadmin", "gerente", "crc", "posvenda", "sdr"];

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


    // user_roles pode ter MAIS DE UMA linha por usuário: com maybeSingle() a
    // consulta voltava vazia e um gerente legítimo era barrado (ou um papel
    // secundário era ignorado). Lê todos os papéis e usa o de maior alcance.
    const [{ data: profile }, { data: roleRows }] = await Promise.all([
      admin.from("profiles").select("tenant_id").eq("id", userData.user.id).maybeSingle(),
      admin.from("user_roles").select("role").eq("user_id", userData.user.id),
    ]);

    const roles = ((roleRows || []) as Array<{ role: AppRole }>).map((r) => r.role);
    const role = rolePriority.find((r) => roles.includes(r));
    if (!role || !allowedDispatchRoles.has(role)) {
      return json({ error: "Sem permissão para disparar automações" }, 403);
    }
    // As duas policies RESTRICTIVE que definem o mundo da SDR
    // (sdr_escopo_crm_leads_select e sdr_escopo_crm_stages_visiveis) são
    // "NOT has_role(sdr) OR ...": quem CARREGA o papel sdr só lê os leads dela e
    // só vê etapa visível — acumule ela papéis ou não. Esta function busca lead
    // com service_role, que ignora RLS, então o recorte tem de ser reproduzido
    // aqui pelo mesmo critério: carregar o papel sdr. Se valesse só para a "sdr
    // pura", uma SDR que também é gerente dispararia template para leads que a
    // tela dela nem mostra — o acidente das 46 pessoas de novo.
    const carregaPapelSdr = roles.includes("sdr");
    // Funil de pós-venda é do administrador: barra só a SDR sem papel de gestão
    // (rolePriority já teria escolhido o papel de gestão), para não tirar de um
    // posvenda/gerente o disparo no funil que é o trabalho dele.
    const ehSdrSemGestao = role === "sdr";

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
    if (!force && !actionConfig.send_to_all_existing) {
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
      .select("id, pipeline_id, tenant_id, visivel_para_sdr")
      .eq("id", automation.stage_id)
      .maybeSingle();
    if (stageError) throw stageError;
    if (!stage) return json({ error: "Etapa não encontrada" }, 404);

    const { data: pipeline, error: pipelineError } = await admin
      .from("crm_pipelines")
      .select("id, tenant_id, allowed_roles, is_posvenda")
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
    if (role !== "superadmin" && allowedRoles.length > 0 && !roles.some((r) => allowedRoles.includes(r))) {
      return json({ error: "Seu perfil não tem acesso a este funil" }, 403);
    }

    if (carregaPapelSdr) {
      // A coluna visivel_para_sdr é a trava do isolamento dela: a SELECT de
      // crm_automations é do cliente inteiro, então ela CONSEGUE o id de uma
      // automação pendurada em "Contratado"/"Não contratado". Sem este teste o
      // disparo mandaria mensagem para lead já fechado e o total_leads da
      // resposta contaria quantos leads dela contrataram — exatamente o que o
      // dono disse que a SDR nunca pode ler.
      if ((stage as any).visivel_para_sdr !== true) {
        console.warn(`[enqueue-stage-automation] BLOQUEADO sdr=${userData.user.id} etapa oculta stage=${automation.stage_id}`);
        return json({ error: "Sem permissão para disparar automações nesta etapa" }, 403);
      }
      // Funil de pós-venda é do administrador (mesmo recorte de
      // sdr_pode_editar_funil, que exige is_posvenda = false).
      if (ehSdrSemGestao && (pipeline as any).is_posvenda === true) {
        console.warn(`[enqueue-stage-automation] BLOQUEADO sdr=${userData.user.id} funil de pós-venda pipeline=${stage.pipeline_id}`);
        return json({ error: "Sem permissão para disparar automações neste funil" }, 403);
      }
    }

    const tenantParaLeads = pipelineTenantId || userTenantId || null;
    // Mundo do funil: o disparo em massa só alcança leads do número daquele funil
    // (leads do mundo legado ficam de fora quando o funil é de um número próprio).
    const numeroDoMundo = await numeroDoFunil(admin, (stage as any).pipeline_id ?? null, tenantParaLeads);
    // Recorte por dono: a busca roda com service_role (ignora RLS), então o
    // filtro TEM de ir dentro da consulta paginada — filtrar depois já teria
    // lido (e paginado sobre) os leads das colegas.
    const somenteDoResponsavel = carregaPapelSdr ? userData.user.id : null;
    const leads = await fetchAllLeads(admin, automation.stage_id, tenantParaLeads, numeroDoMundo, somenteDoResponsavel);
    const conditions = (actionConfig.conditions as ConditionsConfig | undefined) || undefined;
    const hasConditions = !!(conditions && Array.isArray(conditions.rules) && conditions.rules.length > 0);
    const eligibleLeads = leads.filter((lead) => {
      const digits = String(lead.phone || "").replace(/\D/g, "");
      if (digits.length < 8) return false;
      if (hasConditions && !evaluateConditions(conditions!, lead as any)) return false;
      return true;
    });

    const escopoLog = somenteDoResponsavel ? `apenas_meus(${somenteDoResponsavel})` : "toda_a_etapa";
    console.log(`[enqueue-stage-automation] role=${role} papeis=${roles.join(",") || "-"} escopo=${escopoLog} total=${leads.length} eligible=${eligibleLeads.length} hasConditions=${hasConditions}`);

    if (eligibleLeads.length === 0) {
      const semLead = somenteDoResponsavel
        ? "Nenhum lead seu com telefone válido nesta etapa"
        : "Nenhum lead com telefone encontrado nesta etapa";
      console.log(`[enqueue-stage-automation] DONE automation=${automationId} role=${role} escopo=${escopoLog} alcancados=0 inserted=0`);
      return json({ success: true, inserted: 0, total_leads: leads.length, message: hasConditions ? "Nenhum lead atende às condições configuradas" : semLead });
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

    // Auditoria: quantos leads o disparo alcançou e sob qual papel/recorte.
    console.log(`[enqueue-stage-automation] DONE automation=${automationId} role=${role} escopo=${escopoLog} alcancados=${eligibleLeads.length} inserted=${inserted}/${leads.length}`);
    return json({ success: true, inserted, total_leads: leads.length });
  } catch (error) {
    console.error("[enqueue-stage-automation] error", error);
    return json({ error: error instanceof Error ? error.message : "Erro ao enfileirar disparos" }, 500);
  }
});

async function fetchAllLeads(
  admin: any,
  stageId: string,
  tenantId: string | null,
  numberId: string | null,
  /** Quando preenchido, só leads deste responsável entram (recorte da SDR). */
  assignedTo: string | null = null,
) {
  const leads: Array<Record<string, any>> = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    let query = admin
      .from("crm_leads")
      .select("id, phone, tags, source, cidade, ad_id, ad_account_id, ad_account_name, nome_anuncio, servico_interesse, assigned_to, value")
      .eq("stage_id", stageId)
      // Leads bloqueados ou com automações pausadas nunca entram na fila.
      .eq("is_blocked", false)
      .not("automation_paused", "is", true)
      .range(from, from + pageSize - 1);
    query = filtrarMundo(query, numberId);
    if (tenantId) query = query.eq("tenant_id", tenantId);
    // Recorte por dono do lead: aplicado NA consulta (e em toda página), não
    // depois — é o que impede o disparo da SDR de sair para lead de colega.
    if (assignedTo) query = query.eq("assigned_to", assignedTo);
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