-- ============================================================================
-- A PRESENÇA É DA SDR. O "CONTRATADO" ESPERA 24 HORAS.
--
-- Pedido do dono em 17/09/2026:
--   "Preciso que desabilite a função automática que diz se o cliente compareceu
--    ou não compareceu, deixa que a própria sdr faz isso manualmente. Então
--    aguarde 24 horas pra mover pra contratado. Pode já contar o faturamento,
--    mas só move pra contratado ou não contratado depois de 24 hs."
--
-- O que estava acontecendo (mapeamento de 17/09, 5 frentes):
--   1. As passadas do Dontus (crons 30–33) decidiam sozinhas "compareceu" /
--      "faltou" — inclusive por RELÓGIO ("no_show_por_tempo"), que errou 13 dos
--      61 casos de setembro conferidos contra a planilha da gestão. Já estão
--      pausadas desde 17/09 13h; esta migration torna a pausa permanente e
--      desliga a passada por cliente (comparecimento_automatico).
--   2. Pausar não bastava: a importação de pagamento (crons 28/29, de hora em
--      hora) movia o lead para "Contratado" NO MESMO MINUTO — 85 de 86 entradas
--      em Contratado nos últimos 30 dias — e a etapa Contratado é oculta para a
--      SDR: o lead sumia da tela dela antes de ela poder marcar a presença.
--      Hoje mesmo, depois da pausa, o UZIEL (lead da Bia) foi movido às 13h30.
--   3. O gatilho auto_confirm_appointments_on_contracted ainda gravava
--      "contratado" na consulta a cada entrada em Contratado — ou seja, decidia
--      sozinho que o paciente COMPARECEU.
--
-- Como fica:
--   • FATURAMENTO: nada muda. O pagamento entra na hora e os relatórios de
--     receita leem pagamentos, não etapa.
--   • ETAPA: pagamento não move mais o lead na hora. Ele entra numa FILA
--     (crm_contratado_pendente) e só vira "Contratado" depois da carência
--     (crm_rodizio_config.contratado_apos_min = 1440 min na Rizodent).
--   • PRESENÇA: quem marca é a SDR (sdr_marcar_comparecimento /
--     sdr_corrigir_desfecho) ou a gestão pelos botões da tela. NENHUM caminho
--     automático grava "compareceu" numa consulta que ninguém marcou — nem o
--     relógio, nem o Dontus, nem o pagamento, nem a mudança de etapa.
--   • O pagamento só ACRESCENTA contrato ao que uma pessoa já marcou: consulta
--     em "compareceu" (not_contracted) cuja janela contém o pagamento vira
--     "contratou" (contracted). Consulta sem marcação fica sem marcação.
--   • Lead de SDR passa para o administrador no mesmo movimento da etapa —
--     sem o vaivém "Não contratado → Contratado".
--   • Quem manda é gente: se alguém da gestão mudou a etapa à mão durante a
--     espera (ex.: "Não contratado"), a fila não desmente — avisa o gestor.
--   • A entrega de 24 h que já existia (cron 41) continua, mas agora olha o
--     pagamento antes de escolher "Contratado" ou "Não contratado".
--
-- Revisão adversarial (17–19/09, 33 revisores, 15 achados confirmados) mudou
-- esta migration antes de ir ao ar: a promoção pelo pagamento decidia presença
-- em consulta não marcada; a entrega do cron 41 movia sem a bandeira e o
-- gatilho antigo carimbava consulta velha; a fila desmentia decisão da gestão;
-- as funções novas nasciam executáveis por anon/authenticated; um pagamento
-- enfileirava todos os leads em que o paciente é titular.
--
-- Cliente novo continua com o comportamento antigo: contratado_apos_min = 0
-- (move na hora) e comparecimento_automatico = true. Quem liga a espera é a
-- configuração do rodízio de cada clínica.
-- ============================================================================

-- ---------------------------------------------------------------- configuração
ALTER TABLE public.crm_rodizio_config
  ADD COLUMN IF NOT EXISTS contratado_apos_min integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comparecimento_automatico boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.crm_rodizio_config.contratado_apos_min IS
  'Minutos de espera entre o pagamento e a mudança automática de etapa para Contratado. 0 = move na hora (comportamento antigo). Rizodent: 1440 (24 h), decisão do dono em 17/09/2026.';
COMMENT ON COLUMN public.crm_rodizio_config.comparecimento_automatico IS
  'false = quem diz se o paciente compareceu é uma PESSOA (SDR ou gestão). Desliga as passadas de comparecimento do Dontus e a varredura que escondia consulta passada sem desfecho.';

ALTER TABLE public.crm_rodizio_config DROP CONSTRAINT IF EXISTS crm_rodizio_config_contratado_apos_min_chk;
ALTER TABLE public.crm_rodizio_config
  ADD CONSTRAINT crm_rodizio_config_contratado_apos_min_chk
  CHECK (contratado_apos_min >= 0 AND contratado_apos_min <= 10080);

UPDATE public.crm_rodizio_config
   SET contratado_apos_min = 1440,
       comparecimento_automatico = false,
       updated_at = now()
 WHERE tenant_id = '00000000-0000-0000-0000-000000000010'::uuid;

-- ------------------------------------------------------------------- a fila
CREATE TABLE IF NOT EXISTS public.crm_contratado_pendente (
  lead_id    uuid PRIMARY KEY REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  tenant_id  uuid NOT NULL,
  mover_em   timestamptz NOT NULL,
  criado_em  timestamptz NOT NULL DEFAULT now(),
  origem     text NOT NULL DEFAULT 'pagamento',
  tentativas integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS crm_contratado_pendente_mover_em_idx
  ON public.crm_contratado_pendente (mover_em);

COMMENT ON TABLE public.crm_contratado_pendente IS
  'Leads com pagamento esperando a carência para virar "Contratado". Só o servidor escreve e lê (nenhuma policy): quem enche é o gatilho do pagamento, quem esvazia é o cron contratado-apos-carencia.';

ALTER TABLE public.crm_contratado_pendente ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crm_contratado_pendente FROM PUBLIC;
REVOKE ALL ON TABLE public.crm_contratado_pendente FROM anon, authenticated;
GRANT ALL ON TABLE public.crm_contratado_pendente TO service_role;

-- ------------------------------------------------------------------ auxiliares

-- "Esta etapa é a de ganho (Contratado)?" — mesma régua do dontus-sync
-- (isWonContratadoStage): contém "contratad" e não é "não contratado".
CREATE OR REPLACE FUNCTION public.etapa_e_contratado(p_nome text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT public.normaliza_nome_etapa(p_nome) LIKE '%contratad%'
     AND public.normaliza_nome_etapa(p_nome) NOT LIKE '%nao contratad%';
$function$;

-- "Existe pagamento que significa CONTRATO para este lead, entre estas datas?"
--   • só vínculo TITULAR (is_primary): o pagamento de um familiar entra no lead
--     apenas para atribuição de origem e nunca moveu etapa (regra do dontus-sync);
--   • orto em manutenção (recorrencia_orto) não é venda nova;
--   • a clínica do pagamento tem de ser do MESMO tenant do lead.
CREATE OR REPLACE FUNCTION public.lead_tem_pagamento_de_contrato(p_lead_id uuid, p_desde date, p_ate date DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.crm_leads l
      JOIN public.crm_lead_pacientes lp ON lp.lead_id = l.id AND lp.is_primary
      JOIN public.pagamentos p          ON p.paciente_id = lp.paciente_id
      JOIN public.clinicas c            ON c.id = p.clinica_id AND c.tenant_id = l.tenant_id
     WHERE l.id = p_lead_id
       AND p.recorrencia_orto IS NOT TRUE
       AND (p_desde IS NULL OR p.data_pagamento >= p_desde)
       AND (p_ate   IS NULL OR p.data_pagamento <= p_ate)
  );
$function$;

-- Data do pagamento de contrato mais recente do lead (mesmas regras de cima).
CREATE OR REPLACE FUNCTION public.lead_ultimo_pagamento_de_contrato(p_lead_id uuid)
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT max(p.data_pagamento)
    FROM public.crm_leads l
    JOIN public.crm_lead_pacientes lp ON lp.lead_id = l.id AND lp.is_primary
    JOIN public.pagamentos p          ON p.paciente_id = lp.paciente_id
    JOIN public.clinicas c            ON c.id = p.clinica_id AND c.tenant_id = l.tenant_id
   WHERE l.id = p_lead_id
     AND p.recorrencia_orto IS NOT TRUE;
$function$;

-- O pagamento ACRESCENTA contrato a um comparecimento que uma pessoa marcou.
-- Nunca decide presença:
--   • só mexe em consulta 'not_contracted' (alguém marcou "compareceu");
--     'confirmed'/'pending' — ninguém marcou — ficam como estão, para a SDR ou
--     a gestão marcarem (é a ordem do dono de 17/09);
--   • a consulta tem de estar na janela do pagamento — a MESMA régua do
--     dontus-sync (janelaPagamentoDaConsulta: pagamento entre consulta−3 e
--     consulta+30 dias). Sem janela, um pagamento de hoje promoveria uma
--     consulta de agosto;
--   • a consulta já tem de ter acontecido (data + hora, no fuso da clínica);
--   • se o lead já tem uma consulta 'contracted' nessa janela, não promove
--     outra: um contrato, uma consulta.
CREATE OR REPLACE FUNCTION public.contratado_promove_consulta(p_lead_id uuid, p_data_pagamento date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_tz text; v_agora timestamp;
BEGIN
  IF p_data_pagamento IS NULL THEN RETURN NULL; END IF;
  SELECT public.rodizio_tz(l.tenant_id) INTO v_tz FROM public.crm_leads l WHERE l.id = p_lead_id;
  v_agora := (now() AT TIME ZONE COALESCE(v_tz, 'America/Bahia'));

  IF EXISTS (SELECT 1 FROM public.crm_appointments a
              WHERE a.lead_id = p_lead_id AND a.status = 'contracted'
                AND a.scheduled_date BETWEEN p_data_pagamento - 30 AND p_data_pagamento + 3) THEN
    RETURN NULL;
  END IF;

  SELECT a.id INTO v_id
    FROM public.crm_appointments a
   WHERE a.lead_id = p_lead_id
     AND a.status = 'not_contracted'
     AND a.scheduled_date BETWEEN p_data_pagamento - 30 AND p_data_pagamento + 3
     AND (a.scheduled_date + COALESCE(a.scheduled_time, time '00:00')) <= v_agora
   ORDER BY a.scheduled_date DESC, a.scheduled_time DESC NULLS LAST
   LIMIT 1;
  IF v_id IS NULL THEN RETURN NULL; END IF;

  -- outcome_at/outcome_by explícitos: o carimbo automático (stamp_appointment_
  -- update) só cobre a saída de confirmed/pending; aqui a decisão do contrato é
  -- do pagamento, não da SDR que marcou a presença.
  UPDATE public.crm_appointments
     SET status = 'contracted',
         outcome_source = 'pagamento_apos_carencia',
         outcome_at = now(),
         outcome_by = NULL,
         updated_at = now()
   WHERE id = v_id
     AND status = 'not_contracted';

  RETURN v_id;
END $function$;

-- ------------------------------------------------------- mover para Contratado
-- p_apos_carencia = false  → comportamento antigo (cliente com carência 0):
--                            só muda a etapa e deixa os gatilhos fazerem o resto.
-- p_apos_carencia = true   → a passada do cron depois da carência: acrescenta o
--                            contrato à consulta marcada, muda a etapa e entrega
--                            o lead de SDR ao administrador no mesmo movimento.
CREATE OR REPLACE FUNCTION public.contratado_mover_agora(p_lead_id uuid, p_origem text, p_apos_carencia boolean DEFAULT true)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE l public.crm_leads; v_etapa text; v_alvo uuid; v_alvo_nome text;
        v_consulta uuid; v_gestor uuid; v_modo text; v_entregue boolean := false;
        v_flag text;
BEGIN
  SELECT * INTO l FROM public.crm_leads WHERE id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'sem_lead'; END IF;

  SELECT s.name INTO v_etapa FROM public.crm_stages s WHERE s.id = l.stage_id;
  IF v_etapa IS NOT NULL AND public.etapa_e_contratado(v_etapa) THEN RETURN 'ja_contratado'; END IF;

  SELECT s.id, s.name INTO v_alvo, v_alvo_nome
    FROM public.crm_stages s
   WHERE s.pipeline_id = l.pipeline_id AND public.etapa_e_contratado(s.name)
   ORDER BY s.is_won DESC, s.position
   LIMIT 1;
  IF v_alvo IS NULL THEN RETURN 'sem_etapa'; END IF;

  IF NOT p_apos_carencia THEN
    UPDATE public.crm_leads SET stage_id = v_alvo, updated_at = now() WHERE id = l.id;
    RETURN 'movido';
  END IF;

  -- A bandeira avisa os gatilhos de que esta mudança de etapa É a entrega: eles
  -- não abrem OUTRA carência de 24 h, não prometem no chat uma passagem que está
  -- acontecendo agora e não carimbam consulta nenhuma.
  v_flag := COALESCE(current_setting('contratado.movendo', true), '');
  PERFORM set_config('contratado.movendo', 'sim', true);

  v_consulta := public.contratado_promove_consulta(l.id, public.lead_ultimo_pagamento_de_contrato(l.id));

  UPDATE public.crm_leads SET stage_id = v_alvo, updated_at = now() WHERE id = l.id;
  PERFORM public.rodizio_msg_sistema(l.id, l.tenant_id,
    '📂 Etapa: ' || v_alvo_nome || ' — pagamento registrado; a espera terminou');

  IF l.assigned_to IS NOT NULL AND public.has_role(l.assigned_to, 'sdr'::app_role) THEN
    SELECT c.gestor_user_id, c.modo INTO v_gestor, v_modo
      FROM public.crm_rodizio_config c WHERE c.tenant_id = l.tenant_id;
    IF v_gestor IS NOT NULL AND v_gestor IS DISTINCT FROM l.assigned_to THEN
      IF COALESCE(v_modo, '') = 'desligado' THEN
        -- Rodízio congelado: a entrega fica na fila, como em qualquer outro caso.
        PERFORM public.sdr_agenda_entrega_ao_gestor(l.id,
          'pagamento registrado (' || COALESCE(p_origem, 'pagamento') || ')', '💰 Pagamento registrado', v_consulta);
      ELSE
        v_entregue := public.sdr_entrega_lead_ao_gestor(l.id,
          'pagamento registrado (' || COALESCE(p_origem, 'pagamento') || ') — Contratado depois da espera',
          '💰 Pagamento registrado', v_consulta);
        IF v_entregue THEN
          DELETE FROM public.crm_entregas_gestor WHERE lead_id = l.id;
        END IF;
      END IF;
    END IF;
  END IF;

  PERFORM set_config('contratado.movendo', v_flag, true);
  RETURN CASE WHEN v_entregue THEN 'movido_entregue' ELSE 'movido' END;
END $function$;

-- ------------------------------------------------------------ entrar na fila
CREATE OR REPLACE FUNCTION public.contratado_agendar(p_lead_id uuid, p_origem text DEFAULT 'pagamento')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE l public.crm_leads; v_etapa text; v_alvo uuid; v_min integer; v_tz text;
        v_quando timestamptz; v_ins integer; v_txt text; v_dona text;
BEGIN
  SELECT * INTO l FROM public.crm_leads WHERE id = p_lead_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('resultado', 'sem_lead'); END IF;

  SELECT s.name INTO v_etapa FROM public.crm_stages s WHERE s.id = l.stage_id;
  IF v_etapa IS NOT NULL AND public.etapa_e_contratado(v_etapa) THEN
    RETURN jsonb_build_object('resultado', 'ja_contratado');
  END IF;

  SELECT s.id INTO v_alvo FROM public.crm_stages s
   WHERE s.pipeline_id = l.pipeline_id AND public.etapa_e_contratado(s.name)
   ORDER BY s.is_won DESC, s.position LIMIT 1;
  IF v_alvo IS NULL THEN RETURN jsonb_build_object('resultado', 'sem_etapa'); END IF;

  v_tz := COALESCE(public.rodizio_tz(l.tenant_id), 'America/Bahia');
  IF NOT public.lead_tem_pagamento_de_contrato(l.id, ((now() AT TIME ZONE v_tz)::date - 30)) THEN
    RETURN jsonb_build_object('resultado', 'sem_pagamento');
  END IF;

  SELECT COALESCE(c.contratado_apos_min, 0) INTO v_min
    FROM public.crm_rodizio_config c WHERE c.tenant_id = l.tenant_id;
  v_min := COALESCE(v_min, 0);

  IF v_min <= 0 THEN
    RETURN jsonb_build_object('resultado', public.contratado_mover_agora(l.id, p_origem, false));
  END IF;

  SELECT q.mover_em INTO v_quando FROM public.crm_contratado_pendente q WHERE q.lead_id = l.id;
  IF v_quando IS NOT NULL THEN
    RETURN jsonb_build_object('resultado', 'ja_agendado', 'mover_em', v_quando);
  END IF;

  v_quando := now() + make_interval(mins => v_min);
  INSERT INTO public.crm_contratado_pendente (lead_id, tenant_id, mover_em, origem)
  VALUES (l.id, l.tenant_id, v_quando, COALESCE(p_origem, 'pagamento'))
  ON CONFLICT (lead_id) DO NOTHING;
  GET DIAGNOSTICS v_ins = ROW_COUNT;
  IF v_ins = 0 THEN RETURN jsonb_build_object('resultado', 'ja_agendado'); END IF;

  v_txt := CASE WHEN v_min % 1440 = 0 THEN (v_min / 1440)::text || CASE WHEN v_min / 1440 = 1 THEN ' dia' ELSE ' dias' END
                WHEN v_min % 60 = 0 THEN (v_min / 60)::text || ' h'
                ELSE v_min::text || ' min' END;
  v_dona := CASE WHEN l.assigned_to IS NOT NULL THEN public.rodizio_nome(l.assigned_to) END;
  PERFORM public.rodizio_msg_sistema(l.id, l.tenant_id,
    '💰 Pagamento registrado — o faturamento já conta hoje. A etapa muda para Contratado em ' || v_txt
    || ' (' || to_char(v_quando AT TIME ZONE v_tz, 'DD/MM HH24:MI') || ')'
    || CASE WHEN v_dona IS NOT NULL THEN '; até lá o lead continua com ' || v_dona || ', que marca a presença' ELSE '' END);

  RETURN jsonb_build_object('resultado', 'agendado', 'mover_em', v_quando);
END $function$;

-- --------------------------------------------------------- a passada da fila
CREATE OR REPLACE FUNCTION public.contratado_pendentes()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET lock_timeout TO '5s'
AS $function$
DECLARE q record; l public.crm_leads; v_n integer := 0; v_r text; v_tz text; v_gestor uuid;
        v_etapa text; v_etapa_norm text; v_visivel boolean; v_quem uuid;
        v_nome_lead text;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('crm_contratado_pendentes')) THEN RETURN 0; END IF;

  FOR q IN SELECT * FROM public.crm_contratado_pendente WHERE mover_em <= now()
            ORDER BY mover_em LIMIT 200 LOOP
    BEGIN
      SELECT * INTO l FROM public.crm_leads WHERE id = q.lead_id;
      IF NOT FOUND THEN
        DELETE FROM public.crm_contratado_pendente WHERE lead_id = q.lead_id;
        CONTINUE;
      END IF;
      SELECT c.gestor_user_id INTO v_gestor FROM public.crm_rodizio_config c WHERE c.tenant_id = l.tenant_id;
      v_nome_lead := COALESCE(NULLIF(btrim(l.name), ''), l.phone, 'sem nome');

      -- Desistência com aviso: a linha que sempre estoura não pode voltar a cada
      -- 5 minutos para sempre, e o gestor precisa saber que o lead ficou onde está.
      IF COALESCE(q.tentativas, 0) > 5 THEN
        PERFORM public.rodizio_notifica(v_gestor, l.id, 'Lead com pagamento não foi para Contratado',
          'O lead ' || v_nome_lead
          || ' tem pagamento e não pôde ser movido para Contratado depois de 5 tentativas. Mova à mão e avise o suporte.');
        DELETE FROM public.crm_contratado_pendente WHERE lead_id = q.lead_id;
        CONTINUE;
      END IF;

      v_tz := COALESCE(public.rodizio_tz(l.tenant_id), 'America/Bahia');

      -- O pagamento que motivou a espera ainda existe? A varredura do Dontus
      -- apaga pagamento que sumiu de lá — sem esta conferência o lead iria para
      -- Contratado por uma venda que não existe mais.
      IF NOT public.lead_tem_pagamento_de_contrato(l.id, ((q.criado_em AT TIME ZONE v_tz)::date - 30)) THEN
        DELETE FROM public.crm_contratado_pendente WHERE lead_id = q.lead_id;
        PERFORM public.rodizio_msg_sistema(l.id, l.tenant_id,
          'ℹ️ O pagamento que levaria este lead para Contratado não existe mais — a etapa fica como está');
        CONTINUE;
      END IF;

      -- Gente manda. Se, DURANTE a espera, uma pessoa pôs o lead numa etapa de
      -- decisão ("Não contratado", "Não compareceu" ou outra etapa do
      -- administrador), a máquina não desmente: sai da fila e avisa o gestor.
      -- (A SDR marcando "Compareceu" leva o lead para uma etapa visível que não
      -- é de decisão — isso não trava a mudança para Contratado.)
      SELECT s.name, public.normaliza_nome_etapa(s.name), COALESCE(s.visivel_para_sdr, true)
        INTO v_etapa, v_etapa_norm, v_visivel
        FROM public.crm_stages s WHERE s.id = l.stage_id;
      SELECT h.changed_by INTO v_quem
        FROM public.crm_lead_stage_history h
       WHERE h.lead_id = l.id AND h.stage_id = l.stage_id AND h.exited_at IS NULL
       ORDER BY h.entered_at DESC LIMIT 1;
      IF v_quem IS NOT NULL
         AND EXISTS (SELECT 1 FROM public.crm_lead_stage_history h
                      WHERE h.lead_id = l.id AND h.stage_id = l.stage_id AND h.exited_at IS NULL
                        AND h.entered_at > q.criado_em)
         AND NOT public.etapa_e_contratado(v_etapa)
         AND (NOT v_visivel OR v_etapa_norm IN ('nao contratado', 'nao compareceu')) THEN
        DELETE FROM public.crm_contratado_pendente WHERE lead_id = q.lead_id;
        PERFORM public.rodizio_notifica(v_gestor, l.id, 'Lead com pagamento ficou fora de Contratado',
          'O lead ' || v_nome_lead || ' tem pagamento, mas ' || COALESCE(public.rodizio_nome(v_quem), 'alguém da equipe')
          || ' o moveu para "' || btrim(v_etapa) || '" durante a espera de 24 h. A mudança para Contratado foi cancelada — confira e mova à mão se for o caso.');
        PERFORM public.rodizio_msg_sistema(l.id, l.tenant_id,
          'ℹ️ Pagamento registrado, mas o lead foi posto em "' || btrim(v_etapa) || '" por uma pessoa durante a espera — a etapa não foi mudada para Contratado');
        CONTINUE;
      END IF;

      v_r := public.contratado_mover_agora(l.id, q.origem, true);
      DELETE FROM public.crm_contratado_pendente WHERE lead_id = q.lead_id;
      IF v_r LIKE 'movido%' THEN
        v_n := v_n + 1;
      ELSIF v_r IN ('sem_etapa', 'sem_lead') THEN
        -- O funil do lead mudou durante a espera para um que não tem Contratado.
        PERFORM public.rodizio_notifica(v_gestor, l.id, 'Lead com pagamento não foi para Contratado',
          'O lead ' || v_nome_lead || ' tem pagamento, mas o funil atual dele não tem a etapa Contratado. Mova à mão se for o caso.');
      END IF;

    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'contratado_pendentes: % (lead %)', SQLERRM, q.lead_id;
      BEGIN
        UPDATE public.crm_contratado_pendente
           SET tentativas = COALESCE(tentativas, 0) + 1,
               mover_em = now() + make_interval(mins => 30 * (COALESCE(tentativas, 0) + 1))
         WHERE lead_id = q.lead_id;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END;
  END LOOP;

  RETURN v_n;
END $function$;

-- ------------------------------------------------- o pagamento enche a fila
-- Pagamento do Dontus (dontus_key preenchida) NÃO passa por aqui: o sync
-- escolhe o lead certo (casamento por telefone/nome, família de fora, um lead
-- por paciente) e chama contratado_agendar ele mesmo. Este gatilho cobre as
-- outras portas — o lançamento manual da tela Novo Atendimento — e escolhe UM
-- lead: o titular mais recente do paciente (12 pacientes são titulares em mais
-- de um lead; mandar todos para Contratado seria inventar venda).
CREATE OR REPLACE FUNCTION public.contratado_apos_pagamento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_lead uuid;
BEGIN
  IF NEW.recorrencia_orto IS TRUE OR NEW.dontus_key IS NOT NULL THEN RETURN NEW; END IF;
  BEGIN
    SELECT lp.lead_id INTO v_lead
      FROM public.crm_lead_pacientes lp
      JOIN public.crm_leads l ON l.id = lp.lead_id
      JOIN public.clinicas c  ON c.id = NEW.clinica_id AND c.tenant_id = l.tenant_id
     WHERE lp.paciente_id = NEW.paciente_id
       AND lp.is_primary
     ORDER BY l.created_at DESC
     LIMIT 1;
    IF v_lead IS NOT NULL THEN
      PERFORM public.contratado_agendar(v_lead, 'pagamento_manual');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Receita nunca pode falhar por causa da etapa.
    RAISE WARNING 'contratado_apos_pagamento: % (pagamento %)', SQLERRM, NEW.id;
  END;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_zz_contratado_apos_pagamento ON public.pagamentos;
CREATE TRIGGER trg_zz_contratado_apos_pagamento
AFTER INSERT ON public.pagamentos
FOR EACH ROW EXECUTE FUNCTION public.contratado_apos_pagamento();

-- Vínculo que nasce DEPOIS do pagamento (o paciente pagou sem telefone e o lead
-- só foi encontrado dias depois). Só vale vínculo feito pelo servidor ou pela
-- gestão: a policy de INSERT de crm_lead_pacientes aceita qualquer usuário
-- logado, e um vínculo feito por qualquer um não pode virar venda.
CREATE OR REPLACE FUNCTION public.contratado_apos_vinculo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT COALESCE(NEW.is_primary, false) THEN RETURN NEW; END IF;
  IF auth.uid() IS NOT NULL
     AND NOT (public.has_role(auth.uid(), 'crc'::app_role)
              OR public.has_role(auth.uid(), 'gerente'::app_role)
              OR public.has_role(auth.uid(), 'superadmin'::app_role)) THEN
    RETURN NEW;
  END IF;
  BEGIN
    -- Só pagamento IMPORTADO nos últimos 7 dias: vínculo novo para paciente com
    -- pagamento antigo é histórico, não venda de agora.
    IF EXISTS (
      SELECT 1
        FROM public.pagamentos p
        JOIN public.crm_leads l ON l.id = NEW.lead_id
        JOIN public.clinicas c  ON c.id = p.clinica_id AND c.tenant_id = l.tenant_id
       WHERE p.paciente_id = NEW.paciente_id
         AND p.recorrencia_orto IS NOT TRUE
         AND p.created_at >= now() - interval '7 days'
    ) THEN
      PERFORM public.contratado_agendar(NEW.lead_id, 'vinculo_com_pagamento');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'contratado_apos_vinculo: % (lead %)', SQLERRM, NEW.lead_id;
  END;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_zz_contratado_apos_vinculo ON public.crm_lead_pacientes;
CREATE TRIGGER trg_zz_contratado_apos_vinculo
AFTER INSERT ON public.crm_lead_pacientes
FOR EACH ROW EXECUTE FUNCTION public.contratado_apos_vinculo();

-- ================================================================= gatilhos

-- O gatilho que gravava "contratado" na consulta a cada entrada em Contratado
-- era uma decisão AUTOMÁTICA de comparecimento: o sync movia o lead e o gatilho
-- dizia que o paciente veio. Agora:
--   • movimento feito por máquina (auth.uid() nulo: sync, cron 36, entrega do
--     cron 41, fila das 24 h) NUNCA carimba consulta — quem decide desfecho é
--     gente, e o contrato vindo de pagamento é tratado por
--     contratado_promove_consulta, só sobre o que a SDR já marcou;
--   • movimento HUMANO (o gestor arrasta o card para Contratado) continua
--     carimbando — é a pessoa dizendo "contratou" —, mas só na consulta que já
--     aconteceu (data + hora) e nos últimos 7 dias. Antes carimbava a consulta
--     das 14h30 quando o card era arrastado às 13h12 (ensaio de 17/09), e
--     qualquer consulta velha esquecida em 'confirmed'.
CREATE OR REPLACE FUNCTION public.auto_confirm_appointments_on_contracted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_stage_name text;
  v_normalized text;
  v_is_contracted boolean := false;
  v_appt_id uuid;
  v_agora timestamp := (now() AT TIME ZONE 'America/Bahia');
BEGIN
  IF NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
    RETURN NEW;
  END IF;

  IF COALESCE(current_setting('contratado.movendo', true), '') = 'sim' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT name INTO v_stage_name FROM public.crm_stages WHERE id = NEW.stage_id;
  IF v_stage_name IS NULL THEN
    RETURN NEW;
  END IF;

  v_normalized := lower(translate(v_stage_name,
    'ÁÀÃÂÄáàãâäÉÈÊËéèêëÍÌÎÏíìîïÓÒÕÔÖóòõôöÚÙÛÜúùûüÇç',
    'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc'));

  IF (v_normalized = 'contratado' OR v_normalized = 'contratados'
      OR (v_normalized LIKE '%contrat%' AND v_normalized NOT LIKE '%nao contrat%'))
  THEN
    v_is_contracted := true;
  END IF;

  IF NOT v_is_contracted THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_appt_id
    FROM public.crm_appointments
   WHERE lead_id = NEW.id
     AND status = 'confirmed'
     AND (scheduled_date + COALESCE(scheduled_time, time '00:00')) <= v_agora
     AND scheduled_date >= v_agora::date - 7
   ORDER BY scheduled_date DESC, scheduled_time DESC NULLS LAST
   LIMIT 1;

  IF v_appt_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.crm_appointments
     SET status = 'contracted',
         outcome_source = 'auto_stage_contratado',
         updated_at = now()
   WHERE id = v_appt_id;

  RETURN NEW;
END;
$function$;

-- As duas carências (etapa oculta e desfecho da consulta) não podem abrir uma
-- NOVA espera de 24 h no meio da entrega que já está acontecendo.
CREATE OR REPLACE FUNCTION public.sdr_etapa_oculta_entrega()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_nome text; v_visivel boolean;
BEGIN
  IF NEW.stage_id IS NULL OR NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN RETURN NEW; END IF;
  IF COALESCE(current_setting('contratado.movendo', true), '') = 'sim' THEN RETURN NEW; END IF;
  SELECT s.name, s.visivel_para_sdr INTO v_nome, v_visivel FROM public.crm_stages s WHERE s.id = NEW.stage_id;
  IF COALESCE(v_visivel, true) AND public.normaliza_nome_etapa(v_nome) IS DISTINCT FROM 'compareceu' THEN
    RETURN NEW;
  END IF;
  BEGIN
    PERFORM public.sdr_agenda_entrega_ao_gestor(NEW.id, 'etapa "' || v_nome || '" fecha o ciclo da SDR', '📂 Etapa ' || v_nome);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'sdr_etapa_oculta_entrega: % (lead %)', SQLERRM, NEW.id;
  END;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.sdr_comparecimento_entrega()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.lead_id IS NULL OR NEW.status NOT IN ('contracted', 'not_contracted') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  IF COALESCE(current_setting('contratado.movendo', true), '') = 'sim' THEN RETURN NEW; END IF;
  BEGIN
    PERFORM public.sdr_agenda_entrega_ao_gestor(NEW.lead_id,
      'compareceu em ' || to_char(NEW.scheduled_date, 'DD/MM') || ' (' || NEW.status || ')', '✅ Compareceu', NEW.id);
  EXCEPTION WHEN OTHERS THEN
    -- Desfecho de consulta nunca pode falhar por causa do rodízio.
    RAISE WARNING 'sdr_comparecimento_entrega: % (lead %)', SQLERRM, NEW.lead_id;
  END;
  RETURN NEW;
END $function$;

-- ------------------------------------------------ a entrega olha o pagamento
-- Antes: a entrega das 24 h escolhia a etapa SÓ pelo status da consulta — a SDR
-- marca "Compareceu" (not_contracted) e o lead ia para "Não contratado" mesmo
-- com o pagamento já importado; depois o sync puxava de volta para Contratado.
-- Agora:
--   • o pagamento na janela da consulta (consulta−3 a consulta+30, a régua do
--     dontus-sync) acrescenta o contrato à consulta que a SDR marcou — e isso
--     vale mesmo se o lead já estiver numa etapa do administrador;
--   • a função inteira roda com a bandeira contratado.movendo: a mudança de
--     etapa daqui é decisão de entrega, e o gatilho antigo não pode carimbar
--     outra consulta (velha, esquecida em 'confirmed') por causa dela.
CREATE OR REPLACE FUNCTION public.sdr_entrega_lead_ao_gestor(p_lead_id uuid, p_motivo text, p_mensagem text, p_appointment_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE l public.crm_leads; v_gestor uuid; v_sdr_nome text;
        v_etapa_atual text; v_visivel boolean; v_status text; v_alvo uuid; v_alvo_nome text;
        v_consulta uuid; v_data date; v_flag text;
BEGIN
  SELECT * INTO l FROM public.crm_leads WHERE id = p_lead_id;
  IF NOT FOUND OR l.assigned_to IS NULL THEN RETURN false; END IF;
  IF NOT public.has_role(l.assigned_to, 'sdr'::app_role) THEN RETURN false; END IF;
  SELECT c.gestor_user_id INTO v_gestor FROM public.crm_rodizio_config c WHERE c.tenant_id = l.tenant_id;
  IF v_gestor IS NULL OR v_gestor = l.assigned_to THEN RETURN false; END IF;
  SELECT p.nome INTO v_sdr_nome FROM public.profiles p WHERE p.id = l.assigned_to;

  v_flag := COALESCE(current_setting('contratado.movendo', true), '');
  PERFORM set_config('contratado.movendo', 'sim', true);

  PERFORM set_config('rodizio.autorizado', 'sim', true);
  UPDATE public.crm_leads
     SET assigned_to = v_gestor, rodizio_reservado_para = NULL, rodizio_reservado_em = NULL, updated_at = now()
   WHERE id = l.id AND assigned_to = l.assigned_to;
  IF NOT FOUND THEN
    -- A autorização é transacional: se ela sobrevive a esta função, a trava de
    -- propriedade do lead fica aberta para todos os outros leads da mesma
    -- transação (o cron entrega em lote). Desligar é parte da entrega.
    PERFORM set_config('rodizio.autorizado', '', true);
    PERFORM set_config('contratado.movendo', v_flag, true);
    RETURN false;
  END IF;

  INSERT INTO public.crm_lead_atribuicoes (tenant_id, lead_id, lead_nome, lead_telefone, de_user_id, para_user_id, fase, motivo)
  VALUES (l.tenant_id, l.id, l.name, l.phone, l.assigned_to, v_gestor, 'comparecimento', p_motivo);
  INSERT INTO public.messages (lead_id, tenant_id, direction, type, content, status)
  VALUES (l.id, l.tenant_id, 'outbound', 'system',
          COALESCE(p_mensagem, '✅ Compareceu') || ' — lead passou para o administrador; crédito de agendamento continua com '
          || COALESCE(v_sdr_nome, 'a SDR'), 'system');

  -- O desfecho da consulta que motivou a entrega (ou, sem consulta guardada, o
  -- desfecho mais recente do lead).
  IF p_appointment_id IS NOT NULL THEN
    SELECT a.id, a.status, a.scheduled_date INTO v_consulta, v_status, v_data
      FROM public.crm_appointments a
     WHERE a.id = p_appointment_id AND a.status IN ('contracted', 'not_contracted');
  ELSE
    SELECT a.id, a.status, a.scheduled_date INTO v_consulta, v_status, v_data
      FROM public.crm_appointments a
     WHERE a.lead_id = l.id AND a.status IN ('contracted', 'not_contracted')
     ORDER BY a.scheduled_date DESC, a.updated_at DESC NULLS LAST LIMIT 1;
  END IF;

  -- Pagamento acrescenta o contrato ao "compareceu" que a SDR marcou.
  IF v_status = 'not_contracted' AND v_consulta IS NOT NULL
     AND public.lead_tem_pagamento_de_contrato(l.id, v_data - 3, v_data + 30) THEN
    UPDATE public.crm_appointments
       SET status = 'contracted', outcome_source = 'pagamento_apos_carencia',
           outcome_at = now(), outcome_by = NULL, updated_at = now()
     WHERE id = v_consulta AND status = 'not_contracted';
    v_status := 'contracted';
  END IF;

  -- A etapa do desfecho nasce AQUI, e só aqui: enquanto o lead era da SDR ele
  -- tinha de continuar visível para ela.
  SELECT s.name, COALESCE(s.visivel_para_sdr, true) INTO v_etapa_atual, v_visivel
    FROM public.crm_stages s WHERE s.id = l.stage_id;
  -- Lead que um humano já pôs numa etapa do administrador: a escolha dele
  -- manda. A exceção é "Compareceu", que era o destino automático do gatilho
  -- antigo (não é decisão de ninguém) — ali o desfecho ainda precisa aparecer.
  IF (l.stage_id IS NULL OR COALESCE(v_visivel, true)
      OR public.normaliza_nome_etapa(v_etapa_atual) = 'compareceu')
     AND v_status IS NOT NULL THEN
    -- Só uma etapa DO FUNIL DO LEAD (funis por procedimento têm as mesmas etapas).
    SELECT s.id, s.name INTO v_alvo, v_alvo_nome FROM public.crm_stages s
     WHERE s.pipeline_id = l.pipeline_id
       AND public.normaliza_nome_etapa(s.name) = CASE WHEN v_status = 'contracted' THEN 'contratado' ELSE 'nao contratado' END
     ORDER BY s.position LIMIT 1;
    IF v_alvo IS NOT NULL AND v_alvo IS DISTINCT FROM l.stage_id THEN
      UPDATE public.crm_leads SET stage_id = v_alvo, updated_at = now() WHERE id = l.id;
      PERFORM public.rodizio_msg_sistema(l.id, l.tenant_id,
        '📂 Etapa: ' || v_alvo_nome || ' — '
        || CASE WHEN v_status = 'contracted' THEN 'consulta contratada' ELSE 'compareceu e não contratou' END
        || ', agora com o administrador');
    END IF;
  END IF;

  PERFORM set_config('rodizio.autorizado', '', true);
  PERFORM set_config('contratado.movendo', v_flag, true);
  RETURN true;
END $function$;

-- ------------------------------------------------- varredura dos 3 dias parada
-- Com a presença marcada à mão, consulta passada sem desfecho é TRABALHO
-- pendente da SDR/da gestão — não lixo. A varredura das 03h escondia o lead em
-- "Relacionamento" depois de 3 dias e a marcação nunca mais aconteceria.
CREATE OR REPLACE FUNCTION public.varre_agendado_sem_agendamento(p_dry_run boolean DEFAULT true)
 RETURNS TABLE(lead_id uuid, lead_nome text, pipeline_id uuid, de_etapa text, para_etapa text, ultimo_desfecho text, entrou_em timestamp with time zone, motivo text, movido boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_alvo_nome text;
  v_alvo_id uuid;
  v_alvo_label text;
  v_tem_automacao boolean;
  v_manual boolean;
BEGIN
  FOR r IN
    SELECT l.id, l.name, l.tenant_id, l.pipeline_id, l.stage_id, s.name AS etapa,
      (SELECT a.status FROM public.crm_appointments a
        WHERE a.lead_id = l.id
        ORDER BY a.scheduled_date DESC, a.scheduled_time DESC NULLS LAST LIMIT 1) AS ultimo_status,
      COALESCE(
        (SELECT h.entered_at FROM public.crm_lead_stage_history h
          WHERE h.lead_id = l.id AND h.stage_id = l.stage_id AND h.exited_at IS NULL
          ORDER BY h.entered_at DESC LIMIT 1),
        l.updated_at) AS entrou_em
    FROM public.crm_leads l
    JOIN public.crm_stages s ON s.id = l.stage_id
    WHERE public.normaliza_nome_etapa(s.name) IN ('agendado', 'reagendado')
      AND NOT EXISTS (
        SELECT 1 FROM public.crm_appointments a
        WHERE a.lead_id = l.id
          AND a.status IN ('pending', 'confirmed')
          AND a.scheduled_date >= ((now() AT TIME ZONE 'America/Bahia')::date - 2))
  LOOP
    -- Só quem está parado há mais de 3 dias.
    CONTINUE WHEN r.entrou_em > now() - interval '3 days';

    lead_id := r.id; lead_nome := r.name; pipeline_id := r.pipeline_id;
    de_etapa := r.etapa; ultimo_desfecho := r.ultimo_status; entrou_em := r.entrou_em;

    SELECT NOT COALESCE(c.comparecimento_automatico, true) INTO v_manual
      FROM public.crm_rodizio_config c WHERE c.tenant_id = r.tenant_id;

    IF COALESCE(v_manual, false) AND COALESCE(r.ultimo_status, '') IN ('pending', 'confirmed') THEN
      para_etapa := NULL; movido := false;
      motivo := 'consulta passada ainda sem presença marcada — a varredura não move (quem marca é a SDR)';
      RETURN NEXT; CONTINUE;
    END IF;

    v_alvo_nome := CASE r.ultimo_status
      WHEN 'no_show' THEN 'nao compareceu'
      WHEN 'contracted' THEN 'contratado'
      WHEN 'not_contracted' THEN 'nao contratado'
      ELSE 'relacionamento'
    END;

    SELECT s2.id, s2.name INTO v_alvo_id, v_alvo_label
    FROM public.crm_stages s2
    WHERE s2.pipeline_id = r.pipeline_id
      AND public.normaliza_nome_etapa(s2.name) = v_alvo_nome
    ORDER BY s2.position
    LIMIT 1;

    IF v_alvo_id IS NULL THEN
      para_etapa := NULL; movido := false;
      motivo := 'etapa destino "' || v_alvo_nome || '" não existe neste funil';
      RETURN NEXT; CONTINUE;
    END IF;

    -- Etapa destino com automação de entrada dispararia mensagem para o lead
    -- no meio da noite: nesse caso a varredura não move e avisa.
    SELECT EXISTS (
      SELECT 1 FROM public.crm_automations a
      WHERE a.stage_id = v_alvo_id AND a.is_active
        AND a.trigger_type IN ('on_enter', 'on_create_or_enter', 'time_window')
    ) INTO v_tem_automacao;
    IF v_tem_automacao THEN
      para_etapa := v_alvo_label; movido := false;
      motivo := 'etapa destino tem automação de entrada ativa — não movido';
      RETURN NEXT; CONTINUE;
    END IF;

    para_etapa := v_alvo_label;
    motivo := 'sem agendamento ativo há mais de 3 dias';
    movido := NOT p_dry_run;

    IF NOT p_dry_run THEN
      UPDATE public.crm_leads SET stage_id = v_alvo_id, updated_at = now() WHERE id = r.id;
      INSERT INTO public.messages (lead_id, tenant_id, direction, type, content, status)
      VALUES (r.id, r.tenant_id, 'outbound', 'system',
        '📋 Etapa alterada: ' || r.etapa || ' → ' || v_alvo_label || ' (varredura: sem agendamento ativo há mais de 3 dias)',
        'system');
    END IF;

    RETURN NEXT;
  END LOOP;
END;
$function$;

-- ===================================================================== grants
-- No Supabase toda função nova em public NASCE com EXECUTE explícito para anon e
-- authenticated (pg_default_acl); REVOKE só de PUBLIC não tira isso. Nenhuma
-- tela chama estas funções — só o servidor (gatilhos, cron, edge function).
REVOKE ALL ON FUNCTION public.etapa_e_contratado(text)                          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lead_tem_pagamento_de_contrato(uuid, date, date)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lead_ultimo_pagamento_de_contrato(uuid)           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.contratado_promove_consulta(uuid, date)           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.contratado_mover_agora(uuid, text, boolean)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.contratado_agendar(uuid, text)                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.contratado_pendentes()                            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.contratado_apos_pagamento()                       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.contratado_apos_vinculo()                         FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contratado_agendar(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.contratado_pendentes()         TO service_role;

-- ======================================================================= crons
DO $cron$
DECLARE j record;
BEGIN
  -- A decisão automática de comparecimento fica DESLIGADA (pausada em 17/09/2026
  -- às 13h por ordem do dono; aqui vira estado do banco, não ajuste manual).
  FOR j IN SELECT jobid FROM cron.job
            WHERE jobname IN ('dontus-comparecimento-15utc', 'dontus-comparecimento-18utc',
                              'dontus-comparecimento-21utc', 'dontus-comparecimento-00utc',
                              'reagendar-expirado-2130utc') LOOP
    PERFORM cron.alter_job(job_id := j.jobid, active := false);
  END LOOP;

  PERFORM cron.schedule('contratado-apos-carencia',
                        '1,6,11,16,21,26,31,36,41,46,51,56 * * * *',
                        'SELECT public.contratado_pendentes();');
END $cron$;
