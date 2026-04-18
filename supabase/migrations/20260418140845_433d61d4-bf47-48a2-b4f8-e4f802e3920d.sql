UPDATE public.crm_automations
SET is_active = true,
    action_config = action_config 
      || jsonb_build_object('start_day', '6')
      || CASE WHEN action_config ? 'start_time' THEN '{}'::jsonb ELSE jsonb_build_object('start_time', '11:05') END
WHERE id = '4a30ffc6-f54f-49a6-96d0-1721bc630276';