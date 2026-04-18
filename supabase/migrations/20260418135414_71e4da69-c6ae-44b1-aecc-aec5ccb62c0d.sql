UPDATE public.crm_automations
SET is_active = true,
    action_config = jsonb_set(action_config, '{window_end}', '"2026-04-18T11:30"')
WHERE id = '4a30ffc6-f54f-49a6-96d0-1721bc630276';