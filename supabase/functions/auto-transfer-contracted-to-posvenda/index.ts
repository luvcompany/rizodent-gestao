import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Auto-transfer leads that entered a "Contratado" stage on a previous business day
 * and are NOT yet in a Pós-venda pipeline / assigned to a posvenda user.
 *
 * Triggered daily by pg_cron (mon-fri 10:00 UTC = 07:00 BRT).
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // 1) For every tenant, find its Pós-venda pipeline + first stage + a posvenda user
    const { data: pipelines } = await supabase
      .from("crm_pipelines")
      .select("id, name, tenant_id, allowed_roles")
      .contains("allowed_roles", ["posvenda"]);

    if (!pipelines || pipelines.length === 0) {
      return json({ ok: true, transferred: 0, reason: "no posvenda pipelines" });
    }

    // 2) Identify contracted stage IDs across all pipelines
    const { data: contractedStages } = await supabase
      .from("crm_stages")
      .select("id, name, pipeline_id, tenant_id")
      .ilike("name", "%contratado%");

    if (!contractedStages || contractedStages.length === 0) {
      return json({ ok: true, transferred: 0, reason: "no contracted stages" });
    }

    // Exclude stages whose pipeline is already the Pós-venda one
    const posvendaPipelineIds = new Set(pipelines.map((p: any) => p.id));
    const triggerStages = contractedStages.filter(
      (s: any) => !posvendaPipelineIds.has(s.pipeline_id),
    );
    if (triggerStages.length === 0) {
      return json({ ok: true, transferred: 0, reason: "no trigger stages" });
    }

    // 3) Leads currently in those contracted stages, NOT yet in posvenda pipeline
    const triggerStageIds = triggerStages.map((s: any) => s.id);

    const { data: leads } = await supabase
      .from("crm_leads")
      .select("id, name, tenant_id, pipeline_id, stage_id, assigned_to")
      .in("stage_id", triggerStageIds);

    if (!leads || leads.length === 0) {
      return json({ ok: true, transferred: 0, reason: "no leads to move" });
    }

    // 4) For each tenant, resolve a default posvenda user (first one found)
    const tenantIds = Array.from(new Set(leads.map((l: any) => l.tenant_id)));
    const { data: posvendaRoles } = await supabase
      .from("user_roles")
      .select("user_id, tenant_id")
      .eq("role", "posvenda")
      .in("tenant_id", tenantIds);

    const posvendaByTenant = new Map<string, string>();
    (posvendaRoles || []).forEach((r: any) => {
      if (!posvendaByTenant.has(r.tenant_id)) posvendaByTenant.set(r.tenant_id, r.user_id);
    });

    const pipelineByTenant = new Map<string, any>();
    pipelines.forEach((p: any) => {
      // Prefer one inside the lead's tenant
      if (!pipelineByTenant.has(p.tenant_id)) pipelineByTenant.set(p.tenant_id, p);
    });

    // 5) Process each lead
    let transferred = 0;
    const skipped: any[] = [];

    for (const lead of leads as any[]) {
      const targetUserId = posvendaByTenant.get(lead.tenant_id);
      const targetPipeline =
        pipelineByTenant.get(lead.tenant_id) || pipelines[0];

      if (!targetUserId || !targetPipeline) {
        skipped.push({ leadId: lead.id, reason: "no posvenda user/pipeline for tenant" });
        continue;
      }

      // Already assigned to a posvenda user? then skip (manual already done)
      if (lead.assigned_to === targetUserId) {
        skipped.push({ leadId: lead.id, reason: "already posvenda" });
        continue;
      }

      // Find first stage of the target pipeline
      const { data: firstStage } = await supabase
        .from("crm_stages")
        .select("id, name")
        .eq("pipeline_id", targetPipeline.id)
        .order("position", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!firstStage) {
        skipped.push({ leadId: lead.id, reason: "pipeline has no stages" });
        continue;
      }

      const { error: updErr } = await supabase
        .from("crm_leads")
        .update({
          assigned_to: targetUserId,
          pipeline_id: targetPipeline.id,
          stage_id: (firstStage as any).id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", lead.id);

      if (updErr) {
        skipped.push({ leadId: lead.id, reason: updErr.message });
        continue;
      }

      await supabase.from("messages").insert({
        lead_id: lead.id,
        direction: "outbound",
        type: "system",
        status: "system",
        content: `🤖 Transferência automática para Pós-venda\n📂 Movido para: ${targetPipeline.name} • ${(firstStage as any).name}`,
      });

      transferred += 1;
    }

    return json({ ok: true, transferred, skipped_count: skipped.length, skipped });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      500,
    );
  }
});
