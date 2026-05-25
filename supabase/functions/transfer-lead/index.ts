import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";

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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization header" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const anonClient = createClient(supabaseUrl, anonKey);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await anonClient.auth.getUser(token);
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(supabaseUrl, serviceKey);
    const { leadId, newUserId } = await req.json();

    if (!leadId || !newUserId) {
      return json({ error: "leadId and newUserId are required" }, 400);
    }

    const [{ data: lead }, { data: roleRow }, { data: requesterProfile }] = await Promise.all([
      supabase.from("crm_leads").select("id, name, assigned_to, tenant_id, pipeline_id, stage_id").eq("id", leadId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", user.id).maybeSingle(),
      supabase.from("profiles").select("tenant_id").eq("id", user.id).maybeSingle(),
    ]);

    if (!lead) return json({ error: "Lead not found" }, 404);

    // Tenant cross-check: requester, lead, and target user must all belong to the same tenant.
    const requesterTenant = (requesterProfile as any)?.tenant_id;
    const isSuperadmin = roleRow?.role === "superadmin";
    if (!isSuperadmin) {
      if (!requesterTenant || requesterTenant !== (lead as any).tenant_id) {
        return json({ error: "Forbidden: cross-tenant" }, 403);
      }
      const { data: targetProfile } = await supabase
        .from("profiles").select("tenant_id").eq("id", newUserId).maybeSingle();
      if (!targetProfile || (targetProfile as any).tenant_id !== requesterTenant) {
        return json({ error: "Target user not in your tenant" }, 403);
      }
    }

    const isPrivileged = roleRow?.role === "crc" || roleRow?.role === "gerente" || roleRow?.role === "posvenda" || isSuperadmin;
    const canTransfer = isPrivileged || lead.assigned_to === user.id || lead.assigned_to === null;
    if (!canTransfer) return json({ error: "Forbidden" }, 403);

    const oldUserId = lead.assigned_to;
    // Fetch profiles for all relevant users (old owner, requester, new owner)
    const profileIds = [user.id, newUserId, oldUserId].filter(Boolean) as string[];
    const { data: profiles } = await supabase.from("profiles").select("id, nome").in("id", profileIds);

    const oldUserName = profiles?.find((p) => p.id === oldUserId)?.nome || "Não atribuído";
    const newUserName = profiles?.find((p) => p.id === newUserId)?.nome || "Responsável";

    // If target user is posvenda, auto-move lead to first stage of a pipeline accessible to posvenda
    const updatePayload: Record<string, unknown> = {
      assigned_to: newUserId,
      updated_at: new Date().toISOString(),
    };
    let movedPipelineName: string | null = null;
    let movedStageName: string | null = null;

    const { data: targetRoleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", newUserId)
      .maybeSingle();

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
        .contains("allowed_roles", ["posvenda"]);

      const pipeline =
        pipelines?.find((p: any) => p.tenant_id === (lead as any).tenant_id) ||
        pipelines?.[0];

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