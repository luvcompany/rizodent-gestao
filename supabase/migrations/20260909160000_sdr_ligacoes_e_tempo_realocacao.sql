-- Rodízio de SDRs — ligações liberadas para a SDR e tempo de realocação ajustável.
--
-- Decisão do dono (09/09/2026): "as apis de ligação não estão aparecendo para
-- o sdr" — a SDR passa a ligar (Api4Com e chamada de WhatsApp) para os leads
-- DELA. O que era bloqueio total (sdr_sem_acesso_*) vira escopo por dona do
-- lead, no mesmo molde das outras tabelas lead-scoped. api4com_config continua
-- fechada (guarda o token da telefonia); o ramal e o token só passam pela edge
-- function api4com-dial, com service role.
--
-- E o tempo da realocação por silêncio (60 min de fábrica) ganha uma RPC para
-- o gestor ajustar pela aba Equipe, sem SQL.

-- 1. Ligações Api4Com: a SDR vê as ligações dos leads dela e o próprio ramal.
DROP POLICY IF EXISTS sdr_sem_acesso_api4com_calls ON public.api4com_calls;
DROP POLICY IF EXISTS sdr_escopo_api4com_calls ON public.api4com_calls;
CREATE POLICY sdr_escopo_api4com_calls ON public.api4com_calls
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role))
         OR (lead_id IS NOT NULL AND public.sdr_pode_ver_lead(lead_id)))
  WITH CHECK ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role))
         OR (lead_id IS NOT NULL AND public.sdr_pode_ver_lead(lead_id)));

DROP POLICY IF EXISTS sdr_sem_acesso_api4com_extensions ON public.api4com_extensions;
DROP POLICY IF EXISTS sdr_escopo_api4com_extensions ON public.api4com_extensions;
CREATE POLICY sdr_escopo_api4com_extensions ON public.api4com_extensions
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role)) OR user_id = auth.uid())
  WITH CHECK ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role)) OR user_id = auth.uid());

-- 2. Chamadas de WhatsApp: as dos leads dela, ou as que ela mesma originou/atendeu.
DROP POLICY IF EXISTS sdr_sem_acesso_whatsapp_calls ON public.whatsapp_calls;
DROP POLICY IF EXISTS sdr_escopo_whatsapp_calls ON public.whatsapp_calls;
CREATE POLICY sdr_escopo_whatsapp_calls ON public.whatsapp_calls
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role))
         OR (lead_id IS NOT NULL AND public.sdr_pode_ver_lead(lead_id))
         OR initiated_by = auth.uid() OR answered_by = auth.uid())
  WITH CHECK ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role))
         OR (lead_id IS NOT NULL AND public.sdr_pode_ver_lead(lead_id))
         OR initiated_by = auth.uid() OR answered_by = auth.uid());

DROP POLICY IF EXISTS sdr_sem_acesso_whatsapp_call_permissions ON public.whatsapp_call_permissions;
DROP POLICY IF EXISTS sdr_escopo_whatsapp_call_permissions ON public.whatsapp_call_permissions;
CREATE POLICY sdr_escopo_whatsapp_call_permissions ON public.whatsapp_call_permissions
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role))
         OR (lead_id IS NOT NULL AND public.sdr_pode_ver_lead(lead_id)))
  WITH CHECK ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role))
         OR (lead_id IS NOT NULL AND public.sdr_pode_ver_lead(lead_id)));

-- 3. Tempo da realocação por silêncio, ajustável pelo gestor (0 desliga a regra).
CREATE OR REPLACE FUNCTION public.rodizio_definir_tempo_realocacao(p_min integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET lock_timeout TO '5s' AS $fn$
DECLARE v_tenant uuid := public.current_tenant_id(); v_antes integer;
BEGIN
  IF NOT public.is_gestor_equipe() THEN
    RAISE EXCEPTION 'Você não é o gestor da equipe desta clínica.' USING ERRCODE = '42501';
  END IF;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Sem cliente ativo.' USING ERRCODE = '42501';
  END IF;
  IF p_min IS NULL OR p_min < 0 OR p_min > 240 THEN
    RAISE EXCEPTION 'Informe um tempo entre 0 (desligado) e 240 minutos.' USING ERRCODE = '22023';
  END IF;
  SELECT realocar_sem_resposta_min INTO v_antes FROM public.crm_rodizio_config WHERE tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rodízio não configurado para este cliente.' USING ERRCODE = '22023';
  END IF;
  IF v_antes IS DISTINCT FROM p_min THEN
    UPDATE public.crm_rodizio_config SET realocar_sem_resposta_min = p_min WHERE tenant_id = v_tenant;
    INSERT INTO public.access_logs (user_id, tenant_id, context, event, metadata)
    VALUES (auth.uid(), v_tenant, 'tenant', 'rodizio_tempo_realocacao', jsonb_build_object('de', v_antes, 'para', p_min));
  END IF;
  RETURN jsonb_build_object('minutos', p_min, 'antes', v_antes);
END $fn$;
REVOKE ALL ON FUNCTION public.rodizio_definir_tempo_realocacao(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rodizio_definir_tempo_realocacao(integer) TO authenticated, service_role;
