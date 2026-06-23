import { supabase } from "@/integrations/supabase/client";
import { evaluateConditions, type ConditionsConfig } from "@/lib/automationConditions";

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

    // Fetch lead once for both phone and condition evaluation
    let phone = leadPhone;
    let leadRow: Record<string, any> | null = null;
    if (phone === undefined || stageAutomations.some(a => (a.action_config as any)?.conditions)) {
      const { data: leadData } = await supabase
        .from("crm_leads")
        .select("phone, tags, source, cidade, ad_id, ad_account_id, ad_account_name, nome_anuncio, servico_interesse, assigned_to, value")
        .eq("id", leadId)
        .single();
      leadRow = leadData || null;
      if (phone === undefined) phone = leadData?.phone || null;
    }

    for (const auto of stageAutomations) {
      const config = (auto.action_config || {}) as Record<string, unknown>;
      try {
        // Evaluate optional conditions
        const conditions = config.conditions as ConditionsConfig | undefined;
        if (conditions?.rules?.length && leadRow && !evaluateConditions(conditions, leadRow)) {
          console.log("[Automation] Skipped by conditions:", auto.id);
          continue;
        }

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
        const currentStageId = stageId;
        if (currentStageId === config.target_stage_id) break;
        
        await supabase.from("crm_leads").update({ 
          stage_id: config.target_stage_id as string,
          updated_at: new Date().toISOString(),
        }).eq("id", leadId);

        // Close previous stage history
        if (currentStageId) {
          await supabase.from("crm_lead_stage_history").update({ exited_at: new Date().toISOString() })
            .eq("lead_id", leadId).eq("stage_id", currentStageId).is("exited_at", null);
        }
        // Insert new stage history
        await supabase.from("crm_lead_stage_history").insert({
          lead_id: leadId,
          stage_id: config.target_stage_id as string,
          from_stage_id: currentStageId || null,
          entered_at: new Date().toISOString(),
        });

        // System message
        const { data: stageNames } = await supabase.from("crm_stages").select("id, name")
          .in("id", [currentStageId, config.target_stage_id as string].filter(Boolean));
        const fromName = stageNames?.find(s => s.id === currentStageId)?.name || "?";
        const toName = stageNames?.find(s => s.id === config.target_stage_id)?.name || "?";
        await supabase.from("messages").insert({
          lead_id: leadId,
          direction: "outbound",
          type: "system",
          content: `📋 Etapa alterada: ${fromName} → ${toName} (automação)`,
          status: "system",
        });

        // Trigger on_enter automations on target stage (skip move_stage to prevent loops)
        executeStageAutomations({
          leadId,
          stageId: config.target_stage_id as string,
          leadPhone: phone,
          triggerTypes: ["on_enter", "on_create_or_enter"],
        });
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
      // Editor saves the tag under "tag_name"; legacy automations used "tag".
      const tag = (config.tag_name ?? config.tag) as string | undefined;
      if (tag) {
        const { data: lead } = await supabase.from("crm_leads").select("tags").eq("id", leadId).single();
        const existing = (lead?.tags || []) as string[];
        if (!existing.includes(tag)) {
          await supabase.from("crm_leads").update({ tags: [...existing, tag] }).eq("id", leadId);
        }
      }
      break;
    }

    case "notify_owner":
    case "notify_assignee": {
      const { data: lead } = await supabase.from("crm_leads").select("assigned_to, name").eq("id", leadId).single();
      if (lead?.assigned_to) {
        await supabase.from("crm_notifications").insert({
          user_id: lead.assigned_to,
          lead_id: leadId,
          title: (config.notification_title as string) || "Automação disparada",
          body:
            (config.notify_message as string) ||
            (config.notification_body as string) ||
            `Automação acionada para o lead ${lead.name}`,
          type: "automation",
        });
      }
      break;
    }

    case "combo": {
      // Editor saves combo_actions: [{ type, config }]; legacy was actions: [{ action_type, action_config }].
      const rawActions = (config.combo_actions ?? config.actions ?? []) as Array<any>;
      for (const sub of rawActions) {
        const subType = (sub?.type ?? sub?.action_type) as string | undefined;
        const subConfig = (sub?.config ?? sub?.action_config ?? {}) as Record<string, unknown>;
        if (!subType) continue;
        await executeAction(subType, subConfig, leadId, phone, stageId);
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
