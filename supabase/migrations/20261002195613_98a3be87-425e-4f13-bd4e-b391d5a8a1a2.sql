DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.relatorio_agendamentos(date,date)'::regprocedure);
  IF position('FROM primeiro WHERE scheduled_date BETWEEN _inicio AND _fim' IN d) = 0 THEN RAISE EXCEPTION 'trecho não encontrado'; END IF;
  d := replace(d, 'FROM primeiro WHERE scheduled_date BETWEEN _inicio AND _fim',
                  'FROM primeiro WHERE scheduled_date BETWEEN _inicio AND _fim AND status <> ''rescheduled''');
  EXECUTE d;
END $$;