import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: corsHeaders });

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

    // Check duplicate
    const { data: existing } = await supabase.from("crm_leads").select("id").eq("phone", normalizedPhone).limit(1);
    if (existing && existing.length > 0) {
      return new Response(JSON.stringify({ status: "duplicate", lead_id: existing[0].id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Find pipeline
    let pipelineId: string;
    if (pipeline) {
      const { data: p } = await supabase.from("crm_pipelines").select("id").ilike("name", pipeline).limit(1);
      if (p && p.length > 0) {
        pipelineId = p[0].id;
      } else {
        const { data: first } = await supabase.from("crm_pipelines").select("id").limit(1);
        pipelineId = first?.[0]?.id;
      }
    } else {
      const { data: first } = await supabase.from("crm_pipelines").select("id").limit(1);
      pipelineId = first?.[0]?.id;
    }

    if (!pipelineId!) {
      return new Response(JSON.stringify({ error: "no pipeline found" }), { status: 400, headers: corsHeaders });
    }

    // Get first stage
    const { data: stagesData } = await supabase.from("crm_stages").select("id").eq("pipeline_id", pipelineId).order("position").limit(1);
    const stageId = stagesData?.[0]?.id;
    if (!stageId) {
      return new Response(JSON.stringify({ error: "no stage found" }), { status: 400, headers: corsHeaders });
    }

    // All leads assigned to Rizodent user
    const assignedTo = "d9b27aa3-049e-4ec9-9ae3-fb160a9544fa";

    // Create lead
    const { data: lead, error } = await supabase.from("crm_leads").insert({
      name,
      phone: normalizedPhone,
      pipeline_id: pipelineId,
      stage_id: stageId,
      tags: tags || [],
      source: source || "webhook",
      assigned_to: assignedTo,
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
