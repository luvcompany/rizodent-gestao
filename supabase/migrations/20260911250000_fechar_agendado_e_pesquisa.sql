-- =============================================================================
-- Fechar a conversa 15 minutos depois do agendamento, ENVIANDO a pesquisa.
-- E pesquisa de satisfação no máximo uma vez por lead a cada 15 dias.
--
-- PEDIDO DO DONO (11/09/2026), palavras dele:
--   "quando eu terminar de agendar e o lead for movido para agendado, espera 15
--    minutos pra fechar, e já fecha enviando a pesquisa de satisfação. Cuidado
--    para não bugar nisso e acabar não permitindo que eu (sdr) possa abrir a
--    conversa e a automação ficar fechando toda hora e enviando a pesquisa de
--    satisfação mais de uma vez. Além disso crie uma regra em que eu consiga
--    enviar a pesquisa de satisfação apenas uma vez por lead a cada 15 dias."
--
-- ============================ POR QUE ESTA É A SEGUNDA VERSÃO ================
-- A primeira foi retirada da branch em 11/09 com quatro defeitos. Os quatro
-- estão resolvidos aqui, e é por isso que o desenho é outro:
--
--   1. Ela embutia uma cópia ANTIGA de relatorio_sdr_calc e, aplicada, teria
--      revertido em silêncio a régua de agendamento que o dono decidiu no mesmo
--      dia. ESTA MIGRATION NÃO TOCA EM NENHUMA FUNÇÃO DE RELATÓRIO. Se você
--      encontrar "relatorio" fora de um comentário aqui, é defeito.
--   2. Ela dependia de uma migration que não existe (a de fechar conversa por
--      etapa, reprovada antes), e teria criado função órfã. Aqui o gatilho de
--      entrada é criado junto, neste arquivo.
--   3. A pesquisa nunca sairia: o banco não envia WhatsApp e o desenho deixava
--      a pendência para a tela, que ninguém tinha mexido. Medido na época: 13 a
--      17 leads/dia entram em Agendado — seriam ~15 avisos de falha por dia no
--      chat dos PACIENTES e zero pesquisas. Agora quem envia é a edge function
--      fechar-agendado-pesquisa, pelo mesmo send-whatsapp-message que a tela e o
--      automation-queue-worker já usam.
--   4. Ela fechava por cima da SDR que estivesse trabalhando dentro dos 15 min.
--      Agora a presença (em_atendimento_por, no ar desde 11/09) ADIA o
--      fechamento em vez de atropelar.
--
-- ============================== AS TRÊS TRAVAS ===============================
-- (1) NÃO FECHA TODA HORA. Quem enfileira é só a ENTRADA na etapa: o gatilho
--     dispara em mudança de stage_id, nunca em outro UPDATE. Reabrir a conversa
--     não muda etapa, logo não reenfileira nada. A fila tem lead_id como CHAVE
--     PRIMÁRIA: um lead nunca tem duas linhas.
-- (2) NÃO ATROPELA A SDR. A varredura pula (e reagenda) quem está com a dona
--     dentro da conversa agora, quem já teve a conversa fechada por uma pessoa,
--     e quem saiu da etapa de agendamento nesse meio-tempo.
-- (3) PESQUISA UMA VEZ A CADA 15 DIAS. public.pesquisa_pode_enviar() é a régua
--     ÚNICA, chamada pelos dois caminhos que criam linha em
--     crm_pesquisa_respostas: o conversa_fechar da tela e o automático.
--
-- ====================== A LINHA DA PESQUISA SÓ NASCE SE SAIR ================
-- crm_pesquisa_respostas não tem coluna de status: linha existindo SIGNIFICA
-- pesquisa enviada — e é ela que a régua de 15 dias lê. Por isso o caminho
-- automático cria a linha no último instante (dentro de conversa_fechar_
-- automatico, que a edge function chama imediatamente antes de enviar) e, se o
-- envio falhar, a edge function chama pesquisa_envio_falhou(), que APAGA a
-- linha. Assim uma pesquisa que não saiu nunca mente no relatório nem queima os
-- 15 dias do paciente. Esse apagar já existia desde a Fase 2 — aqui ele passa a
-- ser usado também pelo caminho automático.
--
-- =========================== HORÁRIO: NÃO ÀS 3 DA MANHÃ =====================
-- Lead movido para Agendado às 22h fecharia 22h15 e o paciente receberia a
-- pesquisa na madrugada. O fechamento automático só acontece de segunda a
-- sábado, das 08:00 às 20:00 no fuso da clínica; fora disso o relógio espera a
-- próxima abertura. É a mesma janela que o automation-queue-worker já respeita
-- para mensagem ao paciente (nextCommercialFireAt), agora escrita em SQL.
-- =============================================================================


-- ============================================== 1. as duas réguas configuráveis
ALTER TABLE public.crm_rodizio_config
  ADD COLUMN IF NOT EXISTS fechar_agendado_apos_min integer NOT NULL DEFAULT 15;

COMMENT ON COLUMN public.crm_rodizio_config.fechar_agendado_apos_min IS
  'Minutos entre o lead ENTRAR numa etapa de agendamento e a conversa fechar sozinha, enviando a pesquisa. 0 desliga o fechamento automático sem mexer em mais nada.';

ALTER TABLE public.crm_pesquisa_config
  ADD COLUMN IF NOT EXISTS intervalo_dias integer NOT NULL DEFAULT 15;

COMMENT ON COLUMN public.crm_pesquisa_config.intervalo_dias IS
  'Dias que o mesmo lead precisa esperar para receber outra pesquisa. 0 tira o limite. Vale para os dois caminhos: o botão da tela e o fechamento automático.';

-- Marca quem foi fechado pelo relógio, não por uma pessoa. Serve para o chat
-- dizer a verdade e para qualquer contagem futura separar as duas coisas.
ALTER TABLE public.crm_leads
  ADD COLUMN IF NOT EXISTS conversa_fechada_auto boolean NOT NULL DEFAULT false;


-- ================================================================ 2. a fila
-- Uma linha por lead que ENTROU em etapa de agendamento e ainda não fechou.
-- Sem policy nenhuma e com RLS ligada = ninguém alcança pelo PostgREST; quem
-- lê e escreve são as funções SECURITY DEFINER abaixo.
CREATE TABLE IF NOT EXISTS public.crm_fechamentos_agendados (
  lead_id             uuid PRIMARY KEY REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  tenant_id           uuid NOT NULL,
  stage_id            uuid NOT NULL,
  entrou_em           timestamptz NOT NULL DEFAULT now(),
  fechar_em           timestamptz NOT NULL,
  tentativas          integer NOT NULL DEFAULT 0,
  ultima_tentativa_em timestamptz
);

ALTER TABLE public.crm_fechamentos_agendados ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crm_fechamentos_agendados FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.crm_fechamentos_agendados TO service_role;

CREATE INDEX IF NOT EXISTS crm_fechamentos_agendados_fechar_em_idx
  ON public.crm_fechamentos_agendados (fechar_em);

COMMENT ON TABLE public.crm_fechamentos_agendados IS
  'Fila do fechamento automático: um lead por linha, criada quando ele entra em etapa de agendamento, removida quando fecha ou quando deixa de fazer sentido.';


-- ================================== 3. a janela comercial, em SQL
-- Devolve o próprio instante quando ele já está dentro da janela (seg-sáb,
-- 08:00-20:00 no fuso da clínica) e, quando não está, o começo da próxima.
CREATE OR REPLACE FUNCTION public.fechar_agendado_na_janela(p_quando timestamptz, p_tenant uuid)
RETURNS timestamptz LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_tz    text := public.rodizio_tz(p_tenant);
  v_local timestamp;
  v_dia   date;
  v_dow   integer;
  i       integer := 0;
BEGIN
  v_local := p_quando AT TIME ZONE v_tz;
  v_dia   := v_local::date;
  v_dow   := EXTRACT(ISODOW FROM v_dia)::integer;   -- 1=seg .. 7=dom

  -- Dentro da janela de hoje: vale agora mesmo.
  IF v_dow BETWEEN 1 AND 6
     AND v_local >= (v_dia + time '08:00')
     AND v_local <  (v_dia + time '20:00') THEN
    RETURN p_quando;
  END IF;

  -- Antes das 08:00 de um dia útil: espera abrir hoje.
  IF v_dow BETWEEN 1 AND 6 AND v_local < (v_dia + time '08:00') THEN
    RETURN (v_dia + time '08:00') AT TIME ZONE v_tz;
  END IF;

  -- Depois das 20:00, ou domingo: procura o próximo seg-sáb.
  LOOP
    v_dia := v_dia + 1;
    i := i + 1;
    EXIT WHEN EXTRACT(ISODOW FROM v_dia)::integer BETWEEN 1 AND 6 OR i > 8;
  END LOOP;
  RETURN (v_dia + time '08:00') AT TIME ZONE v_tz;
END $fn$;

REVOKE ALL ON FUNCTION public.fechar_agendado_na_janela(timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fechar_agendado_na_janela(timestamptz, uuid) TO service_role;


-- ============================= 4. a régua dos 15 dias, em um lugar só
CREATE OR REPLACE FUNCTION public.pesquisa_pode_enviar(p_lead_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_dias integer; v_tenant uuid;
BEGIN
  IF p_lead_id IS NULL THEN RETURN false; END IF;
  SELECT l.tenant_id INTO v_tenant FROM public.crm_leads l WHERE l.id = p_lead_id;
  IF v_tenant IS NULL THEN RETURN false; END IF;

  SELECT COALESCE(c.intervalo_dias, 15) INTO v_dias
    FROM public.crm_pesquisa_config c WHERE c.tenant_id = v_tenant;
  v_dias := COALESCE(v_dias, 15);
  IF v_dias <= 0 THEN RETURN true; END IF;   -- limite desligado pela clínica

  RETURN NOT EXISTS (
    SELECT 1 FROM public.crm_pesquisa_respostas r
     WHERE r.lead_id = p_lead_id
       AND r.enviada_em > now() - make_interval(days => v_dias));
END $fn$;

REVOKE ALL ON FUNCTION public.pesquisa_pode_enviar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pesquisa_pode_enviar(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.pesquisa_pode_enviar(uuid) IS
  'Régua única dos 15 dias. A tela chama para esconder a opção antes de o usuário marcar, e os dois caminhos de fechamento chamam antes de criar a linha da pesquisa.';


-- ============================= 5. o gatilho: quem entra em Agendado entra na fila
-- Dispara SÓ em mudança de etapa. É isto que impede o "fecha toda hora": reabrir
-- a conversa, responder o paciente, marcar comparecimento — nada disso mexe em
-- stage_id, logo nada disso reenfileira.
CREATE OR REPLACE FUNCTION public.fecha_agendado_enfileira()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_min  integer;
  v_e_agendamento boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.crm_stages s
     WHERE s.id = NEW.stage_id
       AND public.normaliza_nome_etapa(s.name) IN ('agendado', 'reagendado')
  ) INTO v_e_agendamento;

  -- Saiu da etapa de agendamento: o fechamento perdeu o motivo.
  IF NOT v_e_agendamento THEN
    DELETE FROM public.crm_fechamentos_agendados WHERE lead_id = NEW.id;
    RETURN NEW;
  END IF;

  SELECT COALESCE(c.fechar_agendado_apos_min, 15) INTO v_min
    FROM public.crm_rodizio_config c WHERE c.tenant_id = NEW.tenant_id;
  v_min := COALESCE(v_min, 15);
  IF v_min <= 0 THEN RETURN NEW; END IF;            -- desligado nesta clínica

  INSERT INTO public.crm_fechamentos_agendados (lead_id, tenant_id, stage_id, entrou_em, fechar_em)
  VALUES (NEW.id, NEW.tenant_id, NEW.stage_id, now(),
          public.fechar_agendado_na_janela(now() + make_interval(mins => v_min), NEW.tenant_id))
  ON CONFLICT (lead_id) DO UPDATE
    SET stage_id            = EXCLUDED.stage_id,
        entrou_em           = EXCLUDED.entrou_em,
        fechar_em           = EXCLUDED.fechar_em,
        tentativas          = 0,
        ultima_tentativa_em = NULL;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Nunca derrubar a gravação do lead por causa da fila.
  RAISE WARNING 'fecha_agendado_enfileira: % (lead %)', SQLERRM, NEW.id;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_zzz_fecha_agendado_enfileira ON public.crm_leads;
CREATE TRIGGER trg_zzz_fecha_agendado_enfileira
  AFTER INSERT OR UPDATE OF stage_id ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION public.fecha_agendado_enfileira();


-- =========================== 6. a varredura: quem já pode fechar agora
-- Chamada pela edge function fechar-agendado-pesquisa, uma vez por minuto.
-- Devolve os leads elegíveis e JÁ marca a tentativa: dois cronos simultâneos não
-- pegam o mesmo lead (advisory lock na varredura inteira + carência de 2 minutos
-- entre tentativas do mesmo lead).
CREATE OR REPLACE FUNCTION public.fechar_agendado_pendentes(p_limite integer DEFAULT 30)
RETURNS TABLE (lead_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  -- Só uma varredura por vez. Sem isto, duas execuções do cron que se cruzam
  -- mandariam a mesma pesquisa duas vezes para o mesmo paciente.
  IF NOT pg_try_advisory_xact_lock(hashtext('fechar_agendado_pendentes')) THEN
    RETURN;
  END IF;

  -- 6a. limpa o que deixou de fazer sentido, para a fila não crescer para sempre.
  DELETE FROM public.crm_fechamentos_agendados f
   USING public.crm_leads l
   WHERE f.lead_id = l.id
     AND (
          l.conversa_fechada_em IS NOT NULL              -- alguém já fechou
       OR COALESCE(l.is_blocked, false)                  -- lead bloqueado
       OR COALESCE(l.automation_paused, false)           -- automação pausada neste lead
       OR NOT EXISTS (SELECT 1 FROM public.crm_stages s
                       WHERE s.id = l.stage_id
                         AND public.normaliza_nome_etapa(s.name) IN ('agendado','reagendado'))
     );

  -- 6b. desiste depois de 5 tentativas, deixando aviso no chat interno.
  WITH desistiu AS (
    DELETE FROM public.crm_fechamentos_agendados f
     WHERE f.tentativas >= 5
     RETURNING f.lead_id, f.tenant_id
  )
  INSERT INTO public.messages (lead_id, tenant_id, direction, type, content, status)
  SELECT d.lead_id, d.tenant_id, 'outbound', 'system',
         '⚠️ O fechamento automático desta conversa foi cancelado depois de 5 tentativas. Feche pelo botão quando quiser.',
         'system'
    FROM desistiu d;

  -- 6c. adia quem está com a dona dentro da conversa AGORA.
  -- A carência de presença é POR CLIENTE: lida da config do tenant de cada
  -- linha, nunca de um tenant tirado da fila a esmo (o CRClin é multi-cliente e
  -- cada clínica pode ter o seu número).
  UPDATE public.crm_fechamentos_agendados f
     SET fechar_em = now() + make_interval(mins => COALESCE(c.presenca_segura_min, 5))
    FROM public.crm_leads l
    LEFT JOIN public.crm_rodizio_config c ON c.tenant_id = l.tenant_id
   WHERE f.lead_id = l.id
     AND f.fechar_em <= now()
     AND l.em_atendimento_por IS NOT NULL
     AND l.em_atendimento_por = l.assigned_to
     AND l.em_atendimento_em IS NOT NULL
     AND l.em_atendimento_em > now() - make_interval(mins => COALESCE(c.presenca_segura_min, 5));

  -- 6d. o que sobrou e está vencido: marca a tentativa e devolve.
  RETURN QUERY
  WITH alvo AS (
    SELECT f.lead_id
      FROM public.crm_fechamentos_agendados f
     WHERE f.fechar_em <= now()
       AND (f.ultima_tentativa_em IS NULL OR f.ultima_tentativa_em < now() - interval '2 minutes')
     ORDER BY f.fechar_em
     LIMIT GREATEST(COALESCE(p_limite, 30), 1)
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.crm_fechamentos_agendados f
     SET tentativas = f.tentativas + 1, ultima_tentativa_em = now()
    FROM alvo a
   WHERE f.lead_id = a.lead_id
  RETURNING f.lead_id;
END $fn$;

REVOKE ALL ON FUNCTION public.fechar_agendado_pendentes(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fechar_agendado_pendentes(integer) TO service_role;


-- ======================== 7. o fechamento automático, sem usuário logado
-- Gêmeo de conversa_fechar, mas sem auth.uid(): quem chama é a edge function com
-- a service key. Devolve o texto da pesquisa para ELA enviar — o banco não
-- envia WhatsApp, e fingir que envia foi o defeito nº 3 da primeira versão.
CREATE OR REPLACE FUNCTION public.conversa_fechar_automatico(p_lead_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_lead public.crm_leads;
  v_cfg record;
  v_texto text;
  v_primeiro_nome text;
  v_escala_txt text;
  v_resp_id uuid;
  v_pesquisa jsonb;
  v_sem text;
  v_agora timestamptz := now();
BEGIN
  SELECT l.* INTO v_lead FROM public.crm_leads l WHERE l.id = p_lead_id FOR UPDATE;
  IF v_lead.id IS NULL THEN
    DELETE FROM public.crm_fechamentos_agendados WHERE lead_id = p_lead_id;
    RETURN jsonb_build_object('ok', false, 'motivo', 'lead_inexistente');
  END IF;

  -- Alguém fechou antes: sai sem tocar em nada (nem mensagem, nem pesquisa).
  IF v_lead.conversa_fechada_em IS NOT NULL THEN
    DELETE FROM public.crm_fechamentos_agendados WHERE lead_id = p_lead_id;
    RETURN jsonb_build_object('ok', true, 'ja_fechada', true, 'pesquisa', NULL);
  END IF;

  UPDATE public.crm_leads
     SET conversa_fechada_em = v_agora,
         conversa_fechada_por = NULL,
         conversa_fechada_auto = true,
         updated_at = v_agora
   WHERE id = v_lead.id;

  INSERT INTO public.messages (lead_id, tenant_id, direction, type, content, status)
  VALUES (v_lead.id, v_lead.tenant_id, 'outbound', 'system',
          '✅ Conversa fechada automaticamente após o agendamento', 'system');

  -- A pesquisa: mesmas recusas do caminho da tela, mais a régua dos 15 dias.
  SELECT c.ativa, c.texto, c.escala INTO v_cfg
    FROM public.crm_pesquisa_config c WHERE c.tenant_id = v_lead.tenant_id;

  IF v_cfg.ativa IS DISTINCT FROM true OR COALESCE(btrim(v_cfg.texto), '') = '' THEN
    v_sem := 'pesquisa_desligada';
  ELSIF COALESCE(btrim(v_lead.phone), '') = '' THEN
    v_sem := 'lead_sem_telefone';
  ELSIF COALESCE(v_lead.active_channel, 'whatsapp') = 'instagram' THEN
    v_sem := 'canal_instagram';
  ELSIF NOT public.pesquisa_pode_enviar(v_lead.id) THEN
    v_sem := 'pesquisa_recente';
  ELSE
    v_primeiro_nome := NULLIF(split_part(btrim(COALESCE(v_lead.name, '')), ' ', 1), '');
    v_escala_txt := CASE WHEN v_cfg.escala ~ '^\d+-\d+$'
                         THEN 'de ' || split_part(v_cfg.escala, '-', 1) || ' a ' || split_part(v_cfg.escala, '-', 2)
                         ELSE 'de 1 a 5' END;
    v_texto := replace(replace(v_cfg.texto, '{{nome}}', COALESCE(v_primeiro_nome, '')), '{{escala}}', v_escala_txt);
    v_texto := regexp_replace(v_texto, '\s*,\s*([!?.])', '\1', 'g');
    v_texto := regexp_replace(v_texto, '\s{2,}', ' ', 'g');

    INSERT INTO public.crm_pesquisa_respostas
      (tenant_id, lead_id, lead_nome, lead_telefone, responsavel_credito_id, enviada_em, canal)
    VALUES
      (v_lead.tenant_id, v_lead.id, v_lead.name, v_lead.phone, v_lead.assigned_to, v_agora, 'whatsapp')
    RETURNING id INTO v_resp_id;

    v_pesquisa := jsonb_build_object('resposta_id', v_resp_id, 'texto', v_texto,
                                     'telefone', v_lead.phone, 'escala', v_cfg.escala);
  END IF;

  -- Fechou: sai da fila. O que acontecer com a pesquisa daqui para frente é
  -- responsabilidade de quem envia, e a linha dela se desfaz sozinha na falha.
  DELETE FROM public.crm_fechamentos_agendados WHERE lead_id = p_lead_id;

  RETURN jsonb_build_object('ok', true, 'ja_fechada', false,
                            'pesquisa', v_pesquisa, 'pesquisa_nao_enviada', v_sem);
END $fn$;

REVOKE ALL ON FUNCTION public.conversa_fechar_automatico(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conversa_fechar_automatico(uuid) TO service_role;


-- ====================== 8. o botão da tela passa a respeitar os 15 dias
-- Corpo idêntico ao que está em produção (conferido por pg_get_functiondef em
-- 11/09/2026), com DUAS mudanças e nenhuma outra:
--   * mais uma recusa antes de criar a linha da pesquisa: 'pesquisa_recente';
--   * fechar pela tela tira o lead da fila do automático e marca o fechamento
--     como humano (conversa_fechada_auto = false).
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
     SET conversa_fechada_em = v_agora, conversa_fechada_por = v_uid,
         conversa_fechada_auto = false, updated_at = v_agora
   WHERE id = v_lead.id;

  -- Uma pessoa fechou: o relógio do automático não tem mais o que fazer aqui.
  DELETE FROM public.crm_fechamentos_agendados WHERE lead_id = v_lead.id;

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
    ELSIF NOT public.pesquisa_pode_enviar(v_lead.id) THEN
      v_sem := 'pesquisa_recente';
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


-- ============ 9. a tela pergunta ANTES: dá para oferecer a pesquisa neste lead?
-- Sem isto, a SDR marca "enviar pesquisa", fecha, e só então descobre que não
-- podia. Mesma régua, perguntada na hora de desenhar o diálogo.
CREATE OR REPLACE FUNCTION public.pesquisa_oferecer(p_lead_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_lead public.crm_leads;
  v_cfg record;
  v_dias integer;
  v_ultima timestamptz;
BEGIN
  IF auth.uid() IS NULL OR p_lead_id IS NULL THEN RETURN NULL; END IF;
  SELECT l.* INTO v_lead FROM public.crm_leads l
   WHERE l.id = p_lead_id AND l.tenant_id = public.current_tenant_id();
  IF v_lead.id IS NULL OR NOT public.conversa_lead_visivel(v_lead) THEN RETURN NULL; END IF;

  SELECT c.ativa, c.texto, COALESCE(c.intervalo_dias, 15) AS dias INTO v_cfg
    FROM public.crm_pesquisa_config c WHERE c.tenant_id = v_lead.tenant_id;
  v_dias := COALESCE(v_cfg.dias, 15);

  IF v_cfg.ativa IS DISTINCT FROM true OR COALESCE(btrim(v_cfg.texto), '') = '' THEN
    RETURN jsonb_build_object('pode', false, 'motivo', 'pesquisa_desligada',
      'aviso', 'A pesquisa de satisfação está desligada nas configurações da clínica.');
  END IF;
  IF COALESCE(btrim(v_lead.phone), '') = '' THEN
    RETURN jsonb_build_object('pode', false, 'motivo', 'lead_sem_telefone',
      'aviso', 'Este lead não tem telefone cadastrado.');
  END IF;
  IF COALESCE(v_lead.active_channel, 'whatsapp') = 'instagram' THEN
    RETURN jsonb_build_object('pode', false, 'motivo', 'canal_instagram',
      'aviso', 'A conversa é pelo Instagram: a pesquisa sai só por WhatsApp.');
  END IF;

  SELECT max(r.enviada_em) INTO v_ultima
    FROM public.crm_pesquisa_respostas r WHERE r.lead_id = v_lead.id;

  IF v_dias > 0 AND v_ultima IS NOT NULL AND v_ultima > now() - make_interval(days => v_dias) THEN
    RETURN jsonb_build_object('pode', false, 'motivo', 'pesquisa_recente',
      'enviada_em', v_ultima,
      'liberada_em', v_ultima + make_interval(days => v_dias),
      'aviso', 'Este lead já recebeu a pesquisa em '
               || to_char(v_ultima AT TIME ZONE public.rodizio_tz(v_lead.tenant_id), 'DD/MM')
               || '. A próxima só a partir de '
               || to_char((v_ultima + make_interval(days => v_dias)) AT TIME ZONE public.rodizio_tz(v_lead.tenant_id), 'DD/MM')
               || '.');
  END IF;

  RETURN jsonb_build_object('pode', true, 'motivo', NULL, 'aviso', NULL, 'enviada_em', v_ultima);
END $fn$;

REVOKE ALL ON FUNCTION public.pesquisa_oferecer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pesquisa_oferecer(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.pesquisa_oferecer(uuid) IS
  'Diz à tela se a pesquisa cabe neste lead agora, e por que não quando não cabe. Mesma régua de pesquisa_pode_enviar, com o texto pronto para a pessoa ler.';


-- =============================================================================
-- VERIFICAÇÃO (só leitura, depois de aplicar)
--
-- 1) As peças existem?
-- SELECT
--   (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--     WHERE n.nspname='public' AND p.proname IN ('pesquisa_pode_enviar','pesquisa_oferecer',
--       'fechar_agendado_na_janela','fechar_agendado_pendentes','conversa_fechar_automatico',
--       'fecha_agendado_enfileira')) AS funcoes_esperado_6,
--   (SELECT count(*) FROM pg_trigger WHERE tgname='trg_zzz_fecha_agendado_enfileira') AS gatilho_esperado_1,
--   (SELECT count(*) FROM information_schema.columns WHERE table_schema='public'
--     AND (table_name,column_name) IN (('crm_rodizio_config','fechar_agendado_apos_min'),
--         ('crm_pesquisa_config','intervalo_dias'),('crm_leads','conversa_fechada_auto'))) AS colunas_esperado_3;
--
-- 2) A janela comercial acerta? (esperado: madrugada e domingo empurram p/ 08:00 de dia útil)
-- SELECT h AS entrada,
--        public.fechar_agendado_na_janela(h, '00000000-0000-0000-0000-000000000010')
--          AT TIME ZONE 'America/Bahia' AS fecha_em
--   FROM (VALUES (timestamptz '2026-09-11 14:00-03'), (timestamptz '2026-09-11 22:30-03'),
--                (timestamptz '2026-09-12 03:00-03'), (timestamptz '2026-09-13 21:00-03')) v(h);
--
-- 3) NINGUÉM foi fechado de surpresa por esta migration: a fila nasce vazia e só
--    recebe quem ENTRAR na etapa a partir de agora.
-- SELECT count(*) AS na_fila FROM public.crm_fechamentos_agendados;   -- esperado 0
--
-- 4) Quantos leads a régua dos 15 dias protegeria hoje?
-- SELECT count(*) FILTER (WHERE NOT public.pesquisa_pode_enviar(l.id)) AS bloqueados,
--        count(*) AS com_pesquisa_alguma_vez
--   FROM (SELECT DISTINCT lead_id AS id FROM public.crm_pesquisa_respostas) l;
-- =============================================================================


-- ============================================== 10. o cron, de minuto em minuto
-- Mesmo formato do api4com-poll-calls: o segredo sai de _internal_secrets na
-- hora da chamada e nunca aparece no texto do job.
SELECT cron.unschedule('fechar-agendado-pesquisa')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fechar-agendado-pesquisa');

SELECT cron.schedule(
  'fechar-agendado-pesquisa',
  '* * * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://oybroifaleftwrhnlhqc.supabase.co/functions/v1/fechar-agendado-pesquisa',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT value FROM public._internal_secrets WHERE name = 'automation_cron_token')
    ),
    body    := '{"source":"cron"}'::jsonb,
    timeout_milliseconds := 55000
  );
  $cron$
);
