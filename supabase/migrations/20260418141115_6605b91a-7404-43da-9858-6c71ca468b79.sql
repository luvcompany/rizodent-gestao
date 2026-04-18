-- Limpar execuções prévias da automação time_window do Vitor para permitir novo disparo
DELETE FROM public.crm_automation_executions
WHERE automation_id = '4a30ffc6-f54f-49a6-96d0-1721bc630276';

-- Reconfigurar a janela: sábado 00:00 → sábado 23:59 (cobre todo o dia de hoje)
UPDATE public.crm_automations
SET is_active = true,
    action_config = action_config || jsonb_build_object(
      'window_mode', 'weekly',
      'start_day', '6',
      'end_day', '6',
      'start_time', '00:00',
      'end_time', '23:59'
    )
WHERE id = '4a30ffc6-f54f-49a6-96d0-1721bc630276';