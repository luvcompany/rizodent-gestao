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
      supabase.from("crm_leads").select("id, assigned_to, tenant_id").eq("id", leadId).maybeSingle(),
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

    const isPrivileged = roleRow?.role === "admin" || roleRow?.role === "gerente" || isSuperadmin;
    const canTransfer = isPrivileged || lead.assigned_to === user.id || lead.assigned_to === null;
    if (!canTransfer) return json({ error: "Forbidden" }, 403);

    const oldUserId = lead.assigned_to;
    // Fetch profiles for all relevant users (old owner, requester, new owner)
    const profileIds = [user.id, newUserId, oldUserId].filter(Boolean) as string[];
    const { data: profiles } = await supabase.from("profiles").select("id, nome").in("id", profileIds);

    const oldUserName = profiles?.find((p) => p.id === oldUserId)?.nome || "Não atribuído";
    const newUserName = profiles?.find((p) => p.id === newUserId)?.nome || "Responsável";

    const { error: updateError } = await supabase
      .from("crm_leads")
      .update({ assigned_to: newUserId, updated_at: new Date().toISOString() })
      .eq("id", leadId);

    if (updateError) return json({ error: updateError.message }, 500);

    const { error: messageError } = await supabase.from("messages").insert({
      lead_id: leadId,
      direction: "outbound",
      type: "system",
      content: `🔄 Lead transferido: ${oldUserName} → ${newUserName}`,
      status: "system",
      sender_id: user.id,
    });

    if (messageError) return json({ error: messageError.message }, 500);

    return json({ success: true, oldUserName, newUserName, assigned_to: newUserId });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});