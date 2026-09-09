-- lovable-cron-fallback-reviewed: 288 runs/day; entrega do lead na hora marcada (carência configurável), cadência definida no repositório
-- Carência antes de o lead passar ao administrador — decisão do dono
-- (09/09/2026, à noite):
--   "Quando marquei o lead como compareceu, ele foi na hora para o usuário
--    crc e sumiu das conversas da SDR. Se ela quiser falar mais alguma coisa
--    com ele depois disso não consegue — teria que esperar um tempo antes de
--    fazer essa troca."
--   "A SDR só olha quem compareceu no dia seguinte. Se o Dontus marcar o lead
--    como contratado e ele for movido para Contratado em seguida, pode quebrar
--    o relatório de comparecimentos da SDR."
--
-- O que muda: o comparecimento (marcado pela SDR, pelo CRC ou pelo
-- dontus-sync) e a mudança para etapa do administrador (Contratado, Não
-- contratado, Compareceu…) continuam ENCERRANDO o ciclo da SDR, mas a entrega
-- ao administrador só acontece depois de uma CARÊNCIA:
-- crm_rodizio_config.entrega_gestor_apos_min (padrão 1440 = 24 h; 0 = na
-- hora, comportamento anterior). No intervalo a SDR segue dona do lead: vê,
-- responde, liga, marca desfecho. A entrega fica anotada em
-- crm_entregas_gestor e o cron sdr-entrega-ao-gestor (5 em 5 min) executa.
--
-- O relatório de comparecimentos NÃO depende disso: conta o desfecho da
-- consulta (contracted + not_contracted) pelo crédito carimbado na criação
-- (crm_appointments.responsavel_credito_id, imutável), seja quem for que
-- marcou — o dontus-sync grava exatamente esses dois status. O que a carência
-- resolve é a SDR perder o acesso à conversa antes de olhar o lead.
--
-- Se a dona mudar no meio da carência (transferência consciente), a entrega
-- agendada é descartada: quem transferiu decidiu. A realocação por silêncio
-- continua valendo (regra "a não ser que fique muito tempo sem resposta").

-- ---------------------------------------------------------------- 1. configuração
ALTER TABLE public.crm_rodizio_config
  ADD COLUMN IF NOT EXISTS entrega_gestor_apos_min integer NOT NULL DEFAULT 1440;
COMMENT ON COLUMN public.crm_rodizio_config.entrega_gestor_apos_min IS
  'Minutos entre o comparecimento (ou etapa do administrador) e a entrega do lead da SDR ao administrador. 0 = na hora.';

-- ---------------------------------------------------------------- 2. entregas agendadas
-- Deny-all para authenticated: só funções SECURITY DEFINER leem/gravam.
CREATE TABLE IF NOT EXISTS public.crm_entregas_gestor (
  lead_id uuid PRIMARY KEY REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  de_user_id uuid NOT NULL,
  motivo text,
  mensagem text,
  entregar_em timestamptz NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_entregas_gestor_quando_idx ON public.crm_entregas_gestor (entregar_em);
ALTER TABLE public.crm_entregas_gestor ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crm_entregas_gestor FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.crm_entregas_gestor TO service_role;

-- ---------------------------------------------------------------- 3. agendar (ou entregar na hora)
-- Interna: chamada pelos gatilhos de comparecimento e de etapa oculta.
-- A primeira marcação manda: o gatilho da consulta e o da etapa disparam os
-- dois no mesmo desfecho, e a segunda chamada só devolve 'ja_agendada'.
CREATE OR REPLACE FUNCTION public.sdr_agenda_entrega_ao_gestor(p_lead_id uuid, p_motivo text, p_mensagem text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE l public.crm_leads; v_gestor uuid; v_min integer; v_quando timestamptz; v_txt text;
BEGIN
  SELECT * INTO l FROM public.crm_leads WHERE id = p_lead_id;
  IF NOT FOUND OR l.assigned_to IS NULL THEN RETURN 'sem_dona'; END IF;
  IF NOT public.has_role(l.assigned_to, 'sdr'::app_role) THEN RETURN 'nao_e_sdr'; END IF;
  SELECT c.gestor_user_id, COALESCE(c.entrega_gestor_apos_min, 0)
    INTO v_gestor, v_min FROM public.crm_rodizio_config c WHERE c.tenant_id = l.tenant_id;
  IF v_gestor IS NULL OR v_gestor = l.assigned_to THEN RETURN 'sem_gestor'; END IF;

  IF v_min <= 0 THEN
    RETURN CASE WHEN public.sdr_entrega_lead_ao_gestor(p_lead_id, p_motivo, p_mensagem) THEN 'entregue' ELSE 'nao_entregue' END;
  END IF;

  IF EXISTS (SELECT 1 FROM public.crm_entregas_gestor e WHERE e.lead_id = l.id AND e.de_user_id = l.assigned_to) THEN
    RETURN 'ja_agendada';
  END IF;

  v_quando := now() + make_interval(mins => v_min);
  v_txt := CASE WHEN v_min % 1440 = 0 THEN (v_min / 1440)::text || CASE WHEN v_min / 1440 = 1 THEN ' dia' ELSE ' dias' END
                WHEN v_min % 60 = 0 THEN (v_min / 60)::text || ' h'
                ELSE v_min::text || ' min' END;
  INSERT INTO public.crm_entregas_gestor (lead_id, tenant_id, de_user_id, motivo, mensagem, entregar_em)
  VALUES (l.id, l.tenant_id, l.assigned_to, p_motivo, p_mensagem, v_quando)
  ON CONFLICT (lead_id) DO UPDATE
    SET de_user_id = EXCLUDED.de_user_id, motivo = EXCLUDED.motivo, mensagem = EXCLUDED.mensagem,
        entregar_em = EXCLUDED.entregar_em, criado_em = now();
  PERFORM public.rodizio_msg_sistema(l.id, l.tenant_id,
    COALESCE(p_mensagem, '✅ Compareceu') || ' — o lead passa para o administrador em ' || v_txt
    || ' (' || to_char(v_quando AT TIME ZONE public.rodizio_tz(l.tenant_id), 'DD/MM HH24:MI') || '); até lá continua com '
    || public.rodizio_nome(l.assigned_to));
  RETURN 'agendada';
END $fn$;
REVOKE ALL ON FUNCTION public.sdr_agenda_entrega_ao_gestor(uuid, text, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- 4. executar as vencidas (cron)
CREATE OR REPLACE FUNCTION public.sdr_entregas_pendentes()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET lock_timeout TO '5s' AS $fn$
DECLARE e record; v_n integer := 0;
BEGIN
  FOR e IN SELECT * FROM public.crm_entregas_gestor WHERE entregar_em <= now() ORDER BY entregar_em LIMIT 200 LOOP
    BEGIN
      -- A dona ainda é quem estava na hora da marcação? Se alguém transferiu
      -- no meio da carência, quem transferiu decidiu: a entrega agendada cai.
      IF EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.id = e.lead_id AND l.assigned_to = e.de_user_id) THEN
        IF public.sdr_entrega_lead_ao_gestor(e.lead_id, COALESCE(e.motivo, 'comparecimento') || ' (após carência)', e.mensagem) THEN
          v_n := v_n + 1;
        END IF;
      END IF;
      DELETE FROM public.crm_entregas_gestor WHERE lead_id = e.lead_id AND entregar_em = e.entregar_em;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'sdr_entregas_pendentes: % (lead %)', SQLERRM, e.lead_id;
    END;
  END LOOP;
  RETURN v_n;
END $fn$;
REVOKE ALL ON FUNCTION public.sdr_entregas_pendentes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sdr_entregas_pendentes() TO service_role;

-- ---------------------------------------------------------------- 5. os gatilhos passam a agendar
-- Mesmos corpos de 20260909190000, trocando a entrega imediata pela agenda.
CREATE OR REPLACE FUNCTION public.sdr_comparecimento_entrega()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NEW.lead_id IS NULL OR NEW.status NOT IN ('contracted', 'not_contracted') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  BEGIN
    PERFORM public.sdr_agenda_entrega_ao_gestor(NEW.lead_id,
      'compareceu em ' || to_char(NEW.scheduled_date, 'DD/MM') || ' (' || NEW.status || ')', '✅ Compareceu');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'sdr_comparecimento_entrega: % (lead %)', SQLERRM, NEW.lead_id;
  END;
  RETURN NEW;
END $fn$;

CREATE OR REPLACE FUNCTION public.sdr_etapa_oculta_entrega()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_nome text; v_visivel boolean;
BEGIN
  IF NEW.stage_id IS NULL OR NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN RETURN NEW; END IF;
  SELECT s.name, s.visivel_para_sdr INTO v_nome, v_visivel FROM public.crm_stages s WHERE s.id = NEW.stage_id;
  IF COALESCE(v_visivel, true) THEN RETURN NEW; END IF;
  BEGIN
    PERFORM public.sdr_agenda_entrega_ao_gestor(NEW.id, 'etapa "' || v_nome || '" é do administrador', '📂 Etapa ' || v_nome);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'sdr_etapa_oculta_entrega: % (lead %)', SQLERRM, NEW.id;
  END;
  RETURN NEW;
END $fn$;
-- (os gatilhos trg_zz_comparecimento_entrega e trg_zz_etapa_oculta_entrega
--  continuam apontando para estas funções; nada a recriar)

-- ---------------------------------------------------------------- 6. o gestor ajusta a carência
CREATE OR REPLACE FUNCTION public.rodizio_definir_carencia_entrega(p_min integer)
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
  IF p_min IS NULL OR p_min < 0 OR p_min > 10080 THEN
    RAISE EXCEPTION 'Informe um tempo entre 0 (na hora) e 10080 minutos (7 dias).' USING ERRCODE = '22023';
  END IF;
  SELECT entrega_gestor_apos_min INTO v_antes FROM public.crm_rodizio_config WHERE tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rodízio não configurado para este cliente.' USING ERRCODE = '22023';
  END IF;
  IF v_antes IS DISTINCT FROM p_min THEN
    UPDATE public.crm_rodizio_config SET entrega_gestor_apos_min = p_min WHERE tenant_id = v_tenant;
    INSERT INTO public.access_logs (user_id, tenant_id, context, event, metadata)
    VALUES (auth.uid(), v_tenant, 'tenant', 'rodizio_carencia_entrega', jsonb_build_object('de', v_antes, 'para', p_min));
  END IF;
  RETURN jsonb_build_object('minutos', p_min, 'antes', v_antes);
END $fn$;
REVOKE ALL ON FUNCTION public.rodizio_definir_carencia_entrega(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rodizio_definir_carencia_entrega(integer) TO authenticated, service_role;

-- ---------------------------------------------------------------- 7. rodizio_estado expõe a carência
-- Mesmo corpo de 20260909100000 + 'entrega_gestor_apos_min' e 'entregas_pendentes'.
CREATE OR REPLACE FUNCTION public.rodizio_estado()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_tenant uuid := public.current_tenant_id(); cfg public.crm_rodizio_config; v_tz text; v_local timestamp; v_reservas integer; v_entregas integer;
BEGIN
  IF NOT public.is_gestor_equipe() THEN
    RAISE EXCEPTION 'Você não é o gestor da equipe desta clínica.' USING ERRCODE = '42501';
  END IF;
  IF v_tenant IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO cfg FROM public.crm_rodizio_config WHERE tenant_id = v_tenant;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_tz := public.rodizio_tz(v_tenant);
  v_local := now() AT TIME ZONE v_tz;
  SELECT count(*) INTO v_reservas FROM public.crm_leads x
   WHERE x.tenant_id = v_tenant AND x.rodizio_reservado_para IS NOT NULL AND x.distribuido_em IS NULL;
  SELECT count(*) INTO v_entregas FROM public.crm_entregas_gestor e WHERE e.tenant_id = v_tenant;
  RETURN jsonb_build_object(
    'modo', cfg.modo,
    'modo_alterado_em', cfg.modo_alterado_em,
    'ponteiro_user_id', cfg.ponteiro_user_id,
    'preferir_em_expediente', cfg.preferir_em_expediente,
    'realocar_sem_resposta_min', cfg.realocar_sem_resposta_min,
    'entrega_gestor_apos_min', cfg.entrega_gestor_apos_min,
    'entregas_pendentes', v_entregas,
    'hora_corte', cfg.hora_corte,
    'corte_ate', cfg.corte_ate,
    'auto_encerrar', cfg.auto_encerrar,
    'funil_id', public.rodizio_funil(v_tenant),
    'etapas_entrada', to_jsonb(public.rodizio_etapas_entrada(v_tenant)),
    'fuso', v_tz,
    'agora_local', v_local,
    'em_expediente', public.rodizio_em_expediente(v_tenant, now()),
    'dia_util', public.rodizio_dia_util(v_tenant, v_local::date),
    'reservas_pendentes', v_reservas,
    'reservas_aviso', CASE WHEN cfg.modo <> 'ligado' AND v_reservas > 0
                           THEN 'Há ' || v_reservas || ' reserva(s) pendente(s) com o motor em modo ' || cfg.modo
                                || ': reservas só se aplicam em modo ligado.' END,
    'equipe', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'user_id', p.user_id, 'nome', p.nome, 'estado', p.estado, 'aberta', p.aberta, 'carga', p.carga,
               'reservas', (SELECT count(*) FROM public.crm_leads x
                             WHERE x.tenant_id = v_tenant AND x.rodizio_reservado_para = p.user_id AND x.distribuido_em IS NULL))
             ORDER BY p.ordem)
        FROM public.rodizio_pool(v_tenant) p), '[]'::jsonb));
END $fn$;

-- ---------------------------------------------------------------- 8. cron (idempotente)
DO $do$
DECLARE v_id bigint;
BEGIN
  SELECT jobid INTO v_id FROM cron.job WHERE jobname = 'sdr-entrega-ao-gestor';
  IF v_id IS NOT NULL THEN PERFORM cron.unschedule(v_id); END IF;
  PERFORM cron.schedule('sdr-entrega-ao-gestor', '3,8,13,18,23,28,33,38,43,48,53,58 * * * *',
    $cmd$SELECT public.sdr_entregas_pendentes();$cmd$);
END
$do$;