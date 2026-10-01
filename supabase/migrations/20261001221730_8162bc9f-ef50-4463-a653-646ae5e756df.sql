-- =============================================================================
-- Cidades e serviços do tenant (RPC) — trazido do CRM v2 junto com o redesign
--
-- As telas redesenhadas (filtros do lead, condições de automação, relatório de
-- origem, campo de serviço) deixaram de usar listas fixas no código e passaram
-- a ler o cadastro do próprio cliente. A leitura é por RPC SECURITY DEFINER,
-- devolvendo SÓ NOMES, porque SDR, closer e recepção não enxergam `clinicas`
-- nem `tipos_procedimento` pela RLS — e são justamente eles que mais usam esses
-- campos. Sem estas duas funções o hook cai na leitura direta e esses perfis
-- veriam a lista vazia.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.cidades_do_tenant()
 RETURNS SETOF text
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT btrim(c.cidade)
    FROM public.clinicas c
   WHERE c.tenant_id = public.current_tenant_id()
     AND c.ativa
     AND NULLIF(btrim(c.cidade), '') IS NOT NULL
   ORDER BY 1;
$function$;

CREATE OR REPLACE FUNCTION public.servicos_do_tenant()
 RETURNS SETOF text
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT btrim(t.nome)
    FROM public.tipos_procedimento t
   WHERE t.tenant_id = public.current_tenant_id()
     AND t.ativo
     AND NULLIF(btrim(t.nome), '') IS NOT NULL
    ORDER BY 1;
$function$;

REVOKE ALL ON FUNCTION public.cidades_do_tenant() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.servicos_do_tenant() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cidades_do_tenant() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.servicos_do_tenant() TO authenticated, service_role;