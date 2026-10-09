-- Excluir funil ou etapa não apaga mais leads em cascata (09/10/2026).
--
-- crm_leads.stage_id e crm_leads.pipeline_id eram ON DELETE CASCADE: "Excluir
-- funil" apaga as etapas, e cada etapa apagada levava junto os leads dela —
-- inclusive os que quem clicou nem enxerga — com mensagens, agendamentos e
-- histórico. Agora:
--   - a FK é RESTRICT (o banco recusa);
--   - um gatilho explica em português quantos leads há e o que fazer. O
--     código do erro é 23503 (o mesmo da FK), para o hard_delete_tenant
--     continuar tratando como "apaga depois" ao excluir um cliente inteiro.
-- Mover os leads antes, ou excluí-los de propósito pela tela, continua igual.

CREATE OR REPLACE FUNCTION public.recusa_excluir_com_leads()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE n integer;
BEGIN
  IF TG_TABLE_NAME = 'crm_stages' THEN
    SELECT count(*) INTO n FROM public.crm_leads WHERE stage_id = OLD.id;
    IF n > 0 THEN
      RAISE EXCEPTION 'A etapa "%" tem % lead(s). Mova os leads para outra etapa antes de excluir.', btrim(OLD.name), n
        USING ERRCODE = '23503';
    END IF;
  ELSE
    SELECT count(*) INTO n FROM public.crm_leads WHERE pipeline_id = OLD.id;
    IF n > 0 THEN
      RAISE EXCEPTION 'O funil "%" tem % lead(s). Mova os leads para outro funil antes de excluir.', btrim(OLD.name), n
        USING ERRCODE = '23503';
    END IF;
  END IF;
  RETURN OLD;
END;
$function$;
REVOKE ALL ON FUNCTION public.recusa_excluir_com_leads() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_recusa_excluir_etapa_com_leads ON public.crm_stages;
CREATE TRIGGER trg_recusa_excluir_etapa_com_leads BEFORE DELETE ON public.crm_stages
  FOR EACH ROW EXECUTE FUNCTION public.recusa_excluir_com_leads();
DROP TRIGGER IF EXISTS trg_recusa_excluir_funil_com_leads ON public.crm_pipelines;
CREATE TRIGGER trg_recusa_excluir_funil_com_leads BEFORE DELETE ON public.crm_pipelines
  FOR EACH ROW EXECUTE FUNCTION public.recusa_excluir_com_leads();

ALTER TABLE public.crm_leads DROP CONSTRAINT crm_leads_stage_id_fkey;
ALTER TABLE public.crm_leads ADD CONSTRAINT crm_leads_stage_id_fkey
  FOREIGN KEY (stage_id) REFERENCES public.crm_stages(id) ON DELETE RESTRICT;
ALTER TABLE public.crm_leads DROP CONSTRAINT crm_leads_pipeline_id_fkey;
ALTER TABLE public.crm_leads ADD CONSTRAINT crm_leads_pipeline_id_fkey
  FOREIGN KEY (pipeline_id) REFERENCES public.crm_pipelines(id) ON DELETE RESTRICT;
