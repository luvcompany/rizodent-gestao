-- Troca de funil: o bot parar de desfazer o que a pessoa fez.
--
-- O nó "move_stage" do bot guarda um stage_id fixo (normalmente uma etapa do
-- Funil Principal). Quando a SDR já tinha levado o lead para outro funil, a
-- resposta seguinte do lead fazia o bot aplicar esse id e arrastar o lead de
-- volta — o caso relatado pelo dono (lead JOSEFINA, 11/09/2026: movido para
-- Faceta às 13:47:38 e devolvido ao Funil Principal às 13:48:05 pelo bot).
--
-- Esta função dá ao bot a etapa EQUIVALENTE dentro do funil em que o lead
-- está agora, comparando o nome pela régua canônica public.normaliza_nome_etapa.
-- Sem equivalente, devolve NULL e o bot não move nada.
--
-- Migration aditiva: não altera nem remove nenhuma policy, função ou gatilho
-- existente.

CREATE OR REPLACE FUNCTION public.etapa_equivalente_no_funil(_stage_id uuid, _pipeline_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT destino.id
    FROM public.crm_stages origem
    JOIN public.crm_stages destino
      ON destino.pipeline_id = _pipeline_id
     AND destino.tenant_id IS NOT DISTINCT FROM origem.tenant_id
     AND public.normaliza_nome_etapa(destino.name) = public.normaliza_nome_etapa(origem.name)
   WHERE origem.id = _stage_id
   ORDER BY destino.position NULLS LAST, destino.id
   LIMIT 1;
$function$;

COMMENT ON FUNCTION public.etapa_equivalente_no_funil(uuid, uuid) IS
  'Etapa de mesmo nome (normaliza_nome_etapa) dentro do funil informado, no mesmo cliente. Usada pelo bot para não arrastar o lead de volta ao funil de origem.';

REVOKE ALL ON FUNCTION public.etapa_equivalente_no_funil(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.etapa_equivalente_no_funil(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.etapa_equivalente_no_funil(uuid, uuid) TO authenticated, service_role;
