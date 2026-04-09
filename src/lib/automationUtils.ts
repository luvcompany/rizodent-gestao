import { supabase } from "@/integrations/supabase/client";

interface AutomationContext {
  leadId: string;
  stageId: string;
  leadPhone?: string | null;
  triggerTypes: string[];
}

export async function executeStageAutomations({ leadId, stageId, leadPhone, triggerTypes }: AutomationContext) {
  try {
    const { data: allAutomations } = await supabase
      .from("crm_automations")
      .select("*")
      .eq("stage_id", stageId)
      .eq("is_active", true);

    const stageAutomations = allAutomations?.filter(a => triggerTypes.includes(a.trigger_type)) || [];

    if (!stageAutomations.length) return;

    // Fetch phone if not provided
    let phone = leadPhone;
    if (phone === undefined) {
      const { data: leadData } = await supabase.from("crm_leads").select("phone").eq("id", leadId).single();
      phone = leadData?.phone || null;
    }

    for (const auto of stageAutomations) {
      const config = (auto.action_config || {}) as Record<string, unknown>;
      try {
        if (auto.action_type === "send_bot" && config.bot_id) {
          supabase.functions.invoke("bot-engine", {
            body: { leadId, botId: config.bot_id, trigger: "automation" },
          }).catch(e => console.error("[Automation] Bot trigger error:", e));
        } else if (auto.action_type === "send_template" && config.template_id && phone) {
          const { data: tpl } = await supabase.from("crm_whatsapp_templates").select("name, language").eq("id", config.template_id as string).single();
          if (tpl) {
            supabase.functions.invoke("send-whatsapp-message", {
              body: { lead_id: leadId, to: phone, type: "template", template_name: tpl.name, template_language: tpl.language },
            }).catch(e => console.error("[Automation] Template trigger error:", e));
          }
        } else if (auto.action_type === "move_stage" && config.target_stage_id) {
          await supabase.from("crm_leads").update({ stage_id: config.target_stage_id as string }).eq("id", leadId);
        } else if (auto.action_type === "webhook" && config.url) {
          fetch(config.url as string, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lead_id: leadId, stage_id: stageId, event: "automation_trigger" }),
          }).catch(() => {});
        }
      } catch (e) {
        console.error("[Automation] Error executing:", e);
      }
    }
  } catch (e) {
    console.error("[Automation] Fetch error:", e);
  }
}