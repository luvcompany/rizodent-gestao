import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";
import { safeEqual } from "../_shared/authz.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: corsHeaders });

  // Require shared secret to prevent fake-lead flooding.
  // Preferência: header `x-webhook-secret`.
  // DEPRECATED: preferir header; query string vaza em logs/Referer.
  const expectedSecret = Deno.env.get("WEBHOOK_SECRET");
  const headerSecret = req.headers.get("x-webhook-secret") || "";
  const querySecret = new URL(req.url).searchParams.get("secret") || "";
  const providedSecret = headerSecret || querySecret;
  const auth = req.headers.get("authorization") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const isServiceRole = serviceRoleKey ? safeEqual(auth, `Bearer ${serviceRoleKey}`) : false;
  if (!isServiceRole) {
    if (!expectedSecret || !safeEqual(providedSecret, expectedSecret)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
  }


  try {
    const body = await req.json();
    const { name, phone, tags, pipeline, source } = body;

    if (!name || !phone) {
      return new Response(JSON.stringify({ error: "name and phone are required" }), { status: 400, headers: corsHeaders });
    }

    const normalizedPhone = String(phone).replace(/\D/g, "");
    if (normalizedPhone.length < 10) {
      return new Response(JSON.stringify({ error: "invalid phone number" }), { status: 400, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // All leads assigned to the central Rizodent user — derive tenant from that profile.
    const assignedTo = "d9b27aa3-049e-4ec9-9ae3-fb160a9544fa";
    const { data: assignedProfile } = await supabase
      .from("profiles").select("tenant_id").eq("id", assignedTo).maybeSingle();
    const tenantId = (assignedProfile as any)?.tenant_id;
    if (!tenantId) {
      return new Response(JSON.stringify({ error: "assigned user has no tenant" }), { status: 500, headers: corsHeaders });
    }

    // Per-tenant duplicate check (avoids cross-tenant collisions on the same phone).
    const { data: existing } = await supabase
      .from("crm_leads").select("id").eq("phone", normalizedPhone).eq("tenant_id", tenantId).limit(1);
    if (existing && existing.length > 0) {
      return new Response(JSON.stringify({ status: "duplicate", lead_id: existing[0].id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Find pipeline within tenant
    let pipelineId: string | undefined;
    if (pipeline) {
      const { data: p } = await supabase
        .from("crm_pipelines").select("id").eq("tenant_id", tenantId).ilike("name", pipeline).limit(1);
      pipelineId = p?.[0]?.id;
    }
    if (!pipelineId) {
      const { data: first } = await supabase
        .from("crm_pipelines").select("id").eq("tenant_id", tenantId).order("created_at").limit(1);
      pipelineId = first?.[0]?.id;
    }
    if (!pipelineId) {
      return new Response(JSON.stringify({ error: "no pipeline found" }), { status: 400, headers: corsHeaders });
    }

    // Get first stage of that pipeline
    const { data: stagesData } = await supabase
      .from("crm_stages").select("id").eq("pipeline_id", pipelineId).order("position").limit(1);
    const stageId = stagesData?.[0]?.id;
    if (!stageId) {
      return new Response(JSON.stringify({ error: "no stage found" }), { status: 400, headers: corsHeaders });
    }

    // Pre-check: o UNIQUE constraint foi removido para permitir duplicação
    // intencional via UI, então fazemos a deduplicação aqui no webhook.
    // O trigger trg_normalize_lead_phone garante que phones armazenados
    // estão sempre no formato canônico (sem o 9, com prefixo 55).
    if (normalizedPhone) {
      const { data: existing } = await supabase
        .from("crm_leads")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("phone", normalizedPhone)
        .limit(1)
        .maybeSingle();
      if (existing?.id) {
        return new Response(JSON.stringify({ status: "duplicate", lead_id: existing.id }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const { data: lead, error } = await supabase.from("crm_leads").insert({
      name,
      phone: normalizedPhone,
      pipeline_id: pipelineId,
      stage_id: stageId,
      tags: tags || [],
      source: source || "webhook",
      assigned_to: assignedTo,
      tenant_id: tenantId,
    }).select("id").single();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ status: "created", lead_id: lead.id }), {
      status: 201,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
});
