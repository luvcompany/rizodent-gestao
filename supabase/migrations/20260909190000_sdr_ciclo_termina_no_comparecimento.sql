-- Rodízio de SDRs — o ciclo da SDR termina no comparecimento.
--
-- Decisão do dono (09/09/2026): "as SDRs não são responsáveis por contratação
-- ou não contratação. Elas ganham por comparecimento." Confirmado: (1) lead que
-- COMPARECEU passa para o administrador (crédito do agendamento continua com a
-- SDR — responsavel_credito_id é imutável); (2) lead que NÃO compareceu fica
-- com a SDR, que reagenda. Contratou/não contratou é dado do administrador e do
-- Dontus: some do funil e do relatório da SDR; fica no Relatório das SDRs do
-- gestor, por crédito.

-- ---------------------------------------------------------------- 1. livro: fase nova
DO $do$
DECLARE v_con text;
BEGIN
  SELECT conname INTO v_con FROM pg_constraint
   WHERE conrelid = 'public.crm_lead_atribuicoes'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%fase%';
  IF v_con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.crm_lead_atribuicoes DROP CONSTRAINT %I', v_con);
  END IF;
  ALTER TABLE public.crm_lead_atribuicoes ADD CONSTRAINT crm_lead_atribuicoes_fase_check
    CHECK (fase IN ('reserva','aplicacao','corte_9h','realocacao_1h','manual','saneamento','sombra','comparecimento'));
END $do$;

-- ---------------------------------------------------------------- 2. etapas que a SDR não vê
ALTER TABLE public.crm_stages ADD COLUMN IF NOT EXISTS visivel_para_sdr boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.crm_stages.visivel_para_sdr IS
  'false = etapa depois do comparecimento (Contratado, Não contratado, Compareceu…): não aparece para o papel sdr; lead de SDR que entrar nela passa para o administrador.';
UPDATE public.crm_stages SET visivel_para_sdr = false
 WHERE public.normaliza_nome_etapa(name) IN ('contratado', 'nao contratado', 'compareceu', 'compareceu e agendou');

DROP POLICY IF EXISTS sdr_escopo_crm_stages_visiveis ON public.crm_stages;
CREATE POLICY sdr_escopo_crm_stages_visiveis ON public.crm_stages
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role)) OR visivel_para_sdr);

-- ---------------------------------------------------------------- 3. a entrega ao administrador
-- Interna (sem EXECUTE para authenticated): só os gatilhos chamam.
CREATE OR REPLACE FUNCTION public.sdr_entrega_lead_ao_gestor(p_lead_id uuid, p_motivo text, p_mensagem text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE l public.crm_leads; v_gestor uuid; v_sdr_nome text;
BEGIN
  SELECT * INTO l FROM public.crm_leads WHERE id = p_lead_id;
  IF NOT FOUND OR l.assigned_to IS NULL THEN RETURN false; END IF;
  IF NOT public.has_role(l.assigned_to, 'sdr'::app_role) THEN RETURN false; END IF;
  SELECT c.gestor_user_id INTO v_gestor FROM public.crm_rodizio_config c WHERE c.tenant_id = l.tenant_id;
  IF v_gestor IS NULL OR v_gestor = l.assigned_to THEN RETURN false; END IF;
  SELECT p.nome INTO v_sdr_nome FROM public.profiles p WHERE p.id = l.assigned_to;

  PERFORM set_config('rodizio.autorizado', 'sim', true);
  UPDATE public.crm_leads
     SET assigned_to = v_gestor, rodizio_reservado_para = NULL, rodizio_reservado_em = NULL, updated_at = now()
   WHERE id = l.id AND assigned_to = l.assigned_to;
  IF NOT FOUND THEN RETURN false; END IF;

  INSERT INTO public.crm_lead_atribuicoes (tenant_id, lead_id, lead_nome, lead_telefone, de_user_id, para_user_id, fase, motivo)
  VALUES (l.tenant_id, l.id, l.name, l.phone, l.assigned_to, v_gestor, 'comparecimento', p_motivo);
  INSERT INTO public.messages (lead_id, tenant_id, direction, type, content, status)
  VALUES (l.id, l.tenant_id, 'outbound', 'system',
          COALESCE(p_mensagem, '✅ Compareceu') || ' — lead passou para o administrador; crédito de agendamento continua com '
          || COALESCE(v_sdr_nome, 'a SDR'), 'system');
  RETURN true;
END $fn$;
REVOKE ALL ON FUNCTION public.sdr_entrega_lead_ao_gestor(uuid, text, text) FROM PUBLIC, anon, authenticated;

-- 3a. Comparecimento registrado na consulta (pela SDR, pelo CRC ou pelo Dontus).
CREATE OR REPLACE FUNCTION public.sdr_comparecimento_entrega()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NEW.lead_id IS NULL OR NEW.status NOT IN ('contracted', 'not_contracted') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  BEGIN
    PERFORM public.sdr_entrega_lead_ao_gestor(NEW.lead_id,
      'compareceu em ' || to_char(NEW.scheduled_date, 'DD/MM') || ' (' || NEW.status || ')', '✅ Compareceu');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'sdr_comparecimento_entrega: % (lead %)', SQLERRM, NEW.lead_id;
  END;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_zz_comparecimento_entrega ON public.crm_appointments;
CREATE TRIGGER trg_zz_comparecimento_entrega
  AFTER INSERT OR UPDATE OF status ON public.crm_appointments
  FOR EACH ROW EXECUTE FUNCTION public.sdr_comparecimento_entrega();

-- 3b. Lead de SDR movido à mão para uma etapa do administrador (Contratado…).
CREATE OR REPLACE FUNCTION public.sdr_etapa_oculta_entrega()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_nome text; v_visivel boolean;
BEGIN
  IF NEW.stage_id IS NULL OR NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN RETURN NEW; END IF;
  SELECT s.name, s.visivel_para_sdr INTO v_nome, v_visivel FROM public.crm_stages s WHERE s.id = NEW.stage_id;
  IF COALESCE(v_visivel, true) THEN RETURN NEW; END IF;
  BEGIN
    PERFORM public.sdr_entrega_lead_ao_gestor(NEW.id, 'etapa "' || v_nome || '" é do administrador', '📂 Etapa ' || v_nome);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'sdr_etapa_oculta_entrega: % (lead %)', SQLERRM, NEW.id;
  END;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_zz_etapa_oculta_entrega ON public.crm_leads;
CREATE TRIGGER trg_zz_etapa_oculta_entrega
  AFTER UPDATE OF stage_id ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION public.sdr_etapa_oculta_entrega();

-- ---------------------------------------------------------------- 4. relatório da SDR sem contratos
CREATE OR REPLACE FUNCTION public.relatorio_sdr_minha(p_de date, p_ate date)
RETURNS TABLE (
  user_id uuid, nome text, email text, no_rodizio boolean, bloqueada boolean,
  leads_recebidos integer, leads_respondidos integer, resp_amostra integer, resp_mediana_seg integer, resp_media_seg integer,
  agendamentos integer, compareceram integer, faltas integer, contratados integer, agend_cancelados integer,
  conversas_fechadas integer, pesquisa_respostas integer, pesquisa_nota_media numeric,
  minutos_expediente integer, minutos_pausa integer, is_total boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_tenant uuid := public.current_tenant_id();
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'sdr'::app_role) THEN
    RAISE EXCEPTION 'Este relatório é da SDR.' USING ERRCODE = '42501';
  END IF;
  IF v_tenant IS NULL THEN RETURN; END IF;
  IF p_de IS NULL OR p_ate IS NULL OR p_de > p_ate THEN
    RAISE EXCEPTION 'Período inválido: a data inicial precisa ser menor ou igual à final.' USING ERRCODE = '22007';
  END IF;
  IF (p_ate - p_de) > 400 THEN
    RAISE EXCEPTION 'Período muito longo: escolha no máximo 400 dias.' USING ERRCODE = '22023';
  END IF;
  -- Contratos não fazem parte do perfil da SDR (decisão do dono): a coluna sai NULL.
  RETURN QUERY
  SELECT c.user_id, c.nome, c.email, c.no_rodizio, c.bloqueada,
         c.leads_recebidos, c.leads_respondidos, c.resp_amostra, c.resp_mediana_seg, c.resp_media_seg,
         c.agendamentos, c.compareceram, c.faltas, NULL::integer AS contratados, c.agend_cancelados,
         c.conversas_fechadas, c.pesquisa_respostas, c.pesquisa_nota_media,
         c.minutos_expediente, c.minutos_pausa, c.is_total
    FROM public.relatorio_sdr_calc(v_tenant, p_de, p_ate, auth.uid(), false) c;
END $fn$;

-- ---------------------------------------------------------------- 5. saneamento: leads de SDR já em etapa do administrador
SELECT public.sdr_entrega_lead_ao_gestor(l.id, 'saneamento: já estava em etapa do administrador', '📂 Etapa do administrador')
  FROM public.crm_leads l JOIN public.crm_stages s ON s.id = l.stage_id
 WHERE NOT s.visivel_para_sdr
   AND l.assigned_to IN (SELECT ur.user_id FROM public.user_roles ur WHERE ur.role = 'sdr'::app_role);
