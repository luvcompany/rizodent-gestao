DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.relatorio_sdr_blocos(date,date)'::regprocedure);
  d := replace(d, 'FROM primeiro WHERE scheduled_date BETWEEN p_de AND p_ate AND sdr IN (SELECT user_id FROM sdrs)',
                  'FROM primeiro WHERE scheduled_date BETWEEN p_de AND p_ate AND status <> ''rescheduled'' AND sdr IN (SELECT user_id FROM sdrs)');
  EXECUTE d;
END $$;