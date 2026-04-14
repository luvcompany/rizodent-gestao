-- Move Vitor Santos back to Agendado for testing
UPDATE public.crm_leads 
SET stage_id = '477cbd86-1b9d-4eaa-ac4e-46eafcb3e554', updated_at = now()
WHERE id = 'd5e64153-1e78-4bd7-82b6-943bcd1ddd87';

-- Close current stage history
UPDATE public.crm_lead_stage_history 
SET exited_at = now() 
WHERE lead_id = 'd5e64153-1e78-4bd7-82b6-943bcd1ddd87' 
AND stage_id = 'a0ecaa42-078f-425c-9e23-cb90eca059e7' 
AND exited_at IS NULL;

-- Insert new stage history for Agendado
INSERT INTO public.crm_lead_stage_history (lead_id, stage_id, from_stage_id, entered_at)
VALUES ('d5e64153-1e78-4bd7-82b6-943bcd1ddd87', '477cbd86-1b9d-4eaa-ac4e-46eafcb3e554', 'a0ecaa42-078f-425c-9e23-cb90eca059e7', now());

-- Insert system message
INSERT INTO public.messages (lead_id, direction, type, content, status)
VALUES ('d5e64153-1e78-4bd7-82b6-943bcd1ddd87', 'outbound', 'system', '📋 Etapa alterada: Follow - Up → Agendado (teste)', 'system');