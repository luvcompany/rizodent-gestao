-- Entrega ao administrador: reconferir a CONSULTA que a motivou (achado do
-- ensaio d3 de 09/09). A reconferência de 20260909230000 olhava "alguma
-- consulta com comparecimento" — um lead com comparecimento antigo (de outro
-- ciclo) era entregue mesmo com o desfecho novo corrigido para falta. Agora a
-- entrega agendada guarda a consulta (appointment_id) e só entrega se ESSA
-- consulta continua com comparecimento ou se o lead está em etapa do
-- administrador. Sem consulta guardada (agendada pela etapa), vale a etapa.

ALTER TABLE public.crm_entregas_gestor ADD COLUMN IF NOT EXISTS appointment_id uuid;

DROP FUNCTION IF EXISTS public.sdr_agenda_entrega_ao_gestor(uuid, text, text);
CREATE OR REPLACE FUNCTION public.sdr_agenda_entrega_ao_gestor(p_lead_id uuid, p_motivo text, p_mensagem text, p_appointment_id uuid DEFAULT NULL)
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
    -- já agendada: só completa a consulta, se a primeira marcação veio da etapa
    UPDATE public.crm_entregas_gestor SET appointment_id = COALESCE(appointment_id, p_appointment_id)
     WHERE lead_id = l.id AND de_user_id = l.assigned_to;
    RETURN 'ja_agendada';
  END IF;

  v_quando := now() + make_interval(mins => v_min);
  v_txt := CASE WHEN v_min % 1440 = 0 THEN (v_min / 1440)::text || CASE WHEN v_min / 1440 = 1 THEN ' dia' ELSE ' dias' END
                WHEN v_min % 60 = 0 THEN (v_min / 60)::text || ' h'
                ELSE v_min::text || ' min' END;
  INSERT INTO public.crm_entregas_gestor (lead_id, tenant_id, de_user_id, motivo, mensagem, entregar_em, appointment_id)
  VALUES (l.id, l.tenant_id, l.assigned_to, p_motivo, p_mensagem, v_quando, p_appointment_id)
  ON CONFLICT (lead_id) DO UPDATE
    SET de_user_id = EXCLUDED.de_user_id, motivo = EXCLUDED.motivo, mensagem = EXCLUDED.mensagem,
        entregar_em = EXCLUDED.entregar_em, appointment_id = EXCLUDED.appointment_id, criado_em = now();
  PERFORM public.rodizio_msg_sistema(l.id, l.tenant_id,
    COALESCE(p_mensagem, '✅ Compareceu') || ' — o lead passa para o administrador em ' || v_txt
    || ' (' || to_char(v_quando AT TIME ZONE public.rodizio_tz(l.tenant_id), 'DD/MM HH24:MI') || '); até lá continua com '
    || public.rodizio_nome(l.assigned_to));
  RETURN 'agendada';
END $fn$;
REVOKE ALL ON FUNCTION public.sdr_agenda_entrega_ao_gestor(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sdr_comparecimento_entrega()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NEW.lead_id IS NULL OR NEW.status NOT IN ('contracted', 'not_contracted') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  BEGIN
    PERFORM public.sdr_agenda_entrega_ao_gestor(NEW.lead_id,
      'compareceu em ' || to_char(NEW.scheduled_date, 'DD/MM') || ' (' || NEW.status || ')', '✅ Compareceu', NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'sdr_comparecimento_entrega: % (lead %)', SQLERRM, NEW.lead_id;
  END;
  RETURN NEW;
END $fn$;

CREATE OR REPLACE FUNCTION public.sdr_entregas_pendentes()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET lock_timeout TO '5s' AS $fn$
DECLARE e record; l public.crm_leads; v_n integer := 0; v_fechado boolean;
BEGIN
  FOR e IN SELECT * FROM public.crm_entregas_gestor WHERE entregar_em <= now() ORDER BY entregar_em LIMIT 200 LOOP
    BEGIN
      SELECT * INTO l FROM public.crm_leads WHERE id = e.lead_id;
      -- A dona ainda é quem estava na hora da marcação? Se alguém transferiu
      -- no meio da carência, quem transferiu decidiu: a entrega agendada cai.
      IF FOUND AND l.assigned_to = e.de_user_id THEN
        -- O ciclo continua encerrado? Etapa do administrador, ou A CONSULTA que
        -- motivou a entrega ainda com comparecimento (desfecho corrigido para
        -- falta/pendente e lead de volta a etapa visível = está reagendando).
        v_fechado := EXISTS (SELECT 1 FROM public.crm_stages s WHERE s.id = l.stage_id AND NOT COALESCE(s.visivel_para_sdr, true))
                  OR (e.appointment_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.crm_appointments a
                                                                WHERE a.id = e.appointment_id AND a.status IN ('contracted', 'not_contracted')))
                  OR (e.appointment_id IS NULL AND EXISTS (SELECT 1 FROM public.crm_appointments a
                                                            WHERE a.lead_id = l.id AND a.status IN ('contracted', 'not_contracted')
                                                              AND a.updated_at >= e.criado_em - interval '1 hour'));
        IF v_fechado THEN
          IF public.sdr_entrega_lead_ao_gestor(e.lead_id, COALESCE(e.motivo, 'comparecimento') || ' (após carência)', e.mensagem) THEN
            v_n := v_n + 1;
          END IF;
        ELSE
          PERFORM public.rodizio_livro(l, e.de_user_id, NULL, 'saneamento',
            'entrega ao administrador cancelada: desfecho/etapa foram corrigidos durante a carência', NULL);
          PERFORM public.rodizio_msg_sistema(l.id, l.tenant_id,
            '↩️ Entrega ao administrador cancelada: o desfecho foi corrigido durante a carência; o lead continua com ' || public.rodizio_nome(l.assigned_to));
        END IF;
      END IF;
      DELETE FROM public.crm_entregas_gestor WHERE lead_id = e.lead_id AND entregar_em = e.entregar_em;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'sdr_entregas_pendentes: % (lead %)', SQLERRM, e.lead_id;
    END;
  END LOOP;
  RETURN v_n;
END $fn$;
