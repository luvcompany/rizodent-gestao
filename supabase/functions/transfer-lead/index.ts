import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";
import { resolveCaller, assertLeadInTenant, assertNumberAccess } from "../_shared/authz.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Gate central: mesma checagem de tenant/papel usada nas outras functions.
    const ctx = await resolveCaller(req, supabase);
    if (!ctx.ok) return json({ error: ctx.error }, ctx.status);
    if (!ctx.userId) return json({ error: "Chamada de usuário obrigatória" }, 401);
    const user = { id: ctx.userId };

    const { leadId, newUserId } = await req.json();

    if (!leadId || !newUserId) {
      return json({ error: "leadId and newUserId are required" }, 400);
    }

    const leadCheck = await assertLeadInTenant(supabase, leadId, ctx);
    if (!leadCheck.ok) return json({ error: leadCheck.error }, leadCheck.status);

    const [{ data: lead }, { data: roleRows }] = await Promise.all([
      supabase.from("crm_leads").select("id, name, phone, assigned_to, tenant_id, pipeline_id, stage_id, whatsapp_number_id").eq("id", leadId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", user.id),
    ]);

    if (!lead) return json({ error: "Lead not found" }, 404);

    // Papéis do CHAMADOR. A leitura virou lista (antes era um maybeSingle) para
    // reconhecer 'sdr' — mas quem DECIDE privilégio continua sendo
    // `callerRoleRow`, que reproduz exatamente o maybeSingle antigo (1 papel = a
    // linha; 0 ou 2+ papéis = null, porque o maybeSingle devolvia PGRST116).
    // Sem isso, um usuário com 2 papéis que hoje NÃO é privilegiado passaria a
    // ser — alargamento silencioso de uma checagem de permissão dentro do
    // próprio diff. (Hoje ninguém tem 2 papéis em produção; a regra da fase é
    // que nenhum papel existente passe a poder mais.)
    const callerRolesArr = ((roleRows || []) as any[]).map((r) => String(r.role));
    const callerRoles = new Set<string>(callerRolesArr);
    const callerRoleRow = callerRolesArr.length === 1 ? { role: callerRolesArr[0] } : null;
    const isSuperadmin = ctx.isSuperadmin || callerRoleRow?.role === "superadmin";
    const isPrivileged = callerRoleRow?.role === "crc" || callerRoleRow?.role === "gerente" || callerRoleRow?.role === "posvenda" || isSuperadmin;

    // Papéis do NOVO responsável, lidos em lista (antes era um maybeSingle mais
    // abaixo). A lista é o que permite reconhecer 'sdr'/'posvenda' mesmo em
    // usuário com mais de um papel; `targetRoleRow` reproduz exatamente o
    // resultado do maybeSingle antigo (1 papel = a linha; 0 ou 2+ = null), para
    // os ramos posvenda/crc adiante continuarem se comportando como hoje.
    const { data: targetRoleRows } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", newUserId);
    const targetRoles = ((targetRoleRows || []) as any[]).map((r) => String(r.role));
    const targetIsSdr = targetRoles.includes("sdr");
    const targetIsPosvenda = targetRoles.includes("posvenda");
    const targetRoleRow = targetRoles.length === 1 ? { role: targetRoles[0] } : null;

    // Rodízio de SDRs (Fase 1): a SDR não transfere lead — nem "puxa" lead sem
    // dona, nem repassa o dela para uma colega. Esta function roda com service
    // role (auth.uid() NULL), então a RESTRICTIVE sdr_escopo_crm_leads_update e
    // o gatilho trg_sdr_nao_transfere_lead não a alcançam: o bloqueio tem de
    // ser aqui. Mesma mensagem do gatilho.
    // EXCEÇÃO (decisão do dono): ela PODE encaminhar o lead DELA para a
    // pós-venda — é o caminho do lead fechado. Qualquer outro destino, ou lead
    // que não é dela, continua 403.
    if (!isPrivileged && callerRoles.has("sdr")) {
      const donaDoLead = (lead as any).assigned_to === user.id;
      if (!donaDoLead || !targetIsPosvenda) {
        return json({ error: "SDR não transfere lead" }, 403);
      }
    }

    // Visibilidade por número (papel recepcao).
    const numberCheck = await assertNumberAccess(req, (lead as any).whatsapp_number_id ?? null, ctx, leadId);
    if (!numberCheck.ok) return json({ error: numberCheck.error }, numberCheck.status);

    const requesterTenant = ctx.tenantId;
    if (!isSuperadmin) {
      const { data: targetProfile } = await supabase
        .from("profiles").select("tenant_id").eq("id", newUserId).maybeSingle();
      if (!targetProfile || (targetProfile as any).tenant_id !== requesterTenant) {
        return json({ error: "Target user not in your tenant" }, 403);
      }
    }

    // Alvo SDR: o mundo dela é o número principal — whatsapp_number_id NULL
    // (mundo legado, caso Rizodent hoje) ou a linha is_default do cliente, o
    // mesmo critério de concede_numeros_ao_novo_usuario. Lead carimbado com o
    // número de um closer/recepção ficaria atribuído a ela e INVISÍVEL (a RLS
    // por número negaria a leitura): recusa clara em vez de sumiço silencioso.
    if (targetIsSdr) {
      const numeroDoLead = (lead as any).whatsapp_number_id ?? null;
      if (numeroDoLead) {
        const { data: numero } = await supabase
          .from("whatsapp_numbers")
          .select("id, is_default, is_active")
          .eq("id", numeroDoLead)
          .eq("tenant_id", (lead as any).tenant_id)
          .maybeSingle();
        if (!(numero as any)?.is_default || !(numero as any)?.is_active) {
          return json({
            error: "Este lead é de outro número de WhatsApp; a SDR só atende o número principal da clínica.",
          }, 400);
        }
      }
    }

    // Demais papéis (closer/recepção): comportamento de sempre — o próprio lead
    // ou lead sem dona no mundo deles.
    const canTransfer = isPrivileged || lead.assigned_to === user.id || lead.assigned_to === null;
    if (!canTransfer) return json({ error: "Forbidden" }, 403);

    const oldUserId = lead.assigned_to;
    // Fetch profiles for all relevant users (old owner, requester, new owner)
    const profileIds = [user.id, newUserId, oldUserId].filter(Boolean) as string[];
    const { data: profiles } = await supabase.from("profiles").select("id, nome").in("id", profileIds);

    const oldUserName = profiles?.find((p) => p.id === oldUserId)?.nome || "Não atribuído";
    const newUserName = profiles?.find((p) => p.id === newUserId)?.nome || "Responsável";

    // If target user is posvenda, auto-move lead to first stage of a pipeline accessible to posvenda
    const agora = new Date().toISOString();
    const updatePayload: Record<string, unknown> = {
      assigned_to: newUserId,
      updated_at: agora,
      // Rodízio: distribuido_em é "quando o rodízio (ou o gestor) entregou o
      // lead à dona" e alimenta o "leads de hoje" da aba Equipe — por isso só
      // é carimbado quando o NOVO responsável é SDR. Transferência para
      // crc/gerente/pós-venda/closer/recepção grava o payload de sempre, sem
      // tocar na coluna.
      ...(targetIsSdr ? { distribuido_em: agora } : {}),
    };
    let movedPipelineName: string | null = null;
    let movedStageName: string | null = null;

    if (targetRoleRow?.role === "posvenda") {
      // Hard rule: only leads in a "Contratado" stage can be sent to Pós-venda.
      const { data: currentStage } = await supabase
        .from("crm_stages").select("name").eq("id", (lead as any).stage_id).maybeSingle();
      const stageName = (currentStage as any)?.name || "";
      const isContracted = /contrat/i.test(stageName) && !/n[ãa]o\s*contrat/i.test(stageName);
      if (!isContracted) {
        return json({ error: "Apenas leads na etapa 'Contratado' podem ser enviados para o Pós-venda." }, 400);
      }

      // Find a pipeline that explicitly allows posvenda (within the lead's tenant when possible)
      const { data: pipelines } = await supabase
        .from("crm_pipelines")
        .select("id, name, allowed_roles, tenant_id")
        .eq("tenant_id", (lead as any).tenant_id)
        .contains("allowed_roles", ["posvenda"]);

      // Sem funil de pós-venda NO TENANT do lead: apenas troca de responsável.
      // (Nunca cair no funil de outro tenant.)
      const pipeline = pipelines?.[0] || null;

      if (pipeline) {
        const { data: firstStage } = await supabase
          .from("crm_stages")
          .select("id, name")
          .eq("pipeline_id", pipeline.id)
          .order("position", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (firstStage) {
          updatePayload.pipeline_id = pipeline.id;
          updatePayload.stage_id = firstStage.id;
          movedPipelineName = (pipeline as any).name;
          movedStageName = (firstStage as any).name;
        }
      }
    } else if (targetRoleRow?.role === "crc" || targetRoleRow?.role === "gerente") {
      // Reverse flow: if lead is currently in a pipeline restricted to posvenda,
      // restore it to the last stage it occupied in a CRC-accessible pipeline.
      const { data: currentPipeline } = await supabase
        .from("crm_pipelines")
        .select("id, allowed_roles")
        .eq("id", (lead as any).pipeline_id)
        .maybeSingle();

      const isPosvendaOnly =
        Array.isArray((currentPipeline as any)?.allowed_roles) &&
        (currentPipeline as any).allowed_roles.length > 0 &&
        (currentPipeline as any).allowed_roles.every((r: string) => r === "posvenda");

      if (isPosvendaOnly) {
        const { data: crcPipelines } = await supabase
          .from("crm_pipelines")
          .select("id, name, allowed_roles, tenant_id")
          .eq("tenant_id", (lead as any).tenant_id);

        const allowedIds = (crcPipelines || [])
          .filter((p: any) => {
            const ar = p.allowed_roles;
            return !ar || ar.length === 0 || ar.includes("crc") || ar.includes("gerente");
          })
          .map((p: any) => p.id);

        let targetPipelineId: string | null = null;
        let targetStageId: string | null = null;
        let targetPipelineName: string | null = null;
        let targetStageName: string | null = null;

        if (allowedIds.length) {
          // Get all stages belonging to CRC-accessible pipelines, then find the
          // most recent stage_history entry whose stage_id is in that set.
          // (Avoid !inner FK syntax which can silently return 0 rows and force
          // the fallback to "Novo Lead".)
          const { data: allowedStages } = await supabase
            .from("crm_stages")
            .select("id, name, pipeline_id")
            .in("pipeline_id", allowedIds);
          const stageMap = new Map<string, { name: string; pipeline_id: string }>();
          (allowedStages || []).forEach((s: any) => stageMap.set(s.id, { name: s.name, pipeline_id: s.pipeline_id }));
          const allowedStageIds = Array.from(stageMap.keys());

          if (allowedStageIds.length) {
            const { data: history } = await supabase
              .from("crm_lead_stage_history")
              .select("stage_id, entered_at")
              .eq("lead_id", leadId)
              .in("stage_id", allowedStageIds)
              .order("entered_at", { ascending: false })
              .limit(1);

            const last = (history as any[])?.[0];
            if (last) {
              const info = stageMap.get(last.stage_id);
              if (info) {
                targetStageId = last.stage_id;
                targetStageName = info.name;
                targetPipelineId = info.pipeline_id;
                const pip = (crcPipelines || []).find((p: any) => p.id === targetPipelineId);
                targetPipelineName = pip?.name || null;
              }
            }
          }
        }


        // Fallback: Funil Principal → first stage
        if (!targetStageId) {
          const fallbackPipeline =
            (crcPipelines || []).find((p: any) => /funil principal/i.test(p.name)) ||
            (crcPipelines || []).find((p: any) => allowedIds.includes(p.id));
          if (fallbackPipeline) {
            const { data: firstStage } = await supabase
              .from("crm_stages")
              .select("id, name")
              .eq("pipeline_id", fallbackPipeline.id)
              .order("position", { ascending: true })
              .limit(1)
              .maybeSingle();
            if (firstStage) {
              targetPipelineId = fallbackPipeline.id;
              targetStageId = (firstStage as any).id;
              targetPipelineName = (fallbackPipeline as any).name;
              targetStageName = (firstStage as any).name;
            }
          }
        }

        if (targetPipelineId && targetStageId) {
          updatePayload.pipeline_id = targetPipelineId;
          updatePayload.stage_id = targetStageId;
          movedPipelineName = targetPipelineName;
          movedStageName = targetStageName;
        }
      }
    }

    const { error: updateError } = await supabase
      .from("crm_leads")
      .update(updatePayload)
      .eq("id", leadId);

    if (updateError) return json({ error: updateError.message }, 500);

    // Livro de atribuições (Fase 0): toda transferência manual fica registrada
    // com origem/destino e quem fez — é o que o rodízio audita depois.
    if ((lead as any).tenant_id) {
      const { error: livroErr } = await supabase.from("crm_lead_atribuicoes").insert({
        tenant_id: (lead as any).tenant_id,
        lead_id: leadId,
        lead_nome: (lead as any).name ?? null,
        lead_telefone: (lead as any).phone ?? null,
        de_user_id: oldUserId ?? null,
        para_user_id: newUserId,
        fase: "manual",
        motivo: "transferência manual (transfer-lead)",
        criado_por: user.id,
      });
      if (livroErr) console.warn(`[transfer-lead] livro de atribuições não gravado: ${livroErr.message}`);
    }

    const transferMsg = movedPipelineName && movedStageName
      ? `🔄 Lead transferido: ${oldUserName} → ${newUserName}\n📂 Movido para: ${movedPipelineName} • ${movedStageName}`
      : `🔄 Lead transferido: ${oldUserName} → ${newUserName}`;

    // Send system message + notification in parallel (non-blocking errors)
    await Promise.all([
      supabase.from("messages").insert({
        lead_id: leadId,
        direction: "outbound",
        type: "system",
        content: transferMsg,
        status: "system",
        sender_id: user.id,
        ...(lead as any).tenant_id ? { tenant_id: (lead as any).tenant_id } : {},
      }),
      supabase.from("crm_notifications").insert({
        user_id: newUserId,
        type: "transfer",
        title: "Lead transferido para você",
        body: `${(lead as any).name || "Lead"} foi transferido por ${profiles?.find((p) => p.id === user.id)?.nome || "alguém"}`,
        lead_id: leadId,
      }),
    ]);

    return json({
      success: true,
      oldUserName,
      newUserName,
      assigned_to: newUserId,
      // Return IDs so the frontend can update lead state immediately
      pipeline_id: (updatePayload.pipeline_id as string) ?? null,
      stage_id: (updatePayload.stage_id as string) ?? null,
      moved_pipeline: movedPipelineName,
      moved_stage: movedStageName,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});