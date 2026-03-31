
ALTER TABLE crm_followup_configs ADD COLUMN IF NOT EXISTS disparos jsonb DEFAULT '[]'::jsonb;

ALTER TABLE crm_followup_queue ADD COLUMN IF NOT EXISTS current_disparo_index integer DEFAULT 0;
ALTER TABLE crm_followup_queue ADD COLUMN IF NOT EXISTS next_scheduled_at timestamptz;
