-- Varredura de fim de expediente da etapa de espera "Reagendar":
-- lead que pediu remarcação e não deu novo horário até o fim do dia vira
-- falta (no_show) e vai para "Não compareceu"; quem ganhou agendamento novo
-- vai para "Reagendado". 21:30 UTC = 18:30 America/Bahia.
select cron.schedule(
  'reagendar-expirado-2130utc',
  '30 21 * * *',
  $$
  select net.http_post(
    url := 'https://oybroifaleftwrhnlhqc.supabase.co/functions/v1/dontus-sync',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select value from public._internal_secrets where name = 'automation_cron_token')),
    body := '{"mode":"reagendar_expirado","dry_run":false}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
