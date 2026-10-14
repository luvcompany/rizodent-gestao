-- Paciente do closer que paga no Dontus sem o closer registrar (14/10/2026).
--
-- Regra do dono: se o lead está na base do closer e o paciente paga, o
-- dontus-sync espera 1 dia. Se nesse tempo o closer registrar o pagamento
-- como dele (Pacientes do closer), a venda é do closer. Se não registrar, o
-- lead vai para o Contratado da CENTRAL e o pagamento conta para a central.
--
--  - crm_closer_contrato_pendente: a espera (uma linha por recebimento do
--    Dontus), lida e decidida pelo dontus-sync.
--  - closer_registrou_pagamento: o closer lançou pagamento deste lead?
--  - closer_contrato_vai_para_central: leva o lead (ou junta, se a central já
--    tem o telefone) para a etapa Contratado do funil de mesmo nome da central
--    (senão o Funil Principal), com o administrador como responsável.

CREATE TABLE IF NOT EXISTS public.crm_closer_contrato_pendente (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  lead_id uuid NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  dontus_key text NOT NULL UNIQUE,
  id_clinica_dontus integer NOT NULL,
  paciente_nome text,
  valor numeric,
  data_pagamento date NOT NULL,
  decidir_em timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'aguardando' CHECK (status IN ('aguardando', 'closer', 'central')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  decidido_em timestamptz
);
CREATE INDEX IF NOT EXISTS crm_closer_contrato_pendente_fila
  ON public.crm_closer_contrato_pendente (decidir_em) WHERE status = 'aguardando';
ALTER TABLE public.crm_closer_contrato_pendente ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gestao_le_closer_contrato_pendente ON public.crm_closer_contrato_pendente;
CREATE POLICY gestao_le_closer_contrato_pendente ON public.crm_closer_contrato_pendente
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id())
         AND ((SELECT public.has_role(auth.uid(), 'gerente'::app_role)) OR (SELECT public.has_role(auth.uid(), 'superadmin'::app_role))));

CREATE OR REPLACE FUNCTION public.closer_registrou_pagamento(p_lead uuid, p_desde date)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.closer_pagamentos pg
      JOIN public.closer_pacientes cp ON cp.id = pg.paciente_id
     WHERE cp.lead_id = p_lead
       AND pg.data_pagamento >= p_desde - 3
  )
$function$;
REVOKE ALL ON FUNCTION public.closer_registrou_pagamento(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.closer_registrou_pagamento(uuid, date) TO service_role;

CREATE OR REPLACE FUNCTION public.closer_contrato_vai_para_central(p_lead uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  l public.crm_leads;
  v_gestor uuid; v_numero uuid; v_pipe uuid; v_stage uuid; v_central uuid; v_alvo uuid;
  v_nome_funil text;
BEGIN
  SELECT * INTO l FROM public.crm_leads WHERE id = p_lead;
  IF l.id IS NULL THEN RETURN NULL; END IF;
  -- Já está na central: nada a mover.
  IF public.mundo_numero_whatsapp(l.tenant_id, l.whatsapp_number_id) = 'crc' THEN RETURN l.id; END IF;

  SELECT c.gestor_user_id INTO v_gestor FROM public.crm_rodizio_config c WHERE c.tenant_id = l.tenant_id;
  SELECT w.id INTO v_numero FROM public.whatsapp_numbers w
   WHERE w.tenant_id = l.tenant_id AND w.is_active AND COALESCE(w.mundo, 'crc') = 'crc'
   ORDER BY w.is_default DESC, w.created_at LIMIT 1;
  SELECT name INTO v_nome_funil FROM public.crm_pipelines WHERE id = l.pipeline_id;

  -- Funil da central de mesmo nome (IMPLANTE → Implante); senão o principal.
  SELECT p.id INTO v_pipe FROM public.crm_pipelines p
   WHERE p.tenant_id = l.tenant_id AND NOT COALESCE(p.is_instagram, false) AND NOT COALESCE(p.is_posvenda, false)
     AND (p.allowed_roles IS NULL OR cardinality(p.allowed_roles) = 0 OR 'crc' = ANY (p.allowed_roles::text[]))
     AND lower(unaccent(btrim(p.name))) = lower(unaccent(btrim(COALESCE(v_nome_funil, ''))))
   LIMIT 1;
  IF v_pipe IS NULL THEN
    SELECT p.id INTO v_pipe FROM public.crm_pipelines p
     WHERE p.tenant_id = l.tenant_id AND NOT COALESCE(p.is_instagram, false) AND NOT COALESCE(p.is_posvenda, false)
       AND (p.allowed_roles IS NULL OR cardinality(p.allowed_roles) = 0 OR 'crc' = ANY (p.allowed_roles::text[]))
     ORDER BY COALESCE(p.is_default, false) DESC, (p.name ILIKE '%principal%') DESC, p.created_at LIMIT 1;
  END IF;
  SELECT s.id INTO v_stage FROM public.crm_stages s
   WHERE s.pipeline_id = v_pipe AND COALESCE(s.is_won, false)
     AND lower(unaccent(s.name)) LIKE '%contratad%' AND lower(unaccent(s.name)) NOT LIKE '%nao contrat%'
   ORDER BY s.position LIMIT 1;
  IF v_pipe IS NULL OR v_stage IS NULL THEN
    RAISE EXCEPTION 'Central sem funil com etapa Contratado para receber o lead %', p_lead;
  END IF;

  -- A central já tem este telefone? Junta o lead do closer nele.
  SELECT x.id INTO v_central FROM public.crm_leads x
   WHERE x.tenant_id = l.tenant_id AND x.phone = l.phone AND x.id <> l.id
     AND public.mundo_numero_whatsapp(x.tenant_id, x.whatsapp_number_id) = 'crc'
   ORDER BY x.created_at LIMIT 1;
  IF v_central IS NOT NULL THEN
    PERFORM public.mesclar_lead_no_closer(l.id, v_central, NULL);
    v_alvo := v_central;
    PERFORM public.lead_transferir_autorizado(v_alvo, jsonb_build_object(
      'pipeline_id', v_pipe, 'stage_id', v_stage, 'veio_da_equipe', 'closer'));
  ELSE
    v_alvo := l.id;
    PERFORM public.lead_transferir_autorizado(v_alvo, jsonb_build_object(
      'assigned_to', v_gestor, 'pipeline_id', v_pipe, 'stage_id', v_stage,
      'whatsapp_number_id', v_numero, 'veio_da_equipe', 'closer'));
  END IF;

  INSERT INTO public.messages (lead_id, tenant_id, direction, type, status, content)
  VALUES (v_alvo, l.tenant_id, 'outbound', 'system', 'system',
          '💰 Pagamento no Dontus sem registro do closer em 1 dia — o lead foi para Contratado da central.');
  RETURN v_alvo;
END $function$;
REVOKE ALL ON FUNCTION public.closer_contrato_vai_para_central(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.closer_contrato_vai_para_central(uuid) TO service_role;
