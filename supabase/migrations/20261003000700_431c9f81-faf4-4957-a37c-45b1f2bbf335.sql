DO $$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef('public.relatorio_sdr_calc(uuid,date,date,uuid,boolean)'::regprocedure) INTO d;
  d := replace(d, 'COALESCE(l.distribuido_em, l.created_at)', 'l.distribuido_em');
  EXECUTE d;
END $$;