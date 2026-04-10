import { supabase } from "@/integrations/supabase/client";

interface AutomationContext {
  leadId: string;
  stageId: string;
  leadPhone?: string | null;
  triggerTypes: string[];
  messageContent?: string;
}

export async function executeStageAutomations({ leadId, stageId, leadPhone, triggerTypes, messageContent }: AutomationContext) {
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
        // Check keyword_response filter
        if (auto.trigger_type === "keyword_response" && messageContent) {
          const keywords = (config.keywords as string[]) || [];
          const lowerMsg = messageContent.toLowerCase();
          const matched = keywords.some(kw => lowerMsg.includes(kw.toLowerCase()));
          if (!matched) continue;
        }

        await executeAction(auto.action_type, config, leadId, phone, stageId);
      } catch (e) {
        console.error("[Automation] Error executing:", e);
      }
    }
  } catch (e) {
    console.error("[Automation] Fetch error:", e);
  }
}

export async function executeAction(
  actionType: string,
  config: Record<string, unknown>,
  leadId: string,
  phone: string | null | undefined,
  stageId?: string
) {
  switch (actionType) {
    case "send_bot":
      if (config.bot_id) {
        supabase.functions.invoke("bot-engine", {
          body: { leadId, botId: config.bot_id, trigger: "automation" },
        }).catch(e => console.error("[Automation] Bot trigger error:", e));
      }
      break;

    case "send_template":
      if (config.template_id && phone) {
        const { data: tpl } = await supabase
          .from("crm_whatsapp_templates")
          .select("name, language")
          .eq("id", config.template_id as string)
          .single();
        if (tpl) {
          supabase.functions.invoke("send-whatsapp-message", {
            body: { lead_id: leadId, to: phone, type: "template", template_name: tpl.name, template_language: tpl.language },
          }).catch(e => console.error("[Automation] Template trigger error:", e));
        }
      }
      break;

    case "move_stage":
      if (config.target_stage_id) {
        await supabase.from("crm_leads").update({ stage_id: config.target_stage_id as string }).eq("id", leadId);
      }
      break;

    case "send_audio":
      if (config.audio_url && phone) {
        supabase.functions.invoke("send-whatsapp-message", {
          body: { lead_id: leadId, to: phone, type: "audio", media_url: config.audio_url },
        }).catch(e => console.error("[Automation] Audio trigger error:", e));
      }
      break;

    case "send_file":
      if (config.file_url && phone) {
        supabase.functions.invoke("send-whatsapp-message", {
          body: { lead_id: leadId, to: phone, type: "document", media_url: config.file_url, filename: config.filename || "arquivo" },
        }).catch(e => console.error("[Automation] File trigger error:", e));
      }
      break;

    case "add_tag": {
      const tag = config.tag as string;
      if (tag) {
        const { data: lead } = await supabase.from("crm_leads").select("tags").eq("id", leadId).single();
        const existing = (lead?.tags || []) as string[];
        if (!existing.includes(tag)) {
          await supabase.from("crm_leads").update({ tags: [...existing, tag] }).eq("id", leadId);
        }
      }
      break;
    }

    case "notify_owner": {
      const { data: lead } = await supabase.from("crm_leads").select("assigned_to, name").eq("id", leadId).single();
      if (lead?.assigned_to) {
        await supabase.from("crm_notifications").insert({
          user_id: lead.assigned_to,
          lead_id: leadId,
          title: (config.notification_title as string) || "Automação disparada",
          body: (config.notification_body as string) || `Automação acionada para o lead ${lead.name}`,
          type: "automation",
        });
      }
      break;
    }

    case "combo": {
      const actions = (config.actions as Array<{ action_type: string; action_config: Record<string, unknown> }>) || [];
      for (const sub of actions) {
        await executeAction(sub.action_type, sub.action_config || {}, leadId, phone, stageId);
      }
      break;
    }

    case "webhook":
      if (config.url) {
        fetch(config.url as string, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lead_id: leadId, stage_id: stageId, event: "automation_trigger" }),
        }).catch(() => {});
      }
      break;
  }
}
