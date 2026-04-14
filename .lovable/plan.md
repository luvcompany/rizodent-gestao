

## Plan: Fix "Leads sem resposta" Trigger

### Problem
The `no_response` trigger type has a UI form but **zero backend processing logic** in the `automation-engine`. The engine simply never checks for it. Additionally, the time unit selector is missing "Minutos" and "Semanas" options.

### Behavior Requirements
- "Leads sem resposta há 1 hora" means: any lead with >= 1 hour without inbound response fires the action (1h, 1h20, 1h50 all qualify)
- Applies to all leads **currently in the configured stage** that match the no-response condition
- Leads moved/dragged into the stage also get checked on the next cron cycle
- If a lead responds (inbound message), cancel pending actions and stop firing
- Time units: Minutos, Horas, Dias, Semanas

### Changes

#### 1. UI — `src/components/automation/AutomationModal.tsx`
- Add `minutes` and `weeks` to the `no_response_unit` selector (currently only has `hours` and `days`)

#### 2. Backend — `supabase/functions/automation-engine/index.ts`
Add a new section (between the existing sections) to process `no_response` automations:

- Query all active `no_response` automations
- For each, read `no_response_amount` and `no_response_unit` from `action_config`, convert to milliseconds
- Query all leads in the automation's `stage_id` where `automation_paused` is not true
- For each lead:
  - Determine the "last activity" timestamp: use `last_inbound_at` if it exists, otherwise fall back to `last_outbound_at` or `created_at`
  - The trigger fires if the lead has **no inbound response** after the last outbound message AND the elapsed time since `last_outbound_at` >= the configured threshold
  - If `last_inbound_at > last_outbound_at`, the lead HAS responded — skip and cancel any pending queue items
  - If no `last_outbound_at` exists, check time since `created_at` (lead was never contacted but also never responded)
  - Check `crm_automation_queue` to avoid duplicate sends (one send per automation per lead, reset if lead re-enters stage or responds then goes silent again)
- Execute the configured action via `sendAction()`
- Insert a record into `crm_automation_queue` with status `sent`

The time conversion will support: `minutes` (×60000), `hours` (×3600000), `days` (×86400000), `weeks` (×604800000).

### Technical Details

```text
automation-engine cron (every 60s)
  │
  ├── ... existing sections (bot_timeout, reengagement, stale, no_show, before_scheduled)
  │
  └── NEW: no_response section
       ├── fetch automations WHERE trigger_type='no_response' AND is_active=true
       ├── for each automation:
       │    ├── parse no_response_amount + no_response_unit → thresholdMs
       │    ├── fetch leads in stage_id
       │    └── for each lead:
       │         ├── if last_inbound_at > last_outbound_at → skip (responded)
       │         ├── referenceTime = last_outbound_at || created_at
       │         ├── if (now - referenceTime) >= thresholdMs → FIRE
       │         ├── check crm_automation_queue for duplicates
       │         └── sendAction() + insert queue record
```

