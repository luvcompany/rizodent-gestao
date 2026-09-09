-- Rodízio de SDRs — Fase 2: ponto de expediente, "Fechar conversa" e pesquisa
-- de satisfação.
--
-- O QUE ESTA MIGRATION FAZ (só objetos novos; nenhuma policy existente é
-- editada; nenhuma função de produção é substituída; o motor NÃO é ligado —
-- crm_rodizio_config.modo continua 'desligado' e nada aqui move lead):
--
--   1. PONTO (crm_ponto_eventos, criada na Fase 0 sem escrita): RPCs
--      ponto_abrir / ponto_pausar(motivo) / ponto_retomar / ponto_encerrar /
--      ponto_meu_estado (só perfil sdr, só a própria linha) e ponto_relatorio
--      (gestor). A escrita entra por RPC SECURITY DEFINER, não por policy —
--      cada clique valida a transição (não abre duas vezes, não retoma sem
--      pausa) e a tabela continua sem policy permissiva de escrita.
--      Abrir chama public.rodizio_aplicar_lote_ao_abrir(auth.uid()) SE a
--      função existir (é do construtor do motor; to_regprocedure) e devolve
--      "leads recebidos desde o último encerramento".
--      Pausa é só relógio: ela continua elegível a receber lead (o motor lê
--      crm_rodizio_membros/profiles, não o ponto).
--   2. VIGIA (pg_cron 'ponto-vigia', a cada 5 min, em UTC): (a) expediente
--      esquecido encerra sozinho no auto_encerrar da clínica (23:59 no fuso do
--      tenant), com origem='auto' e carimbo no instante do corte — não no
--      instante em que o cron rodou; (b) pausa acima de pausa_alerta_min (75)
--      vira notificação para crm_rodizio_config.gestor_user_id, uma por pausa
--      (dedupe_key 'ponto_pausa_longa:<id do pausar>'). "Já avisado" é
--      conferido por (user_id = gestor AND dedupe_key): chave gravada por
--      outra pessoa nunca vale como aviso entregue, e o INSERT toma a chave
--      (ON CONFLICT DO UPDATE) quando a linha existente não é do gestor.
--      Rodadas sobrepostas do cron: pg_try_advisory_xact_lock('ponto:vigia').
--   3. FECHAR CONVERSA: conversa_fechar(lead, enviar_pesquisa) e
--      conversa_reabrir(lead) — só a dona do lead (assigned_to) ou a gestão
--      (crc/gerente/superadmin), E SEMPRE dentro do que a policy de SELECT de
--      crm_leads deixa essa pessoa ver: conversa_lead_visivel espelha a
--      permissiva "Users can view assigned or own leads in allowed pipelines"
--      (can_access_pipeline/whatsapp_number/instagram_account) e as
--      restritivas hide_posvenda_leads, closer/recepcao_number_scope_leads e
--      sdr_escopo_crm_leads_select. Sem isso um crc sem override do número do
--      closer (37 leads do 'Rizodent - Comercial'), ou qualquer crc no funil
--      Pós-venda (316 leads), fecharia/reabriria com o id do lead uma conversa
--      que não pode ler, receberia telefone e nome pela RPC e tiraria o lead
--      da realocação. Fora do alcance a resposta é uma só: 'Lead não
--      encontrado.' Gravam crm_leads.conversa_fechada_em/_por e mensagem de
--      sistema no chat. Gatilho em messages: qualquer mensagem RECEBIDA reabre
--      a conversa (conversa_fechada_em volta a NULL) — exceto a resposta
--      numérica da pesquisa (ver 4), que é registrada e não reabre, e
--      comentário de post do Instagram (instagram_comment_id), que não é
--      conversa (mesma régua do motor e do relatório).
--      "Tirar o lead da regra de realocação por silêncio" é do motor e só
--      vale quando houve resposta HUMANA ao último inbound (régua única
--      rodizio_msg_humana, migration 20260909100000): fechar a conversa sem
--      ter respondido não livra a dona — rodizio_realocar_sem_resposta
--      ignora conversa_fechada_em de propósito (contrato revisto em
--      09/09/2026, segunda rodada de revisão).
--   4. PESQUISA: pesquisa_config_ler / pesquisa_config_salvar (gestor) editam
--      crm_pesquisa_config (ativa, texto com {{nome}}/{{escala}}, escala).
--      Ao fechar com pesquisa: linha em crm_pesquisa_respostas creditada à
--      dona do lead naquele instante; o ENVIO é do front, pelo caminho que já
--      existe (edge function send-whatsapp-message, type text) — nada de fluxo
--      novo de envio. Se o envio falhar, pesquisa_envio_falhou(id) apaga a
--      linha para não inflar "enviadas". A resposta do lead (só o número, na
--      escala, até 7 dias) vira nota/respondida_em pelo gatilho de messages.
--      atraso_min existe na tabela mas NÃO é usado: envio adiado exigiria um
--      disparador servidor→Meta que o projeto não tem hoje; fica em 0.
--
-- PAPÉIS: nada muda para crc/gerente/posvenda/recepção/closer. As RPCs do
-- ponto recusam quem não é sdr; as do gestor exigem is_gestor_equipe();
-- conversa_fechar exige dona-ou-gestão (conversa_fechada_em já era coluna
-- livre para UPDATE de quem edita o lead — a RPC só acrescenta a mensagem de
-- sistema e a pesquisa). Nenhuma policy existente é tocada. DUAS policies
-- RESTRICTIVE novas: sdr_insert_so_sistema_messages (INSERT em messages por
-- quem tem papel sdr só de mensagem de SISTEMA — outbound, type 'system', sem
-- sender_id e sem from_device; ver 3c: a SDR não forja "resposta humana" para
-- escapar da realocação nem para inflar o relatório) e notif_dedupe_so_servidor
-- (INSERT em crm_notifications só com dedupe_key NULL para authenticated).
-- dedupe_key é a chave de "já avisei
-- o gestor" do vigia e do motor; qualquer membro do tenant podia gravá-la
-- (permissiva "Tenant members can insert notifications" + INSERT na coluna) e
-- calar a pausa longa ou o aviso diário do rodízio. Não há policy de UPDATE
-- equivalente de propósito: USING (dedupe_key IS NULL) impediria o gestor de
-- marcar como lida uma notificação com chave (regressão); a chave trocada por
-- UPDATE é coberta pelo "takeover" do INSERT do servidor (ver 2). Nenhum caminho
-- do front grava dedupe_key (só functions com service_role e migrations).
--
-- FUSO: o banco e o cron rodam em UTC; toda hora "da clínica" é convertida
-- com tenants.timezone (America/Bahia na Rizodent) — ponto_fuso_do_tenant.
--
-- PRÉ-REQUISITO: 20260901220000, 20260901220100 (fundações) e 20260908150000
-- (papel sdr, is_gestor_equipe). Independe de 20260909100000 (motor) e de
-- 20260909100200 (relatórios): se o motor ainda não existir, ponto_abrir só
-- não aplica lote.
-- ROLLBACK: DROP das funções ponto_*, conversa_*, pesquisa_*, do gatilho
-- trg_zz_conversa_reabre_ao_receber, do índice
-- crm_pesquisa_respostas_lead_pend_idx, das policies notif_dedupe_so_servidor
-- e sdr_insert_so_sistema_messages e cron.unschedule('ponto-vigia').

SET LOCAL lock_timeout = '5s';

-- ============================================================ 1. helpers (internos, sem EXECUTE para authenticated)

-- Fuso da clínica. Fallback America/Bahia (o único cliente com rodízio hoje).
CREATE OR REPLACE FUNCTION public.ponto_fuso_do_tenant(p_tenant uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT COALESCE((SELECT NULLIF(btrim(t.timezone), '') FROM public.tenants t WHERE t.id = p_tenant), 'America/Bahia');
$fn$;

-- Guarda das RPCs do ponto: sessão viva, conta não bloqueada
-- (current_tenant_id() devolve NULL para bloqueado) e papel sdr.
CREATE OR REPLACE FUNCTION public.ponto_exige_sdr()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF auth.uid() IS NULL OR public.current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida ou conta bloqueada.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_role(auth.uid(), 'sdr'::app_role) THEN
    RAISE EXCEPTION 'O ponto de expediente é do perfil SDR.' USING ERRCODE = '42501';
  END IF;
END $fn$;

-- Sessões de expediente de uma pessoa a partir dos EVENTOS (a tabela guarda
-- cliques, não estado). Uma sessão vai do 'abrir' ao 'encerrar' seguinte; a
-- última pode estar em curso (estado 'aberto'/'pausado', medida até p_ate).
-- Evento fora de ordem é ignorado (pausar sem estar aberto, retomar sem
-- pausa); 'abrir' em cima de sessão aberta fecha a anterior naquele instante
-- (ponto_abrir recusa isso, mas um lançamento administrativo pode acontecer).
CREATE OR REPLACE FUNCTION public.ponto_sessoes(p_tenant uuid, p_user uuid, p_de timestamptz, p_ate timestamptz)
RETURNS TABLE(
  abriu_em timestamptz, encerrou_em timestamptz, encerrado_auto boolean, estado text,
  minutos_trabalhados integer, minutos_pausa integer, pausas integer,
  segundos_trabalhados integer, segundos_pausa integer,
  pausa_desde timestamptz, motivo_pausa text, ultimo_evento_id uuid, ultimo_evento_em timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_ev record;
  v_aberta boolean := false;
  v_pausa_total interval := interval '0';
  v_pausa_corrente interval;
BEGIN
  IF p_tenant IS NULL OR p_user IS NULL OR p_de IS NULL OR p_ate IS NULL THEN RETURN; END IF;
  FOR v_ev IN
    SELECT e.id, e.tipo, e.motivo, e.em, e.origem
      FROM public.crm_ponto_eventos e
     WHERE e.tenant_id = p_tenant AND e.user_id = p_user
       AND e.em >= p_de AND e.em <= p_ate
     ORDER BY e.em, e.id
  LOOP
    IF v_ev.tipo = 'abrir' THEN
      IF v_aberta THEN
        IF pausa_desde IS NOT NULL THEN
          v_pausa_total := v_pausa_total + (v_ev.em - pausa_desde);
          pausa_desde := NULL; motivo_pausa := NULL;
        END IF;
        estado := 'fechado'; encerrou_em := v_ev.em; encerrado_auto := false;
        segundos_pausa := (EXTRACT(EPOCH FROM v_pausa_total))::integer;
        segundos_trabalhados := GREATEST(0, (EXTRACT(EPOCH FROM (encerrou_em - abriu_em - v_pausa_total)))::integer);
        minutos_pausa := segundos_pausa / 60;
        minutos_trabalhados := segundos_trabalhados / 60;
        RETURN NEXT;
      END IF;
      abriu_em := v_ev.em; encerrou_em := NULL; encerrado_auto := false; estado := 'aberto';
      v_pausa_total := interval '0'; pausas := 0; pausa_desde := NULL; motivo_pausa := NULL;
      ultimo_evento_id := v_ev.id; ultimo_evento_em := v_ev.em;
      v_aberta := true;
    ELSIF NOT v_aberta THEN
      CONTINUE;
    ELSIF v_ev.tipo = 'pausar' AND estado = 'aberto' THEN
      estado := 'pausado'; pausa_desde := v_ev.em; motivo_pausa := v_ev.motivo; pausas := pausas + 1;
      ultimo_evento_id := v_ev.id; ultimo_evento_em := v_ev.em;
    ELSIF v_ev.tipo = 'retomar' AND estado = 'pausado' THEN
      v_pausa_total := v_pausa_total + (v_ev.em - pausa_desde);
      pausa_desde := NULL; motivo_pausa := NULL; estado := 'aberto';
      ultimo_evento_id := v_ev.id; ultimo_evento_em := v_ev.em;
    ELSIF v_ev.tipo = 'encerrar' THEN
      IF estado = 'pausado' THEN
        v_pausa_total := v_pausa_total + (v_ev.em - pausa_desde);
        pausa_desde := NULL; motivo_pausa := NULL;
      END IF;
      estado := 'fechado'; encerrou_em := v_ev.em; encerrado_auto := (v_ev.origem = 'auto');
      ultimo_evento_id := v_ev.id; ultimo_evento_em := v_ev.em;
      segundos_pausa := (EXTRACT(EPOCH FROM v_pausa_total))::integer;
      segundos_trabalhados := GREATEST(0, (EXTRACT(EPOCH FROM (encerrou_em - abriu_em - v_pausa_total)))::integer);
      minutos_pausa := segundos_pausa / 60;
      minutos_trabalhados := segundos_trabalhados / 60;
      v_aberta := false;
      RETURN NEXT;
    END IF;
  END LOOP;

  IF v_aberta THEN
    -- Sessão em curso: mede até p_ate (a pausa aberta conta até agora).
    v_pausa_corrente := CASE WHEN pausa_desde IS NOT NULL THEN GREATEST(interval '0', p_ate - pausa_desde) ELSE interval '0' END;
    segundos_pausa := (EXTRACT(EPOCH FROM (v_pausa_total + v_pausa_corrente)))::integer;
    segundos_trabalhados := GREATEST(0, (EXTRACT(EPOCH FROM (p_ate - abriu_em - v_pausa_total - v_pausa_corrente)))::integer);
    minutos_pausa := segundos_pausa / 60;
    minutos_trabalhados := segundos_trabalhados / 60;
    RETURN NEXT;
  END IF;
END $fn$;

-- "Você recebeu N leads desde o último encerramento": leads de que ela é dona
-- e que chegaram a ela (distribuido_em; na falta, created_at) depois de
-- p_desde. Sem encerramento anterior (primeiro dia) quem chama passa o início
-- do dia da clínica — senão o primeiro "Abrir" contaria o acervo inteiro dela
-- (leads históricos transferidos antes do 1º expediente) com o texto "desde o
-- último encerramento".
CREATE OR REPLACE FUNCTION public.ponto_leads_desde(p_tenant uuid, p_user uuid, p_desde timestamptz)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT count(*)::integer
    FROM public.crm_leads l
   WHERE l.tenant_id = p_tenant
     AND l.assigned_to = p_user
     AND COALESCE(l.distribuido_em, l.created_at) > COALESCE(p_desde, '-infinity'::timestamptz);
$fn$;

REVOKE ALL ON FUNCTION public.ponto_fuso_do_tenant(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ponto_exige_sdr() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ponto_sessoes(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ponto_leads_desde(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;

-- ============================================================ 2. RPCs do ponto (perfil sdr)

-- Estado atual + relógio do servidor (o cronômetro da tela corre a partir
-- de servidor_agora, não do relógio do navegador) + resumo do dia.
CREATE OR REPLACE FUNCTION public.ponto_meu_estado()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_abrir timestamptz;
  v_enc record;
  v_s record;
  v_cfg record;
  v_tz text;
  v_desde timestamptz;
BEGIN
  PERFORM public.ponto_exige_sdr();

  SELECT e.em INTO v_abrir
    FROM public.crm_ponto_eventos e
   WHERE e.tenant_id = v_tenant AND e.user_id = v_uid AND e.tipo = 'abrir'
   ORDER BY e.em DESC LIMIT 1;

  SELECT e.em, (e.origem = 'auto') AS auto INTO v_enc
    FROM public.crm_ponto_eventos e
   WHERE e.tenant_id = v_tenant AND e.user_id = v_uid AND e.tipo = 'encerrar'
   ORDER BY e.em DESC LIMIT 1;

  -- Sem 'abrir' nenhum: ponto_sessoes devolve zero linhas e v_s fica nulo.
  SELECT s.* INTO v_s
    FROM public.ponto_sessoes(v_tenant, v_uid, COALESCE(v_abrir, now()), now()) s
   ORDER BY s.abriu_em DESC LIMIT 1;

  SELECT c.pausa_alerta_min, c.auto_encerrar, c.gestor_user_id INTO v_cfg
    FROM public.crm_rodizio_config c WHERE c.tenant_id = v_tenant;
  v_tz := public.ponto_fuso_do_tenant(v_tenant);
  -- Sem encerramento anterior: conta desde o início do dia da clínica.
  v_desde := COALESCE(v_enc.em, ((now() AT TIME ZONE v_tz)::date)::timestamp AT TIME ZONE v_tz);

  RETURN jsonb_build_object(
    'servidor_agora', now(),
    'estado', COALESCE(v_s.estado, 'fechado'),
    'abriu_em', v_s.abriu_em,
    'encerrou_em', v_s.encerrou_em,
    'encerrado_auto', COALESCE(v_s.encerrado_auto, false),
    'minutos_trabalhados', COALESCE(v_s.minutos_trabalhados, 0),
    'minutos_pausa', COALESCE(v_s.minutos_pausa, 0),
    'segundos_trabalhados', COALESCE(v_s.segundos_trabalhados, 0),
    'segundos_pausa', COALESCE(v_s.segundos_pausa, 0),
    'pausas', COALESCE(v_s.pausas, 0),
    'pausa_desde', v_s.pausa_desde,
    'motivo_pausa', v_s.motivo_pausa,
    'ultimo_evento_em', v_s.ultimo_evento_em,
    'ultimo_encerramento', v_enc.em,
    'ultimo_encerramento_auto', COALESCE(v_enc.auto, false),
    'pausa_alerta_min', COALESCE(v_cfg.pausa_alerta_min, 75),
    'auto_encerrar', v_cfg.auto_encerrar,
    'leads_desde_ultimo_encerramento', public.ponto_leads_desde(v_tenant, v_uid, v_desde),
    'leads_desde_base', CASE WHEN v_enc.em IS NULL THEN 'hoje' ELSE 'encerramento' END,
    -- o aviso de pausa longa é do cron (até 5 min de atraso, e só com gestor
    -- nomeado): a tela só afirma "o gestor foi avisado" quando a notificação
    -- existe de fato para ele
    'gestor_avisado_pausa', COALESCE(v_s.estado, '') = 'pausado' AND v_cfg.gestor_user_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.crm_notifications n
                   WHERE n.user_id = v_cfg.gestor_user_id
                     AND n.dedupe_key = 'ponto_pausa_longa:' || v_s.ultimo_evento_id::text)
  );
END $fn$;

-- Abrir: recusa se já aberto/pausado; grava o evento; aplica o lote reservado
-- (motor) se a função existir — a falha do motor NÃO derruba o abrir (fica
-- em lote_erro, e o cron do motor recupera); devolve o estado com o resumo.
CREATE OR REPLACE FUNCTION public.ponto_abrir()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_estado text;
  v_abriu_em timestamptz;
  v_lote jsonb;
  v_lote_erro text;
  v_rettype regtype;
BEGIN
  PERFORM public.ponto_exige_sdr();
  v_estado := public.ponto_meu_estado()->>'estado';
  IF v_estado = 'aberto' THEN
    RAISE EXCEPTION 'O expediente já está aberto.';
  ELSIF v_estado = 'pausado' THEN
    RAISE EXCEPTION 'Você está em pausa. Retome o expediente em vez de abrir outro.';
  END IF;

  INSERT INTO public.crm_ponto_eventos (tenant_id, user_id, tipo, origem, criado_por)
  VALUES (v_tenant, v_uid, 'abrir', 'ui', v_uid)
  RETURNING em INTO v_abriu_em;

  IF to_regprocedure('public.rodizio_aplicar_lote_ao_abrir(uuid)') IS NOT NULL THEN
    BEGIN
      SELECT p.prorettype::regtype INTO v_rettype
        FROM pg_proc p
       WHERE p.oid = to_regprocedure('public.rodizio_aplicar_lote_ao_abrir(uuid)');
      IF v_rettype = 'void'::regtype THEN
        EXECUTE 'SELECT public.rodizio_aplicar_lote_ao_abrir($1)' USING v_uid;
        v_lote := jsonb_build_object('chamado', true);
      ELSE
        EXECUTE 'SELECT COALESCE(jsonb_agg(to_jsonb(r)), ''[]''::jsonb) FROM public.rodizio_aplicar_lote_ao_abrir($1) r'
           INTO v_lote USING v_uid;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_lote_erro := SQLERRM;
      RAISE WARNING 'ponto_abrir: rodizio_aplicar_lote_ao_abrir falhou para %: %', v_uid, SQLERRM;
    END;
  END IF;

  RETURN public.ponto_meu_estado() || jsonb_build_object(
    'lote', v_lote,
    'lote_erro', v_lote_erro,
    -- leads que entraram para ela neste abrir (independe do formato que o motor devolve)
    'leads_aplicados_agora', (SELECT count(*)::integer FROM public.crm_leads l
                               WHERE l.tenant_id = v_tenant AND l.assigned_to = v_uid
                                 AND l.distribuido_em >= v_abriu_em)
  );
END $fn$;

CREATE OR REPLACE FUNCTION public.ponto_pausar(p_motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_estado text;
BEGIN
  PERFORM public.ponto_exige_sdr();
  IF p_motivo IS NULL OR p_motivo NOT IN ('cafe', 'almoco', 'outro') THEN
    RAISE EXCEPTION 'Motivo da pausa inválido: use café, almoço ou outro.';
  END IF;
  v_estado := public.ponto_meu_estado()->>'estado';
  IF v_estado = 'pausado' THEN
    RAISE EXCEPTION 'Você já está em pausa.';
  ELSIF v_estado <> 'aberto' THEN
    RAISE EXCEPTION 'Abra o expediente antes de pausar.';
  END IF;
  INSERT INTO public.crm_ponto_eventos (tenant_id, user_id, tipo, motivo, origem, criado_por)
  VALUES (v_tenant, v_uid, 'pausar', p_motivo, 'ui', v_uid);
  RETURN public.ponto_meu_estado();
END $fn$;

CREATE OR REPLACE FUNCTION public.ponto_retomar()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
BEGIN
  PERFORM public.ponto_exige_sdr();
  IF (public.ponto_meu_estado()->>'estado') <> 'pausado' THEN
    RAISE EXCEPTION 'Você não está em pausa.';
  END IF;
  INSERT INTO public.crm_ponto_eventos (tenant_id, user_id, tipo, origem, criado_por)
  VALUES (v_tenant, v_uid, 'retomar', 'ui', v_uid);
  RETURN public.ponto_meu_estado();
END $fn$;

CREATE OR REPLACE FUNCTION public.ponto_encerrar()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
BEGIN
  PERFORM public.ponto_exige_sdr();
  IF (public.ponto_meu_estado()->>'estado') NOT IN ('aberto', 'pausado') THEN
    RAISE EXCEPTION 'O expediente já está encerrado.';
  END IF;
  INSERT INTO public.crm_ponto_eventos (tenant_id, user_id, tipo, origem, criado_por)
  VALUES (v_tenant, v_uid, 'encerrar', 'ui', v_uid);
  RETURN public.ponto_meu_estado();
END $fn$;

-- Relatório de horas do gestor: uma linha por sessão (dia da clínica, abriu,
-- encerrou, trabalhado, pausas). Sessão em curso aparece com estado
-- 'aberto'/'pausado' e horas até agora. Fim do período inclusivo.
CREATE OR REPLACE FUNCTION public.ponto_relatorio(p_de date, p_ate date)
RETURNS TABLE(
  user_id uuid, nome text, dia date, abriu_em timestamptz, encerrou_em timestamptz,
  encerrado_auto boolean, estado text, minutos_trabalhados integer, minutos_pausa integer, pausas integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_tz text;
  v_de timestamptz;
  v_ate timestamptz;
  r record;
  s record;
BEGIN
  IF NOT public.is_gestor_equipe() THEN
    RAISE EXCEPTION 'Você não é o gestor da equipe desta clínica.' USING ERRCODE = '42501';
  END IF;
  IF v_tenant IS NULL THEN RETURN; END IF;
  IF p_de IS NULL OR p_ate IS NULL OR p_ate < p_de OR (p_ate - p_de) > 366 THEN
    RAISE EXCEPTION 'Período inválido (no máximo um ano, com a data final depois da inicial).';
  END IF;
  v_tz := public.ponto_fuso_do_tenant(v_tenant);
  v_de := p_de::timestamp AT TIME ZONE v_tz;
  v_ate := (p_ate + 1)::timestamp AT TIME ZONE v_tz;

  FOR r IN
    SELECT DISTINCT e.user_id AS uid
      FROM public.crm_ponto_eventos e
     WHERE e.tenant_id = v_tenant AND e.em >= v_de AND e.em < v_ate
  LOOP
    FOR s IN SELECT * FROM public.ponto_sessoes(v_tenant, r.uid, v_de, LEAST(v_ate, now())) LOOP
      user_id := r.uid;
      nome := (SELECT p.nome FROM public.profiles p WHERE p.id = r.uid);
      dia := (s.abriu_em AT TIME ZONE v_tz)::date;
      abriu_em := s.abriu_em; encerrou_em := s.encerrou_em; encerrado_auto := s.encerrado_auto;
      estado := s.estado; minutos_trabalhados := s.minutos_trabalhados;
      minutos_pausa := s.minutos_pausa; pausas := s.pausas;
      RETURN NEXT;
    END LOOP;
  END LOOP;
END $fn$;

REVOKE ALL ON FUNCTION public.ponto_meu_estado() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ponto_meu_estado() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.ponto_abrir() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ponto_abrir() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.ponto_pausar(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ponto_pausar(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.ponto_retomar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ponto_retomar() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.ponto_encerrar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ponto_encerrar() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.ponto_relatorio(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ponto_relatorio(date, date) TO authenticated, service_role;

-- ============================================================ 3. vigia (cron): auto-encerrar + pausa longa
-- Roda sem usuário (auth.uid() NULL). Percorre só quem tem evento; com zero
-- SDRs cadastradas não faz nada. Devolve contagens para o log do cron.
CREATE OR REPLACE FUNCTION public.ponto_vigia()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  r record;
  s record;
  v_cfg record;
  v_tz text;
  v_dia date;
  v_corte timestamptz;
  v_em timestamptz;
  v_nome text;
  v_min_pausa integer;
  v_encerrados integer := 0;
  v_alertas integer := 0;
BEGIN
  -- Rodadas sobrepostas do cron: a segunda sai sem esperar (lock de transação).
  IF NOT pg_try_advisory_xact_lock(hashtext('ponto:vigia')) THEN
    RETURN jsonb_build_object('encerrados_auto', 0, 'alertas_pausa', 0, 'pulado', true);
  END IF;
  FOR r IN
    SELECT DISTINCT ON (e.tenant_id, e.user_id) e.tenant_id, e.user_id, e.tipo
      FROM public.crm_ponto_eventos e
     ORDER BY e.tenant_id, e.user_id, e.em DESC, e.id DESC
  LOOP
    IF r.tipo = 'encerrar' THEN CONTINUE; END IF;

    SELECT x.* INTO s
      FROM public.ponto_sessoes(
             r.tenant_id, r.user_id,
             (SELECT max(e.em) FROM public.crm_ponto_eventos e
               WHERE e.tenant_id = r.tenant_id AND e.user_id = r.user_id AND e.tipo = 'abrir'),
             now()) x
     ORDER BY x.abriu_em DESC LIMIT 1;
    IF s.estado IS NULL OR s.estado = 'fechado' THEN CONTINUE; END IF;

    SELECT c.auto_encerrar, c.pausa_alerta_min, c.gestor_user_id INTO v_cfg
      FROM public.crm_rodizio_config c WHERE c.tenant_id = r.tenant_id;
    v_tz := public.ponto_fuso_do_tenant(r.tenant_id);

    -- (a) expediente esquecido: encerra no corte (auto_encerrar) do dia da
    -- clínica em que foi aberto; se abriu depois do corte, no do dia seguinte.
    v_dia := (s.abriu_em AT TIME ZONE v_tz)::date;
    v_corte := (v_dia + COALESCE(v_cfg.auto_encerrar, time '23:59')) AT TIME ZONE v_tz;
    IF s.abriu_em >= v_corte THEN
      v_corte := ((v_dia + 1) + COALESCE(v_cfg.auto_encerrar, time '23:59')) AT TIME ZONE v_tz;
    END IF;
    IF now() >= v_corte THEN
      v_em := GREATEST(v_corte, s.ultimo_evento_em);
      INSERT INTO public.crm_ponto_eventos (tenant_id, user_id, tipo, origem, em)
      VALUES (r.tenant_id, r.user_id, 'encerrar', 'auto', v_em);
      v_encerrados := v_encerrados + 1;
      CONTINUE;
    END IF;

    -- (b) pausa longa: um aviso por pausa (dedupe pelo id do evento 'pausar').
    -- "Já avisado" = a notificação existe PARA O GESTOR; chave gravada por
    -- outra pessoa não vale, e o INSERT toma a chave (ON CONFLICT DO UPDATE
    -- só quando a linha existente não é do gestor) — o índice único parcial
    -- crm_notifications_dedupe_key_uniq deixa de derrubar a rodada.
    IF s.estado = 'pausado' AND v_cfg.gestor_user_id IS NOT NULL
       AND now() - s.pausa_desde >= make_interval(mins => COALESCE(v_cfg.pausa_alerta_min, 75))
       AND NOT EXISTS (SELECT 1 FROM public.crm_notifications n
                        WHERE n.user_id = v_cfg.gestor_user_id
                          AND n.dedupe_key = 'ponto_pausa_longa:' || s.ultimo_evento_id) THEN
      SELECT p.nome INTO v_nome FROM public.profiles p WHERE p.id = r.user_id;
      v_min_pausa := (EXTRACT(EPOCH FROM (now() - s.pausa_desde)) / 60)::integer;
      INSERT INTO public.crm_notifications AS n (user_id, title, body, type, dedupe_key)
      VALUES (
        v_cfg.gestor_user_id,
        'Pausa longa: ' || COALESCE(v_nome, 'SDR'),
        'Em pausa (' || CASE s.motivo_pausa WHEN 'cafe' THEN 'café' WHEN 'almoco' THEN 'almoço' ELSE 'outro' END
          || ') há ' || v_min_pausa || ' min — acima do limite de '
          || COALESCE(v_cfg.pausa_alerta_min, 75) || ' min.',
        'ponto_pausa_longa',
        'ponto_pausa_longa:' || s.ultimo_evento_id
      )
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO UPDATE
        SET user_id = EXCLUDED.user_id, lead_id = NULL, title = EXCLUDED.title, body = EXCLUDED.body,
            type = EXCLUDED.type, is_read = false, created_at = now()
        WHERE n.user_id IS DISTINCT FROM EXCLUDED.user_id;
      v_alertas := v_alertas + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('encerrados_auto', v_encerrados, 'alertas_pausa', v_alertas);
END $fn$;

REVOKE ALL ON FUNCTION public.ponto_vigia() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ponto_vigia() TO service_role;

DO $do$
DECLARE v_id bigint;
BEGIN
  SELECT jobid INTO v_id FROM cron.job WHERE jobname = 'ponto-vigia';
  IF v_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_id);
  END IF;
  PERFORM cron.schedule('ponto-vigia', '*/5 * * * *', $cmd$SELECT public.ponto_vigia();$cmd$);
END
$do$;

-- ============================================================ 3b. policy: dedupe_key é do servidor
-- crm_notifications.dedupe_key é a chave de "já avisei" do vigia (pausa longa)
-- e do motor (sem elegíveis / ninguém abriu, um por dia), e o índice único
-- crm_notifications_dedupe_key_uniq é global. Qualquer membro do tenant podia
-- inserir para si uma notificação com a chave do aviso do gestor (permissiva
-- "Tenant members can insert notifications" + sdr_escopo aceita lead_id NULL
-- e user_id = auth.uid()) e calar o aviso. Esta RESTRICTIVE fecha o INSERT com
-- chave para sessões de usuário; functions com service_role e migrations
-- (as únicas que gravam a coluna hoje) não passam por RLS. Sem policy de
-- UPDATE (ver cabeçalho): o takeover do INSERT do servidor cobre esse caminho.
DROP POLICY IF EXISTS notif_dedupe_so_servidor ON public.crm_notifications;
CREATE POLICY notif_dedupe_so_servidor ON public.crm_notifications
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (dedupe_key IS NULL);

-- ============================================================ 3c. policy: a SDR só insere mensagem de SISTEMA
-- "Resposta humana" (rodizio_msg_humana — realocação do motor e 1ª resposta
-- do relatório) é outbound com sender_id/from_device, ligação ou CONTEÚDO sem
-- sender — porque 99,5% das mensagens enviadas pelo CRM chegam SEM sender_id.
-- A permissiva "Staff can insert messages" (auth.uid() IS NOT NULL) deixaria
-- a SDR gravar um outbound de texto direto na tabela, sem enviar nada, e
-- "responder" o lead para escapar da realocação por silêncio e inflar o
-- relatório. Esta RESTRICTIVE fecha: quem tem papel sdr só insere mensagem de
-- SISTEMA (outbound, type 'system', sem sender_id e sem from_device) — os
-- únicos INSERTs diretos que a UI faz (logs de etapa, agendamento e desfecho:
-- AppointmentConfirmBar, useChatConversation, appointmentActions/Outcome/
-- Scheduling, CrmKanban, automationUtils — conferido em 09/09/2026; todos
-- direction 'outbound', type 'system', status 'system', sem sender_id). O
-- envio de verdade passa por send-whatsapp-message / instagram-send-message
-- com service_role, fora da RLS. Demais papéis: inalterados.
DROP POLICY IF EXISTS sdr_insert_so_sistema_messages ON public.messages;
CREATE POLICY sdr_insert_so_sistema_messages ON public.messages
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role))
    OR (direction = 'outbound' AND type = 'system' AND sender_id IS NULL AND COALESCE(from_device, false) = false)
  );

-- ============================================================ 4. fechar / reabrir conversa

-- Espelho da policy de SELECT de crm_leads para UMA linha (as RPCs abaixo são
-- SECURITY DEFINER e não passam pela RLS do chamador): a permissiva "Users can
-- view assigned or own leads in allowed pipelines" (tenant + can_access_pipeline
-- + can_access_whatsapp_number + can_access_instagram_account) e as restritivas
-- hide_posvenda_leads, closer_number_scope_leads, recepcao_number_scope_leads e
-- sdr_escopo_crm_leads_select (pg_policies, 08/09/2026). Chama as MESMAS
-- funções das policies, então acompanha overrides e mudanças nelas; se uma
-- policy nova entrar em crm_leads, este espelho tem de acompanhar (a
-- verificação no fim compara os dois).
CREATE OR REPLACE FUNCTION public.conversa_lead_visivel(p_lead public.crm_leads)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT (p_lead).id IS NOT NULL
     AND auth.uid() IS NOT NULL
     AND (p_lead).tenant_id = public.current_tenant_id()
     -- permissiva
     AND public.can_access_pipeline((p_lead).pipeline_id)
     AND public.can_access_whatsapp_number((p_lead).whatsapp_number_id)
     AND public.can_access_instagram_account((p_lead).ig_account_uuid)
     -- hide_posvenda_leads
     AND (public.has_role(auth.uid(), 'posvenda'::app_role)
          OR public.has_role(auth.uid(), 'superadmin'::app_role)
          OR (p_lead).pipeline_id IS NULL
          OR NOT public.is_posvenda_pipeline((p_lead).pipeline_id))
     -- closer_number_scope_leads / recepcao_number_scope_leads
     AND (NOT public.has_role(auth.uid(), 'closer'::app_role)
          OR ((p_lead).whatsapp_number_id IS NOT NULL AND public.can_access_whatsapp_number((p_lead).whatsapp_number_id)))
     AND (NOT public.has_role(auth.uid(), 'recepcao'::app_role)
          OR ((p_lead).whatsapp_number_id IS NOT NULL AND public.can_access_whatsapp_number((p_lead).whatsapp_number_id)))
     -- sdr_escopo_crm_leads_select
     AND (NOT public.has_role(auth.uid(), 'sdr'::app_role) OR (p_lead).assigned_to = auth.uid());
$fn$;
REVOKE ALL ON FUNCTION public.conversa_lead_visivel(public.crm_leads) FROM PUBLIC, anon, authenticated;

-- Quem pode: a dona do lead (assigned_to = auth.uid()) ou a gestão
-- (crc/gerente/superadmin) — e, nos dois casos, só lead que essa pessoa
-- ENXERGA pela policy de SELECT (conversa_lead_visivel). Fora do alcance a
-- resposta é uma só ('Lead não encontrado.'), sem dizer se o lead existe.
CREATE OR REPLACE FUNCTION public.conversa_lead_alcancavel(p_lead_id uuid)
RETURNS public.crm_leads LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_lead public.crm_leads;
  v_gestao boolean;
BEGIN
  IF auth.uid() IS NULL OR public.current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida ou conta bloqueada.' USING ERRCODE = '42501';
  END IF;
  SELECT l.* INTO v_lead FROM public.crm_leads l
   WHERE l.id = p_lead_id AND l.tenant_id = public.current_tenant_id();
  IF v_lead.id IS NULL OR NOT public.conversa_lead_visivel(v_lead) THEN
    RAISE EXCEPTION 'Lead não encontrado.' USING ERRCODE = '42501';
  END IF;
  v_gestao := public.has_role(auth.uid(), 'crc'::app_role)
           OR public.has_role(auth.uid(), 'gerente'::app_role)
           OR public.has_role(auth.uid(), 'superadmin'::app_role);
  IF NOT (v_gestao OR v_lead.assigned_to = auth.uid()) THEN
    RAISE EXCEPTION 'Só a responsável pelo lead ou a gestão podem fechar ou reabrir esta conversa.' USING ERRCODE = '42501';
  END IF;
  RETURN v_lead;
END $fn$;
REVOKE ALL ON FUNCTION public.conversa_lead_alcancavel(uuid) FROM PUBLIC, anon, authenticated;

-- Fechar: carimba conversa_fechada_em/por, escreve mensagem de sistema e, se
-- pedido e a pesquisa estiver ligada, cria a linha da pesquisa e devolve o
-- texto pronto para o FRONT enviar por send-whatsapp-message.
-- Idempotente: fechar de novo devolve ja_fechada=true sem repetir nada.
CREATE OR REPLACE FUNCTION public.conversa_fechar(p_lead_id uuid, p_enviar_pesquisa boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_lead public.crm_leads;
  v_nome text;
  v_cfg record;
  v_texto text;
  v_primeiro_nome text;
  v_escala_txt text;
  v_resp_id uuid;
  v_pesquisa jsonb;
  v_sem text;
  v_agora timestamptz := now();
BEGIN
  v_lead := public.conversa_lead_alcancavel(p_lead_id);
  IF v_lead.conversa_fechada_em IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'ja_fechada', true,
      'conversa_fechada_em', v_lead.conversa_fechada_em, 'pesquisa', NULL, 'pesquisa_nao_enviada', NULL);
  END IF;

  SELECT p.nome INTO v_nome FROM public.profiles p WHERE p.id = v_uid;

  UPDATE public.crm_leads
     SET conversa_fechada_em = v_agora, conversa_fechada_por = v_uid, updated_at = v_agora
   WHERE id = v_lead.id;

  INSERT INTO public.messages (lead_id, tenant_id, direction, type, content, status)
  VALUES (v_lead.id, v_lead.tenant_id, 'outbound', 'system',
          '✅ Conversa fechada por ' || COALESCE(NULLIF(btrim(v_nome), ''), 'usuário'), 'system');

  IF COALESCE(p_enviar_pesquisa, false) THEN
    SELECT c.ativa, c.texto, c.escala INTO v_cfg
      FROM public.crm_pesquisa_config c WHERE c.tenant_id = v_lead.tenant_id;
    IF v_cfg.ativa IS DISTINCT FROM true OR COALESCE(btrim(v_cfg.texto), '') = '' THEN
      v_sem := 'pesquisa_desligada';
    ELSIF COALESCE(btrim(v_lead.phone), '') = '' THEN
      v_sem := 'lead_sem_telefone';
    ELSIF COALESCE(v_lead.active_channel, 'whatsapp') = 'instagram' THEN
      v_sem := 'canal_instagram';
    ELSE
      v_primeiro_nome := NULLIF(split_part(btrim(COALESCE(v_lead.name, '')), ' ', 1), '');
      v_escala_txt := CASE WHEN v_cfg.escala ~ '^\d+-\d+$'
                           THEN 'de ' || split_part(v_cfg.escala, '-', 1) || ' a ' || split_part(v_cfg.escala, '-', 2)
                           ELSE 'de 1 a 5' END;
      v_texto := replace(replace(v_cfg.texto, '{{nome}}', COALESCE(v_primeiro_nome, '')), '{{escala}}', v_escala_txt);
      -- "Olá, {{nome}}!" sem nome vira "Olá, !" — limpa a pontuação órfã.
      v_texto := regexp_replace(v_texto, '\s*,\s*([!?.])', '\1', 'g');
      v_texto := regexp_replace(v_texto, '\s{2,}', ' ', 'g');
      INSERT INTO public.crm_pesquisa_respostas
        (tenant_id, lead_id, lead_nome, lead_telefone, responsavel_credito_id, enviada_em, canal)
      VALUES
        (v_lead.tenant_id, v_lead.id, v_lead.name, v_lead.phone, COALESCE(v_lead.assigned_to, v_uid), v_agora, 'whatsapp')
      RETURNING id INTO v_resp_id;
      v_pesquisa := jsonb_build_object('resposta_id', v_resp_id, 'texto', v_texto,
                                       'telefone', v_lead.phone, 'escala', v_cfg.escala);
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'ja_fechada', false, 'conversa_fechada_em', v_agora,
                            'pesquisa', v_pesquisa, 'pesquisa_nao_enviada', v_sem);
END $fn$;

CREATE OR REPLACE FUNCTION public.conversa_reabrir(p_lead_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_lead public.crm_leads;
  v_nome text;
BEGIN
  v_lead := public.conversa_lead_alcancavel(p_lead_id);
  IF v_lead.conversa_fechada_em IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'ja_aberta', true);
  END IF;
  SELECT p.nome INTO v_nome FROM public.profiles p WHERE p.id = v_uid;
  UPDATE public.crm_leads
     SET conversa_fechada_em = NULL, conversa_fechada_por = NULL, updated_at = now()
   WHERE id = v_lead.id;
  INSERT INTO public.messages (lead_id, tenant_id, direction, type, content, status)
  VALUES (v_lead.id, v_lead.tenant_id, 'outbound', 'system',
          '🔓 Conversa reaberta por ' || COALESCE(NULLIF(btrim(v_nome), ''), 'usuário'), 'system');
  RETURN jsonb_build_object('ok', true, 'ja_aberta', false);
END $fn$;

-- O envio da pesquisa (front → send-whatsapp-message) falhou: apaga a linha
-- ainda não respondida para não contar como "enviada". Só quem fechou/é dona
-- ou a gestão — e, como em conversa_fechar, só se o lead da pesquisa está ao
-- alcance de quem chama (conversa_lead_visivel): sem isso o ramo gestão
-- apagava qualquer pesquisa pendente do tenant, inclusive de lead que o crc
-- não enxerga. Fora do alcance: 'Lead não encontrado.'
CREATE OR REPLACE FUNCTION public.pesquisa_envio_falhou(p_resposta_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_gestao boolean;
  v_lead_id uuid;
  v_lead public.crm_leads;
BEGIN
  IF v_uid IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida ou conta bloqueada.' USING ERRCODE = '42501';
  END IF;
  SELECT r.lead_id INTO v_lead_id
    FROM public.crm_pesquisa_respostas r
   WHERE r.id = p_resposta_id AND r.tenant_id = v_tenant
     AND r.respondida_em IS NULL AND r.nota IS NULL;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT l.* INTO v_lead FROM public.crm_leads l WHERE l.id = v_lead_id AND l.tenant_id = v_tenant;
  IF v_lead.id IS NULL OR NOT public.conversa_lead_visivel(v_lead) THEN
    RAISE EXCEPTION 'Lead não encontrado.' USING ERRCODE = '42501';
  END IF;
  v_gestao := public.has_role(v_uid, 'crc'::app_role)
           OR public.has_role(v_uid, 'gerente'::app_role)
           OR public.has_role(v_uid, 'superadmin'::app_role);
  IF NOT (v_gestao OR v_lead.assigned_to = v_uid OR v_lead.conversa_fechada_por = v_uid) THEN
    RAISE EXCEPTION 'Só a responsável pelo lead ou a gestão podem cancelar esta pesquisa.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.crm_pesquisa_respostas r
   WHERE r.id = p_resposta_id AND r.tenant_id = v_tenant
     AND r.respondida_em IS NULL AND r.nota IS NULL;
  RETURN FOUND;
END $fn$;

REVOKE ALL ON FUNCTION public.conversa_fechar(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conversa_fechar(uuid, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.conversa_reabrir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conversa_reabrir(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.pesquisa_envio_falhou(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pesquisa_envio_falhou(uuid) TO authenticated, service_role;

-- ============================================================ 5. gatilho: mensagem recebida reabre / registra a pesquisa
-- Só direction='inbound' (o WHEN do gatilho). Comentário de post do Instagram
-- (instagram_comment_id) não é conversa e sai no pré-filtro — a mesma régua
-- de rodizio_on_mensagem e do relatório da Fase 5. Ordem de decisão:
--   1) há pesquisa pendente (até 7 dias) e a mensagem é SÓ um número dentro
--      da escala → grava nota/respondida_em e NÃO reabre (é a resposta da
--      pesquisa, não uma conversa nova);
--   2) senão, se a conversa estava fechada → reabre (conversa_fechada_em NULL).
-- Qualquer erro aqui vira WARNING: o gatilho nunca pode derrubar a gravação
-- de uma mensagem recebida (é o caminho do whatsapp-webhook).
CREATE INDEX IF NOT EXISTS crm_pesquisa_respostas_lead_pend_idx
  ON public.crm_pesquisa_respostas (lead_id, enviada_em DESC)
  WHERE respondida_em IS NULL;

CREATE OR REPLACE FUNCTION public.conversa_reabre_ao_receber()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_lead record;
  v_p record;
  v_num integer;
  v_min integer := 1;
  v_max integer := 5;
BEGIN
  IF NEW.lead_id IS NULL OR NEW.direction <> 'inbound'
     OR COALESCE(NEW.type, 'text') = 'system' OR NEW.deleted_at IS NOT NULL
     OR NEW.instagram_comment_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  BEGIN
    SELECT l.id, l.conversa_fechada_em INTO v_lead
      FROM public.crm_leads l WHERE l.id = NEW.lead_id;
    IF v_lead.id IS NULL THEN RETURN NEW; END IF;

    SELECT r.id, c.escala INTO v_p
      FROM public.crm_pesquisa_respostas r
      LEFT JOIN public.crm_pesquisa_config c ON c.tenant_id = r.tenant_id
     WHERE r.lead_id = NEW.lead_id
       AND r.respondida_em IS NULL AND r.nota IS NULL
       AND r.enviada_em >= now() - interval '7 days'
       AND r.enviada_em <= COALESCE(NEW.created_at, now())
     ORDER BY r.enviada_em DESC LIMIT 1;

    IF v_p.id IS NOT NULL
       AND COALESCE(NEW.type, 'text') = 'text'
       AND COALESCE(NEW.content, '') ~ '^\s*\d{1,2}\s*[.!]?\s*$' THEN
      v_num := (regexp_match(NEW.content, '(\d{1,2})'))[1]::integer;
      IF v_p.escala ~ '^\d+-\d+$' THEN
        v_min := split_part(v_p.escala, '-', 1)::integer;
        v_max := split_part(v_p.escala, '-', 2)::integer;
      END IF;
      IF v_num BETWEEN LEAST(v_min, v_max) AND GREATEST(v_min, v_max) AND v_num BETWEEN 0 AND 10 THEN
        UPDATE public.crm_pesquisa_respostas
           SET nota = v_num, respondida_em = COALESCE(NEW.created_at, now())
         WHERE id = v_p.id;
        RETURN NEW;
      END IF;
    END IF;

    IF v_lead.conversa_fechada_em IS NOT NULL THEN
      UPDATE public.crm_leads
         SET conversa_fechada_em = NULL, conversa_fechada_por = NULL
       WHERE id = v_lead.id AND conversa_fechada_em IS NOT NULL;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'conversa_reabre_ao_receber: % (lead %)', SQLERRM, NEW.lead_id;
  END;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_zz_conversa_reabre_ao_receber ON public.messages;
CREATE TRIGGER trg_zz_conversa_reabre_ao_receber
  AFTER INSERT ON public.messages
  FOR EACH ROW WHEN (NEW.direction = 'inbound')
  EXECUTE FUNCTION public.conversa_reabre_ao_receber();

-- ============================================================ 6. pesquisa de satisfação — configuração (gestor)
-- Leitura devolve a configuração (ou os defaults, se a clínica ainda não tem
-- linha) e um resumo de 30 dias para a tela. Escrita = upsert por tenant.
CREATE OR REPLACE FUNCTION public.pesquisa_config_ler()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_cfg record;
  v_env integer;
  v_resp integer;
  v_media numeric;
BEGIN
  IF NOT public.is_gestor_equipe() THEN
    RAISE EXCEPTION 'Você não é o gestor da equipe desta clínica.' USING ERRCODE = '42501';
  END IF;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida ou conta bloqueada.' USING ERRCODE = '42501';
  END IF;
  SELECT c.ativa, c.texto, c.escala, c.atraso_min, c.updated_at INTO v_cfg
    FROM public.crm_pesquisa_config c WHERE c.tenant_id = v_tenant;
  SELECT count(*)::integer,
         count(*) FILTER (WHERE r.respondida_em IS NOT NULL)::integer,
         round(avg(r.nota) FILTER (WHERE r.nota IS NOT NULL), 2)
    INTO v_env, v_resp, v_media
    FROM public.crm_pesquisa_respostas r
   WHERE r.tenant_id = v_tenant AND r.enviada_em >= now() - interval '30 days';
  RETURN jsonb_build_object(
    'existe', v_cfg.updated_at IS NOT NULL,
    'ativa', COALESCE(v_cfg.ativa, false),
    'texto', COALESCE(v_cfg.texto,
      'Olá, {{nome}}! Para melhorarmos o atendimento: {{escala}}, como você avalia a conversa que acabamos de ter? Responda só com o número. 😊'),
    'escala', COALESCE(v_cfg.escala, '1-5'),
    'atraso_min', COALESCE(v_cfg.atraso_min, 0),
    'updated_at', v_cfg.updated_at,
    'enviadas_30d', COALESCE(v_env, 0),
    'respondidas_30d', COALESCE(v_resp, 0),
    'media_30d', v_media
  );
END $fn$;

CREATE OR REPLACE FUNCTION public.pesquisa_config_salvar(p_ativa boolean, p_texto text, p_escala text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_texto text := btrim(COALESCE(p_texto, ''));
BEGIN
  IF NOT public.is_gestor_equipe() THEN
    RAISE EXCEPTION 'Você não é o gestor da equipe desta clínica.' USING ERRCODE = '42501';
  END IF;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida ou conta bloqueada.' USING ERRCODE = '42501';
  END IF;
  IF p_escala IS NULL OR p_escala NOT IN ('1-5', '0-10', '1-10') THEN
    RAISE EXCEPTION 'Escala inválida: use 1-5, 0-10 ou 1-10.';
  END IF;
  IF COALESCE(p_ativa, false) AND v_texto = '' THEN
    RAISE EXCEPTION 'Escreva a mensagem da pesquisa antes de ligá-la.';
  END IF;
  IF length(v_texto) > 1000 THEN
    RAISE EXCEPTION 'A mensagem da pesquisa pode ter no máximo 1000 caracteres.';
  END IF;

  INSERT INTO public.crm_pesquisa_config (tenant_id, ativa, texto, escala, updated_at)
  VALUES (v_tenant, COALESCE(p_ativa, false), NULLIF(v_texto, ''), p_escala, now())
  ON CONFLICT (tenant_id) DO UPDATE
    SET ativa = EXCLUDED.ativa, texto = EXCLUDED.texto, escala = EXCLUDED.escala, updated_at = now();

  INSERT INTO public.access_logs (user_id, tenant_id, context, event, metadata)
  VALUES (auth.uid(), v_tenant, 'tenant', 'pesquisa_config_salvar',
          jsonb_build_object('ativa', COALESCE(p_ativa, false), 'escala', p_escala, 'tamanho_texto', length(v_texto)));

  RETURN public.pesquisa_config_ler();
END $fn$;

REVOKE ALL ON FUNCTION public.pesquisa_config_ler() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pesquisa_config_ler() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.pesquisa_config_salvar(boolean, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pesquisa_config_salvar(boolean, text, text) TO authenticated, service_role;

-- ============================================================ VERIFICAÇÃO (rodar à mão, só leitura)
-- (0) Nada moveu: SELECT modo FROM public.crm_rodizio_config;  -- 'desligado'
--     SELECT count(*) FROM public.crm_lead_atribuicoes WHERE fase <> 'saneamento'; -- igual ao "antes"
-- (a) Objetos: 
--   SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public' AND (proname LIKE 'ponto_%' OR proname LIKE 'conversa_%' OR proname LIKE 'pesquisa_%')
--    ORDER BY 1;
--   -- ponto_abrir, ponto_encerrar, ponto_exige_sdr, ponto_fuso_do_tenant, ponto_leads_desde,
--   -- ponto_meu_estado, ponto_pausar, ponto_relatorio, ponto_retomar, ponto_sessoes, ponto_vigia,
--   -- conversa_fechar, conversa_lead_alcancavel, conversa_lead_visivel, conversa_reabre_ao_receber,
--   -- conversa_reabrir, pesquisa_config_ler, pesquisa_config_salvar, pesquisa_envio_falhou  (19)
--   SELECT permissive, cmd, with_check FROM pg_policies WHERE policyname = 'notif_dedupe_so_servidor'; -- RESTRICTIVE, INSERT
--   SELECT permissive, cmd, with_check FROM pg_policies WHERE policyname = 'sdr_insert_so_sistema_messages'; -- RESTRICTIVE, INSERT
--   -- com o JWT de uma SDR: INSERT em messages de type 'text' outbound → 42501
--   -- (new row violates row-level security policy); type 'system' sem sender_id → ok.
--   -- o espelho da policy de SELECT bate com a RLS: com o JWT de CADA papel
--   -- (crc rizodentvca2, meta.review, closer, recepcao, posvenda, sdr), o
--   -- conjunto que a RLS devolve é o mesmo que o espelho aprova:
--   --   SELECT count(*) FROM public.crm_leads;                                   -- pela RLS
--   --   (como dono) SELECT count(*) FROM public.crm_leads l
--   --     WHERE l.tenant_id = '<tenant>' AND public.conversa_lead_visivel(l);   -- com request.jwt.claims do mesmo usuário
--   -- com o JWT do crc rizodentvca2: conversa_fechar('<lead do número do closer>', true)
--   --   e conversa_fechar('<lead do funil Pós-venda>', true) → ERROR 42501 'Lead não encontrado.'
--   SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'ponto-vigia'; -- */5 * * * *
--   SELECT tgname, tgenabled FROM pg_trigger WHERE tgname = 'trg_zz_conversa_reabre_ao_receber'; -- O
--   SELECT has_function_privilege('authenticated','public.ponto_vigia()','EXECUTE');    -- false
--   SELECT has_function_privilege('authenticated','public.ponto_sessoes(uuid,uuid,timestamptz,timestamptz)','EXECUTE'); -- false
--   SELECT has_function_privilege('authenticated','public.ponto_abrir()','EXECUTE');    -- true
-- (b) Com o JWT do crc (d9b27aa3): SELECT public.ponto_meu_estado(); -- ERROR 42501 'O ponto de expediente é do perfil SDR.'
--     SELECT public.pesquisa_config_ler(); -- jsonb com ativa=false e os defaults (é o gestor nomeado)
--     Com o JWT do meta.review (crc não nomeado): pesquisa_config_ler() -- ERROR 42501
-- (c) Com o JWT de uma SDR (depois de criada na aba Equipe):
--     SELECT public.ponto_meu_estado()->>'estado';  -- 'fechado'
--     SELECT public.ponto_abrir()->>'estado';       -- 'aberto' (lote: NULL enquanto o motor não existir/estiver desligado)
--     SELECT public.ponto_abrir();                  -- ERROR 'O expediente já está aberto.'
--     SELECT public.ponto_pausar('almoco')->>'estado'; -- 'pausado'
--     SELECT public.ponto_retomar()->>'estado';     -- 'aberto'
--     SELECT public.ponto_encerrar()->>'estado';    -- 'fechado'
--     SELECT count(*) FROM public.crm_ponto_eventos WHERE user_id = auth.uid(); -- 4
--     SELECT public.conversa_fechar('<LEAD_DELA>', false)->>'ok';       -- true; messages ganha '✅ Conversa fechada por ...'
--     SELECT public.conversa_fechar('<LEAD_DE_OUTRA_DONA>', false);     -- ERROR 42501
--     INSERT de mensagem inbound no lead fechado (pelo webhook) → conversa_fechada_em volta a NULL.
-- (d) Vigia: SELECT public.ponto_vigia(); -- {"encerrados_auto":0,"alertas_pausa":0} com tudo encerrado.
--     Deixar uma SDR pausada há 75+ min → 1 notificação em crm_notifications
--     para o gestor_user_id com dedupe_key 'ponto_pausa_longa:<id do pausar>'; rodar de novo → 0 novas.
