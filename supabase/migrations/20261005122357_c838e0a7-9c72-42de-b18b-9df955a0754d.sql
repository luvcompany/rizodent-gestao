DO $$ DECLARE r record; BEGIN
FOR r IN SELECT p.oid::regprocedure f FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('rizodent_infer_cidade','sem_acento','normaliza_nome_etapa','termo_regex_acento_indiferente','rpt_norm_txt','rpt_classify_origem','rpt_creative_key','map_source_to_origem','modelo_data_formato_antigo','modelo_data_formato_semana','rodizio_msg_humana','api4com_call_label','etapa_e_contratado') LOOP
EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.f);
END LOOP; END $$;