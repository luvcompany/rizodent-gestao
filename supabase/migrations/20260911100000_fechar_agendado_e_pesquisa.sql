-- =============================================================================
-- P2 + P3 — Fechar a conversa 15 minutos depois do agendamento, e pesquisa de
-- satisfação uma vez por lead a cada 15 dias.
--
-- PEDIDOS DO DONO (11/09/2026), palavras dele:
--   (P2) "quando eu terminar de agendar e o lead for movido para agendado, espera
--        15 minutos pra fechar, e já fecha enviando a pesquisa de satisfação.
--        Cuidado para não bugar nisso e acabar não permitindo que eu (sdr) possa
--        abrir a conversa e a automação ficar fechando toda hora e enviando a
--        pesquisa de satisfação mais de uma vez."
--   (P3) "crie uma regra em que eu consiga enviar a pesquisa de satisfação apenas
--        uma vez por lead a cada 15 dias. Então se eu abrir a conversa novamente
--        e fechar não deve aparecer a opção de enviar a pesquisa de satisfação
--        novamente."
--
-- ------------------------------- AS TRÊS TRAVAS ------------------------------
--   1. REABRIR CONTINUA VALENDO. O fechamento automático acontece UMA vez por
--      ENTRADA na etapa: a linha da fila é criada quando o lead ENTRA em
--      'agendado' e some quando o fechamento acontece. Se a SDR reabrir depois,
--      não há mais linha nenhuma — só uma NOVA entrada em 'agendado' enfileira
--      de novo. Nada no caminho automático mexe em quem reabre.
--   2. NÃO FECHA TODA HORA. A fila é por lead (lead_id é a CHAVE PRIMÁRIA) e a
--      linha sai quando fecha ou quando deixa de fazer sentido (lead apagado,
--      lead bloqueado, saiu da etapa, conversa já fechada por alguém). Não há
--      reenfileiramento em laço: quem enfileira é só o gatilho de ENTRADA.
--   3. PESQUISA UMA VEZ A CADA 15 DIAS. public.pesquisa_pode_enviar() é a régua,
--      aplicada nos DOIS caminhos que criam linha em crm_pesquisa_respostas
--      (conversa_fechar e o caminho automático), e a corrida é resolvida por
--      índice único parcial + inserção condicional (ver item 3).
--
-- ------------------------------ O QUE MUDA DE FATO ---------------------------
--   * crm_rodizio_config.fechar_agendado_apos_min (novo, DEFAULT 15)
--   * crm_pesquisa_config.intervalo_dias (novo, DEFAULT 15)
--   * crm_leads.conversa_fechada_auto (novo, DEFAULT false)
--   * public.crm_fechamentos_agendados (fila nova)
--   * gatilho trg_zzz_fecha_agendado_enfileira em crm_leads
--   * public.fechar_conversas_agendadas() (varredura do cron)
--   * public.pesquisa_pode_enviar(), public.pesquisa_monta_texto(),
--     public.pesquisa_pendentes(), public.pesquisa_pendente_tomar()
--   * CREATE OR REPLACE: conversa_fechar, conversa_fecha_na_etapa,
--     relatorio_sdr_calc
--
-- ====================== POR QUE O ATRASO NÃO É atraso_min ====================
-- crm_pesquisa_config.atraso_min existe desde a Fase 0 e NUNCA foi usado (a
-- própria migration 20260909100100 diz: "atraso_min existe na tabela mas NÃO é
-- usado"). Além de estar morto, ele significa outra coisa: é o atraso do ENVIO
-- DA PESQUISA depois do fechamento, não o atraso do FECHAMENTO depois do
-- agendamento — e hoje vale 0 no tenant Rizodent, o que faria o lead fechar no
-- mesmo segundo em que a SDR o move para Agendado, o oposto do pedido. Por isso
-- o atraso do fechamento é coluna nova em crm_rodizio_config (que é onde já
-- moram as réguas de tempo da equipe: realocar_sem_resposta_min,
-- entrega_gestor_apos_min, presenca_segura_min…), com DEFAULT 15.
--
-- ======================= O QUE ESTA MIGRATION **NÃO** FAZ ====================
-- NÃO ENVIA A MENSAGEM DE WHATSAPP. Conferido no banco e no repositório: hoje
-- NENHUM caminho do Postgres envia WhatsApp. Quem envia é sempre a tela
-- (src/lib/fecharConversa.ts chama a função de borda send-whatsapp-message) ou
-- uma edge function; send-whatsapp-message só aceita JWT de usuário ou a
-- SERVICE_ROLE_KEY (supabase/functions/_shared/authz.ts → resolveCaller), que
-- não existe dentro do banco (não está em public._internal_secrets, nem no
-- vault, nem em GUC). Ou seja: o próprio public.conversa_fechar NÃO envia nada —
-- ele cria a linha em crm_pesquisa_respostas e DEVOLVE o texto para quem chamou
-- enviar.
--
-- Consequência de desenho, e é deliberada: o caminho automático NÃO cria a
-- linha de crm_pesquisa_respostas na hora de fechar. Se criasse, teríamos uma
-- pesquisa marcada como "enviada" que nunca saiu — que é o pior dos mundos:
-- mentiria no relatório da SDR E queimaria a janela de 15 dias do P3 com uma
-- mensagem que o paciente nunca recebeu. Em vez disso a linha da fila fica viva
-- marcada como pesquisa_pendente, e a linha da pesquisa só nasce no instante em
-- que alguém realmente vai enviar, por public.pesquisa_pendente_tomar() (que a
-- tela chama e que já devolve o mesmo formato que conversa_fechar devolve, para
-- o envio reusar o código que existe). Pendência não tomada em 24 h é
-- descartada com aviso no chat — pesquisa três dias depois da consulta é pior
-- que pesquisa nenhuma.
-- =============================================================================


-- =============================================== 1. as duas réguas configuráveis
ALTER TABLE public.crm_rodizio_config
  ADD COLUMN IF NOT EXISTS fechar_agendado_apos_min integer NOT NULL DEFAULT 15;

COMMENT ON COLUMN public.crm_rodizio_config.fechar_agendado_apos_min IS
  'Minutos entre o lead ENTRAR na etapa Agendado e a conversa fechar sozinha (P2). 0 ou negativo desliga o fechamento automático desse cliente.';

ALTER TABLE public.crm_pesquisa_config
  ADD COLUMN IF NOT EXISTS intervalo_dias integer NOT NULL DEFAULT 15;

COMMENT ON COLUMN public.crm_pesquisa_config.intervalo_dias IS
  'Janela mínima entre duas pesquisas de satisfação do MESMO lead, em dias (P3). 0 desliga a trava.';

-- Autoria do fechamento automático. Sem esta coluna o relatório da SDR credita a
-- ela toda conversa fechada pelo robô: relatorio_sdr_calc conta por
-- COALESCE(conversa_fechada_por, assigned_to), e o caminho automático deixa
-- conversa_fechada_por NULA de propósito (não foi pessoa nenhuma que fechou).
ALTER TABLE public.crm_leads
  ADD COLUMN IF NOT EXISTS conversa_fechada_auto boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.crm_leads.conversa_fechada_auto IS
  'true quando quem fechou a conversa foi automação (etapa/fila), não uma pessoa. O relatório da SDR NÃO conta estas como "conversas fechadas" dela.';


-- ====================================== 2. a trava de corrida da pesquisa (P3)
-- A régua do P3 é "nada nos últimos N dias", mas índice único não aceita
-- predicado com now() (não é IMMUTABLE). O que dá para cravar no armazenamento é
-- o PISO que mata a corrida de verdade: dois fechamentos do mesmo lead no mesmo
-- instante (a SDR clicando enquanto a varredura roda, ou dois cliques/duas abas).
-- Uma pesquisa por lead por DIA (UTC) é impossível de violar em uma corrida de
-- segundos, e não atrapalha o caso legítimo (a próxima é 15 dias depois).
-- timezone('UTC', ts) é IMMUTABLE (timestamptz -> timestamp com zona literal),
-- por isso indexável; enviada_em::date NÃO seria (depende do GUC TimeZone).
-- Conferido em 11/09/2026: 12 linhas na tabela, ZERO leads com duas no mesmo dia
-- — o índice sobe sem conflito.
CREATE UNIQUE INDEX IF NOT EXISTS crm_pesquisa_respostas_lead_dia_uidx
  ON public.crm_pesquisa_respostas (lead_id, ((timezone('UTC'::text, enviada_em))::date))
  WHERE lead_id IS NOT NULL;

COMMENT ON INDEX public.crm_pesquisa_respostas_lead_dia_uidx IS
  'Piso anti-corrida do P3: no máximo uma pesquisa por lead por dia (UTC). A régua de negócio (15 dias) é public.pesquisa_pode_enviar; este índice é o que sobra quando duas transações passam pela checagem ao mesmo tempo.';


-- ============================================ 3. pesquisa_pode_enviar (a régua)
CREATE OR REPLACE FUNCTION public.pesquisa_pode_enviar(p_lead_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_lead public.crm_leads;
  v_dias integer;
BEGIN
  IF p_lead_id IS NULL THEN RETURN false; END IF;

  SELECT l.* INTO v_lead FROM public.crm_leads l WHERE l.id = p_lead_id;
  IF v_lead.id IS NULL THEN RETURN false; END IF;

  -- COM SESSÃO (a tela perguntando "mostro o botão?"): só responde sobre lead do
  -- próprio cliente e que a pessoa alcança. Responde FALSO em vez de levantar
  -- exceção — isto aqui é uma pergunta de tela, chamada o tempo todo; erro 42501
  -- viraria toast de erro em vez de esconder a opção. SEM SESSÃO (cron,
  -- service_role, a própria conversa_fechar) passa direto para a régua de tempo.
  IF auth.uid() IS NOT NULL THEN
    IF public.current_tenant_id() IS NULL
       OR v_lead.tenant_id IS DISTINCT FROM public.current_tenant_id()
       OR NOT public.conversa_lead_visivel(v_lead) THEN
      RETURN false;
    END IF;
  END IF;

  SELECT c.intervalo_dias INTO v_dias
    FROM public.crm_pesquisa_config c WHERE c.tenant_id = v_lead.tenant_id;
  v_dias := GREATEST(COALESCE(v_dias, 15), 0);
  IF v_dias = 0 THEN RETURN true; END IF;   -- cliente que desligou a trava

  RETURN NOT EXISTS (
    SELECT 1 FROM public.crm_pesquisa_respostas r
     WHERE r.lead_id = p_lead_id
       AND r.enviada_em >= now() - make_interval(days => v_dias)
  );
END $fn$;

COMMENT ON FUNCTION public.pesquisa_pode_enviar(uuid) IS
  'P3: cabe pesquisa de satisfação para este lead? false quando já existe linha em crm_pesquisa_respostas com enviada_em dentro de crm_pesquisa_config.intervalo_dias (padrão 15 dias). Também é a função que a TELA chama para esconder a opção "Fechar e enviar pesquisa" (devolve false, sem exceção, para lead fora do alcance de quem pergunta).';

REVOKE ALL ON FUNCTION public.pesquisa_pode_enviar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pesquisa_pode_enviar(uuid) TO authenticated, service_role;


-- ================================= 4. o texto da pesquisa, em um lugar só
-- Extraído de conversa_fechar SEM mudar uma vírgula do comportamento (mesmas
-- substituições, mesma limpeza da vírgula órfã de "Olá, {{nome}}!" sem nome,
-- mesmo padrão de escala). Existe para que os caminhos novos (tela de pendências
-- e pesquisa_pendente_tomar) não repitam a regra e ela não passe a divergir.
CREATE OR REPLACE FUNCTION public.pesquisa_monta_texto(p_nome text, p_texto text, p_escala text)
RETURNS text
LANGUAGE sql
IMMUTABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT regexp_replace(
           regexp_replace(
             replace(
               replace(COALESCE(p_texto, ''), '{{nome}}',
                       COALESCE(NULLIF(split_part(btrim(COALESCE(p_nome, '')), ' ', 1), ''), '')),
               '{{escala}}',
               CASE WHEN p_escala ~ '^\d+-\d+$'
                    THEN 'de ' || split_part(p_escala, '-', 1) || ' a ' || split_part(p_escala, '-', 2)
                    ELSE 'de 1 a 5' END),
             '\s*,\s*([!?.])', '\1', 'g'),
           '\s{2,}', ' ', 'g');
$fn$;

COMMENT ON FUNCTION public.pesquisa_monta_texto(text, text, text) IS
  'Monta o texto da pesquisa de satisfação ({{nome}} = primeiro nome, {{escala}} = "de X a Y", vírgula órfã limpa). Mesma regra que conversa_fechar já usava — agora em um lugar só.';

REVOKE ALL ON FUNCTION public.pesquisa_monta_texto(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pesquisa_monta_texto(text, text, text) TO authenticated, service_role;


-- ======================== 5. conversa_fechar: a guarda do P3 e a autoria humana
-- CREATE OR REPLACE do corpo que está em produção, com TRÊS acréscimos e nada
-- mais:
--   (a) o UPDATE do lead grava conversa_fechada_auto = false (fechamento humano,
--       o relatório da SDR deve contar);
--   (b) motivo novo 'pesquisa_recente' quando pesquisa_pode_enviar diz não —
--       mesmo padrão do campo pesquisa_nao_enviada que a tela já lê;
--   (c) a inserção da pesquisa virou CONDICIONAL e à prova do índice único: se
--       outra transação criou a linha no meio do caminho, a pesquisa não sai e o
--       motivo devolvido é o mesmo 'pesquisa_recente'. A conversa fecha do mesmo
--       jeito — fechar é o trabalho, a pesquisa é o acessório.
CREATE OR REPLACE FUNCTION public.conversa_fechar(p_lead_id uuid, p_enviar_pesquisa boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_lead public.crm_leads;
  v_nome text;
  v_cfg record;
  v_texto text;
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
      -- P3: este lead já recebeu pesquisa dentro da janela (padrão 15 dias).
      v_sem := 'pesquisa_recente';
    ELSE
      v_texto := public.pesquisa_monta_texto(v_lead.name, v_cfg.texto, v_cfg.escala);

      -- Inserção condicional + captura do índice único: a checagem acima pode
      -- ter sido feita ao mesmo tempo por outra transação (a varredura das
      -- pendências, outra aba). Nunca confiar só no IF.
      BEGIN
        INSERT INTO public.crm_pesquisa_respostas
          (tenant_id, lead_id, lead_nome, lead_telefone, responsavel_credito_id, enviada_em, canal)
        SELECT v_lead.tenant_id, v_lead.id, v_lead.name, v_lead.phone,
               COALESCE(v_lead.assigned_to, v_uid), v_agora, 'whatsapp'
         WHERE public.pesquisa_pode_enviar(v_lead.id)
        RETURNING id INTO v_resp_id;
      EXCEPTION WHEN unique_violation THEN
        v_resp_id := NULL;
      END;

      IF v_resp_id IS NULL THEN
        v_sem := 'pesquisa_recente';
      ELSE
        v_pesquisa := jsonb_build_object('resposta_id', v_resp_id, 'texto', v_texto,
                                         'telefone', v_lead.phone, 'escala', v_cfg.escala);
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'ja_fechada', false, 'conversa_fechada_em', v_agora,
                            'pesquisa', v_pesquisa, 'pesquisa_nao_enviada', v_sem);
END $fn$;

COMMENT ON FUNCTION public.conversa_fechar(uuid, boolean) IS
  'Fecha a conversa do lead (autoria humana) e, com p_enviar_pesquisa, prepara a pesquisa de satisfação e devolve o texto para a tela enviar. Motivos possíveis em pesquisa_nao_enviada: pesquisa_desligada, lead_sem_telefone, canal_instagram, pesquisa_recente (P3: já recebeu dentro de crm_pesquisa_config.intervalo_dias).';


-- ============================================= 6. a fila do fechamento marcado
CREATE TABLE IF NOT EXISTS public.crm_fechamentos_agendados (
  lead_id              uuid PRIMARY KEY REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  tenant_id            uuid NOT NULL,
  fechar_em            timestamptz NOT NULL,
  criado_em            timestamptz NOT NULL DEFAULT now(),
  tentativas           integer NOT NULL DEFAULT 0,
  -- Acréscimos ao mínimo pedido, cada um com um motivo:
  -- stage_id: qual etapa 'Agendado' gerou a linha (o tenant tem 13 etapas com
  -- esse nome, uma por funil) — serve para o livro e para depurar.
  stage_id             uuid,
  -- pesquisa_pendente: depois de FECHAR, a linha não é apagada quando ainda cabe
  -- pesquisa; ela vira "pesquisa esperando quem envie". Ver o cabeçalho: o banco
  -- não envia WhatsApp, e criar a linha da pesquisa aqui seria marcar como
  -- enviada uma mensagem que ninguém mandou.
  pesquisa_pendente    boolean NOT NULL DEFAULT false,
  pesquisa_pendente_em timestamptz
);

ALTER TABLE public.crm_fechamentos_agendados ADD COLUMN IF NOT EXISTS stage_id uuid;
ALTER TABLE public.crm_fechamentos_agendados ADD COLUMN IF NOT EXISTS pesquisa_pendente boolean NOT NULL DEFAULT false;
ALTER TABLE public.crm_fechamentos_agendados ADD COLUMN IF NOT EXISTS pesquisa_pendente_em timestamptz;

COMMENT ON TABLE public.crm_fechamentos_agendados IS
  'Fila do P2: um lead por linha (lead_id é a chave primária) esperando o fechamento automático 15 min depois de entrar em Agendado. Depois do fechamento a linha some — ou vira pesquisa_pendente até alguém enviar a pesquisa (ou 24 h, o que vier antes).';

CREATE INDEX IF NOT EXISTS crm_fechamentos_agendados_quando_idx
  ON public.crm_fechamentos_agendados (fechar_em) WHERE NOT pesquisa_pendente;
CREATE INDEX IF NOT EXISTS crm_fechamentos_agendados_pendente_idx
  ON public.crm_fechamentos_agendados (pesquisa_pendente_em) WHERE pesquisa_pendente;

-- RLS LIGADA E SEM POLICY, igual a public.crm_entregas_gestor (conferido:
-- relrowsecurity = true, zero linhas em pg_policy). Fila interna não é tela:
-- ninguém alcança pelo PostgREST, só as funções SECURITY DEFINER abaixo e o
-- service_role. Nenhuma policy existente é tocada por esta migration.
ALTER TABLE public.crm_fechamentos_agendados ENABLE ROW LEVEL SECURITY;


-- ================================================== 7. quem enfileira: a ENTRADA
CREATE OR REPLACE FUNCTION public.fecha_agendado_enfileira()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_nome text;
  v_norm text;
  v_min  integer;
BEGIN
  -- ENTRADA, não toque: "AFTER UPDATE OF stage_id" dispara sempre que a coluna
  -- aparece no SET, mesmo com o mesmo valor. Sem etapa nova não houve entrada —
  -- e é isto que impede a fila de ser reescrita a cada salvamento do lead.
  IF NEW.stage_id IS NULL OR NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
    RETURN NEW;
  END IF;
  IF NEW.tenant_id IS NULL THEN RETURN NEW; END IF;

  -- Nada aqui pode derrubar a mudança de etapa: mover o lead é o trabalho da
  -- pessoa, marcar o fechamento é comodidade. Mesmo padrão de
  -- sdr_etapa_oculta_entrega e conversa_reabre_ao_enviar.
  BEGIN
    SELECT s.name INTO v_nome FROM public.crm_stages s WHERE s.id = NEW.stage_id;
    v_norm := public.normaliza_nome_etapa(v_nome);

    IF v_norm IS DISTINCT FROM 'agendado' THEN
      -- Saiu de Agendado antes da hora: o fechamento marcado (e a pesquisa
      -- pendente) perdem o sentido. É a trava 2 agindo na hora, sem esperar o
      -- cron descobrir.
      DELETE FROM public.crm_fechamentos_agendados WHERE lead_id = NEW.id;
      RETURN NEW;
    END IF;

    SELECT c.fechar_agendado_apos_min INTO v_min
      FROM public.crm_rodizio_config c WHERE c.tenant_id = NEW.tenant_id;
    -- Cliente sem linha de configuração (ou com 0) não ganha fechamento
    -- automático: quem nunca pediu não deve ter conversa fechando sozinha.
    IF v_min IS NULL OR v_min <= 0 THEN RETURN NEW; END IF;

    INSERT INTO public.crm_fechamentos_agendados
      (lead_id, tenant_id, fechar_em, criado_em, tentativas, stage_id, pesquisa_pendente, pesquisa_pendente_em)
    VALUES
      (NEW.id, NEW.tenant_id, now() + make_interval(mins => v_min), now(), 0, NEW.stage_id, false, NULL)
    ON CONFLICT (lead_id) DO UPDATE
      SET tenant_id            = EXCLUDED.tenant_id,
          fechar_em            = EXCLUDED.fechar_em,   -- nova entrada, novo relógio
          criado_em            = EXCLUDED.criado_em,
          tentativas           = 0,
          stage_id             = EXCLUDED.stage_id,
          pesquisa_pendente    = false,
          pesquisa_pendente_em = NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fecha_agendado_enfileira: % (lead %)', SQLERRM, NEW.id;
  END;

  RETURN NEW;
END $fn$;

COMMENT ON FUNCTION public.fecha_agendado_enfileira() IS
  'Marca (ou desmarca) o fechamento automático quando o lead ENTRA em uma etapa Agendado. Uma linha por lead; entrar de novo reinicia o relógio; sair da etapa apaga a linha.';

REVOKE ALL ON FUNCTION public.fecha_agendado_enfileira() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fecha_agendado_enfileira() TO authenticated, service_role;

-- Nome com "trg_zzz_" pelo mesmo motivo do gatilho irmão
-- (trg_zzz_conversa_fecha_na_etapa): rodar DEPOIS do histórico de etapa, do
-- enfileiramento de automações e da entrega ao administrador, que leem a linha
-- do lead. Entre os dois "trg_zzz_" a ordem é indiferente — depois do item 8 o
-- irmão não olha mais para 'agendado'.
DROP TRIGGER IF EXISTS trg_zzz_fecha_agendado_enfileira ON public.crm_leads;
CREATE TRIGGER trg_zzz_fecha_agendado_enfileira
  AFTER UPDATE OF stage_id ON public.crm_leads
  FOR EACH ROW
  WHEN (NEW.stage_id IS DISTINCT FROM OLD.stage_id)
  EXECUTE FUNCTION public.fecha_agendado_enfileira();


-- ================= 8. 'Agendado' sai do fechamento IMEDIATO por etapa
-- A migration 20260911070000 (escrita, AINDA NÃO APLICADA — conferido em
-- supabase_migrations.schema_migrations e em pg_proc: a função não existe em
-- produção) fecha a conversa NA HORA em que o lead entra em Agendado,
-- Reagendado ou Relacionamento. Se ela ficasse como está, o P2 nasceria morto:
-- aos 15 minutos a varredura encontraria "conversa já fechada por alguém",
-- largaria a linha e a pesquisa nunca sairia — e o dono teria pedido 15 minutos
-- para receber 0 segundos.
-- Então 'agendado' sai DAQUI e passa a ser tratado pela fila (que fecha E
-- prepara a pesquisa). Reagendado e Relacionamento continuam fechando na hora,
-- como ele pediu ontem — agora carimbando conversa_fechada_auto, senão o
-- relatório da SDR credita a ela o fechamento do robô (item 11).
-- Ordem garantida: 20260911070000 < 20260911100000.
CREATE OR REPLACE FUNCTION public.conversa_fecha_na_etapa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_nome   text;
  v_norm   text;
  v_fechou boolean;
BEGIN
  IF NEW.stage_id IS NULL OR NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
    RETURN NEW;
  END IF;
  IF NEW.conversa_fechada_em IS NOT NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT s.name INTO v_nome FROM public.crm_stages s WHERE s.id = NEW.stage_id;
    v_norm := public.normaliza_nome_etapa(v_nome);
    -- 'agendado' NÃO está mais nesta lista: ele espera os 15 minutos da fila.
    IF v_norm NOT IN ('reagendado', 'relacionamento') THEN
      RETURN NEW;
    END IF;

    UPDATE public.crm_leads
       SET conversa_fechada_em  = now(),
           conversa_fechada_por = NULL,
           conversa_fechada_auto = true,
           updated_at           = now()
     WHERE id = NEW.id
       AND conversa_fechada_em IS NULL
    RETURNING true INTO v_fechou;

    IF COALESCE(v_fechou, false) THEN
      PERFORM public.rodizio_msg_sistema(
        NEW.id, NEW.tenant_id,
        '🔒 Conversa fechada automaticamente: o lead entrou na etapa "'
        || COALESCE(NULLIF(btrim(v_nome), ''), 'desta etapa')
        || '". Nada sumiu — a conversa continua na lista, só marcada como fechada. '
        || 'Ela reabre assim que alguém da equipe enviar uma mensagem, ou no botão Reabrir.');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'conversa_fecha_na_etapa: % (lead %)', SQLERRM, NEW.id;
  END;

  RETURN NEW;
END $fn$;

COMMENT ON FUNCTION public.conversa_fecha_na_etapa() IS
  'Fecha a conversa na hora em que o lead entra em Reagendado ou Relacionamento (autoria automática). Agendado NÃO entra aqui: ele passa pela fila crm_fechamentos_agendados, que espera 15 min e ainda prepara a pesquisa de satisfação.';

-- Repetidos de propósito: se por algum motivo a migration 20260911070000 não
-- tiver sido aplicada antes desta, o CREATE OR REPLACE acima CRIA a função — e
-- função recém-criada nasce executável por PUBLIC. Com a 070000 aplicada, estas
-- duas linhas são inócuas (já é o estado dela).
REVOKE ALL ON FUNCTION public.conversa_fecha_na_etapa() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conversa_fecha_na_etapa() TO authenticated, service_role;


-- ====================================== 9. a varredura que o cron vai chamar
-- Molde: public.sdr_entregas_pendentes (mesma forma de laço, mesmo teto de 200,
-- mesmo bloco EXCEPTION por item, mesmo recuo progressivo por tentativa, mesma
-- desistência acima de 5 tentativas).
CREATE OR REPLACE FUNCTION public.fechar_conversas_agendadas()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET lock_timeout TO '5s'
AS $fn$
DECLARE
  e       record;
  l       public.crm_leads;
  v_cfg   record;
  v_n     integer := 0;
  v_fechou boolean;
  v_norm  text;
  v_min   integer;
  v_sem   text;
  v_aviso text;
BEGIN
  -- (a) PENDÊNCIAS DE PESQUISA VENCIDAS. Ninguém tomou em 24 h: a pesquisa não
  -- sai mais (pesquisa três dias depois da consulta é pior que nenhuma) e o
  -- chat registra o porquê, para a SDR não descobrir pelo silêncio.
  FOR e IN SELECT f.* FROM public.crm_fechamentos_agendados f
            WHERE f.pesquisa_pendente
              AND COALESCE(f.pesquisa_pendente_em, f.criado_em) < now() - interval '24 hours'
            ORDER BY f.pesquisa_pendente_em
            LIMIT 200 LOOP
    BEGIN
      PERFORM public.rodizio_msg_sistema(e.lead_id, e.tenant_id,
        '⚠️ A pesquisa de satisfação deste lead não foi enviada: ficou 24 horas esperando envio. '
        || 'A conversa continua fechada; se quiser, reabra e feche de novo escolhendo "Fechar e enviar pesquisa".');
      DELETE FROM public.crm_fechamentos_agendados WHERE lead_id = e.lead_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'fechar_conversas_agendadas (pendencia vencida): % (lead %)', SQLERRM, e.lead_id;
    END;
  END LOOP;

  -- (b) FECHAMENTOS NA HORA.
  FOR e IN SELECT f.* FROM public.crm_fechamentos_agendados f
            WHERE NOT f.pesquisa_pendente
              AND f.fechar_em <= now()
            ORDER BY f.fechar_em
            LIMIT 200 LOOP
    BEGIN
      SELECT * INTO l FROM public.crm_leads WHERE id = e.lead_id;
      IF NOT FOUND THEN
        DELETE FROM public.crm_fechamentos_agendados WHERE lead_id = e.lead_id;
        CONTINUE;
      END IF;

      -- Desistência: a linha que sempre estoura não pode voltar para sempre.
      IF COALESCE(e.tentativas, 0) > 5 THEN
        RAISE WARNING 'fechar_conversas_agendadas: desistindo do lead % depois de % tentativas', e.lead_id, e.tentativas;
        DELETE FROM public.crm_fechamentos_agendados WHERE lead_id = e.lead_id;
        CONTINUE;
      END IF;

      -- Deixou de fazer sentido (trava 2). Cada um destes apaga a linha: ela não
      -- volta sozinha, só uma NOVA entrada em Agendado enfileira de novo.
      --   * lead bloqueado    -> não se escreve nada no chat dele;
      --   * saiu da etapa     -> o agendamento mudou de ideia;
      --   * já fechada        -> alguém (ou o gatilho de etapa) fechou antes.
      IF COALESCE(l.is_blocked, false) THEN
        DELETE FROM public.crm_fechamentos_agendados WHERE lead_id = e.lead_id;
        CONTINUE;
      END IF;

      SELECT public.normaliza_nome_etapa(s.name) INTO v_norm
        FROM public.crm_stages s WHERE s.id = l.stage_id;
      IF v_norm IS DISTINCT FROM 'agendado' THEN
        DELETE FROM public.crm_fechamentos_agendados WHERE lead_id = e.lead_id;
        CONTINUE;
      END IF;

      IF l.conversa_fechada_em IS NOT NULL THEN
        DELETE FROM public.crm_fechamentos_agendados WHERE lead_id = e.lead_id;
        CONTINUE;
      END IF;

      -- FECHA. conversa_fechada_por fica NULA (não foi pessoa nenhuma) e
      -- conversa_fechada_auto = true para o relatório da SDR não contar isto
      -- como trabalho dela. O WHERE é a trava de corrida: se alguém fechou entre
      -- a leitura e agora, nada acontece e a linha sai.
      UPDATE public.crm_leads
         SET conversa_fechada_em   = now(),
             conversa_fechada_por  = NULL,
             conversa_fechada_auto = true,
             updated_at            = now()
       WHERE id = l.id AND conversa_fechada_em IS NULL
      RETURNING true INTO v_fechou;

      IF NOT COALESCE(v_fechou, false) THEN
        DELETE FROM public.crm_fechamentos_agendados WHERE lead_id = e.lead_id;
        CONTINUE;
      END IF;
      v_n := v_n + 1;

      -- Cabe pesquisa? Mesmas guardas de conversa_fechar, na mesma ordem, mais a
      -- régua do P3 no fim.
      SELECT c.ativa, c.texto INTO v_cfg
        FROM public.crm_pesquisa_config c WHERE c.tenant_id = l.tenant_id;
      SELECT c.fechar_agendado_apos_min INTO v_min
        FROM public.crm_rodizio_config c WHERE c.tenant_id = l.tenant_id;

      v_sem := CASE
                 WHEN v_cfg.ativa IS DISTINCT FROM true OR COALESCE(btrim(v_cfg.texto), '') = ''
                   THEN 'pesquisa_desligada'
                 WHEN COALESCE(btrim(l.phone), '') = ''      THEN 'lead_sem_telefone'
                 WHEN COALESCE(l.active_channel, 'whatsapp') = 'instagram' THEN 'canal_instagram'
                 WHEN NOT public.pesquisa_pode_enviar(l.id)  THEN 'pesquisa_recente'
                 ELSE NULL
               END;

      v_aviso := CASE v_sem
                   WHEN 'pesquisa_desligada' THEN 'Sem pesquisa de satisfação: a clínica está com a pesquisa desligada.'
                   WHEN 'lead_sem_telefone'  THEN 'Sem pesquisa de satisfação: o lead não tem telefone.'
                   WHEN 'canal_instagram'    THEN 'Sem pesquisa de satisfação: a conversa é pelo Instagram.'
                   WHEN 'pesquisa_recente'   THEN 'Sem pesquisa de satisfação: este lead já respondeu/recebeu uma nos últimos dias.'
                   ELSE 'A pesquisa de satisfação está pronta para sair e aparece como pendente na tela.'
                 END;

      -- Mensagem de SISTEMA (type='system', status='system'): conferido em
      -- public.rodizio_msg_humana, que recusa status em ('system','failed'), e no
      -- WHEN de trg_zz_conversa_reabre_ao_enviar, que exige type <> 'system'.
      -- Logo esta linha NÃO reabre a conversa que acabamos de fechar — não há
      -- laço fecha-reabre-fecha.
      PERFORM public.rodizio_msg_sistema(l.id, l.tenant_id,
        '🔒 Conversa fechada automaticamente: o lead está na etapa Agendado há '
        || COALESCE(v_min, 15) || ' minutos. ' || v_aviso
        || ' Nada sumiu — a conversa reabre assim que alguém da equipe enviar uma mensagem, ou no botão Reabrir.');

      IF v_sem IS NULL THEN
        -- A linha CONTINUA, agora como "pesquisa esperando quem envie". Ela não
        -- fecha mais nada: o laço (b) só olha NOT pesquisa_pendente.
        UPDATE public.crm_fechamentos_agendados
           SET pesquisa_pendente = true, pesquisa_pendente_em = now(), tentativas = 0
         WHERE lead_id = e.lead_id;
      ELSE
        DELETE FROM public.crm_fechamentos_agendados WHERE lead_id = e.lead_id;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'fechar_conversas_agendadas: % (lead %)', SQLERRM, e.lead_id;
      -- Erro também é tentativa (o bloco acima foi desfeito), com recuo
      -- progressivo: sem isso a linha que sempre estoura voltaria a cada minuto.
      BEGIN
        UPDATE public.crm_fechamentos_agendados
           SET tentativas = COALESCE(tentativas, 0) + 1,
               fechar_em  = now() + make_interval(mins => 5 * (COALESCE(tentativas, 0) + 1))
         WHERE lead_id = e.lead_id;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END;
  END LOOP;

  RETURN v_n;
END $fn$;

COMMENT ON FUNCTION public.fechar_conversas_agendadas() IS
  'Varredura do P2 (cron): fecha as conversas cujo prazo de 15 min em Agendado venceu, avisa no chat e deixa a pesquisa de satisfação pendente de envio. Devolve quantas conversas fechou.';

REVOKE ALL ON FUNCTION public.fechar_conversas_agendadas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fechar_conversas_agendadas() TO authenticated, service_role;


-- ========================= 10. a ponte com a tela: listar e TOMAR a pesquisa
-- A tela já sabe enviar (src/lib/fecharConversa.ts): recebe
-- {resposta_id, texto, telefone, escala}, chama send-whatsapp-message e, se o
-- envio falhar, chama pesquisa_envio_falhou (que apaga a linha para não contar
-- como enviada). pesquisa_pendente_tomar devolve EXATAMENTE esse formato, então
-- o envio automático reusa o caminho que existe, sem fluxo novo.
CREATE OR REPLACE FUNCTION public.pesquisa_pendentes()
RETURNS TABLE(lead_id uuid, lead_nome text, telefone text, texto text, escala text, pendente_desde timestamptz)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_tenant uuid := public.current_tenant_id();
BEGIN
  IF auth.uid() IS NULL OR v_tenant IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT l.id,
         l.name,
         l.phone,
         public.pesquisa_monta_texto(l.name, c.texto, c.escala),
         c.escala,
         f.pesquisa_pendente_em
    FROM public.crm_fechamentos_agendados f
    JOIN public.crm_leads l          ON l.id = f.lead_id
    JOIN public.crm_pesquisa_config c ON c.tenant_id = l.tenant_id
   WHERE f.pesquisa_pendente
     AND f.tenant_id = v_tenant
     AND c.ativa
     AND COALESCE(btrim(c.texto), '') <> ''
     AND COALESCE(btrim(l.phone), '') <> ''
     AND COALESCE(l.active_channel, 'whatsapp') <> 'instagram'
     AND NOT COALESCE(l.is_blocked, false)
     -- Só quem a pessoa alcança (SDR vê o lead dela; gestão vê o do cliente):
     -- mesma régua da tela de conversa.
     AND public.conversa_lead_visivel(l)
     AND public.pesquisa_pode_enviar(l.id)
   ORDER BY f.pesquisa_pendente_em
   LIMIT 50;
END $fn$;

COMMENT ON FUNCTION public.pesquisa_pendentes() IS
  'Pesquisas de satisfação que o fechamento automático deixou prontas e ainda não saíram, no alcance de quem pergunta. A tela lista, e para cada uma chama pesquisa_pendente_tomar antes de enviar.';

REVOKE ALL ON FUNCTION public.pesquisa_pendentes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pesquisa_pendentes() TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.pesquisa_pendente_tomar(p_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid   uuid := auth.uid();
  v_lead  public.crm_leads;
  v_cfg   record;
  v_texto text;
  v_resp_id uuid;
  v_tomou boolean;
  v_sem   text;
BEGIN
  -- Mesma porta de conversa_fechar/conversa_reabrir: só a dona do lead ou a
  -- gestão (levanta 42501 para o resto).
  v_lead := public.conversa_lead_alcancavel(p_lead_id);

  -- A TOMADA É O DELETE. Duas abas (ou duas SDRs) chamando junto: só uma apaga a
  -- linha, a outra recebe sem_pendencia. É esta operação — e não a checagem — que
  -- garante um envio só.
  DELETE FROM public.crm_fechamentos_agendados
   WHERE lead_id = v_lead.id AND pesquisa_pendente
  RETURNING true INTO v_tomou;

  IF NOT COALESCE(v_tomou, false) THEN
    RETURN jsonb_build_object('ok', true, 'pesquisa', NULL, 'pesquisa_nao_enviada', 'sem_pendencia');
  END IF;

  SELECT c.ativa, c.texto, c.escala INTO v_cfg
    FROM public.crm_pesquisa_config c WHERE c.tenant_id = v_lead.tenant_id;

  v_sem := CASE
             WHEN v_cfg.ativa IS DISTINCT FROM true OR COALESCE(btrim(v_cfg.texto), '') = ''
               THEN 'pesquisa_desligada'
             WHEN COALESCE(btrim(v_lead.phone), '') = ''       THEN 'lead_sem_telefone'
             WHEN COALESCE(v_lead.active_channel, 'whatsapp') = 'instagram' THEN 'canal_instagram'
             WHEN COALESCE(v_lead.is_blocked, false)           THEN 'lead_bloqueado'
             WHEN NOT public.pesquisa_pode_enviar(v_lead.id)   THEN 'pesquisa_recente'
             ELSE NULL
           END;

  IF v_sem IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'pesquisa', NULL, 'pesquisa_nao_enviada', v_sem);
  END IF;

  v_texto := public.pesquisa_monta_texto(v_lead.name, v_cfg.texto, v_cfg.escala);

  BEGIN
    INSERT INTO public.crm_pesquisa_respostas
      (tenant_id, lead_id, lead_nome, lead_telefone, responsavel_credito_id, enviada_em, canal)
    SELECT v_lead.tenant_id, v_lead.id, v_lead.name, v_lead.phone,
           COALESCE(v_lead.assigned_to, v_uid), now(), 'whatsapp'
     WHERE public.pesquisa_pode_enviar(v_lead.id)
    RETURNING id INTO v_resp_id;
  EXCEPTION WHEN unique_violation THEN
    v_resp_id := NULL;
  END;

  IF v_resp_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'pesquisa', NULL, 'pesquisa_nao_enviada', 'pesquisa_recente');
  END IF;

  RETURN jsonb_build_object('ok', true, 'pesquisa_nao_enviada', NULL,
    'pesquisa', jsonb_build_object('resposta_id', v_resp_id, 'texto', v_texto,
                                   'telefone', v_lead.phone, 'escala', v_cfg.escala));
END $fn$;

COMMENT ON FUNCTION public.pesquisa_pendente_tomar(uuid) IS
  'Toma para si a pesquisa pendente de um lead (o DELETE da fila é a tomada) e cria a linha em crm_pesquisa_respostas sob a régua dos 15 dias. Devolve {pesquisa:{resposta_id,texto,telefone,escala}} — o mesmo formato de conversa_fechar — ou pesquisa_nao_enviada com o motivo.';

REVOKE ALL ON FUNCTION public.pesquisa_pendente_tomar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pesquisa_pendente_tomar(uuid) TO authenticated, service_role;


-- ============ 11. o relatório da SDR não pode contar o fechamento do robô
-- Hoje o cartão "conversas fechadas" conta por
-- COALESCE(l.conversa_fechada_por, l.assigned_to): com autoria NULA (que é o que
-- todo fechamento automático grava, aqui e no gatilho de etapa) o crédito caía
-- na dona do lead e o indicador dela inflava sozinho — ela "fecharia" uma
-- conversa por agendamento sem clicar em nada.
-- MUDANÇA MÍNIMA: uma linha no CTE "fechadas" (AND NOT COALESCE(
-- l.conversa_fechada_auto, false)). Todo o resto do corpo é o que está em
-- produção hoje, sem uma vírgula alterada.
-- Por que não outra saída: carimbar um "usuário robô" em conversa_fechada_por
-- exigiria um profile de mentira no tenant (e ele apareceria na aba Equipe);
-- contar em coluna separada mudaria a tela e o front não é desta migration.
CREATE OR REPLACE FUNCTION public.relatorio_sdr_calc(p_tenant uuid, p_de date, p_ate date, p_user uuid, p_total boolean)
 RETURNS TABLE(user_id uuid, nome text, email text, no_rodizio boolean, bloqueada boolean, leads_recebidos integer, leads_respondidos integer, resp_amostra integer, resp_mediana_seg integer, resp_media_seg integer, agendamentos integer, compareceram integer, faltas integer, contratados integer, agend_cancelados integer, conversas_fechadas integer, pesquisa_respostas integer, pesquisa_nota_media numeric, minutos_expediente integer, minutos_pausa integer, is_total boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
WITH janela AS (
  SELECT public.ponto_fuso_do_tenant(p_tenant)                                          AS tz,
         ((p_de::timestamp) AT TIME ZONE public.ponto_fuso_do_tenant(p_tenant))          AS ini,
         (((p_ate + 1)::timestamp) AT TIME ZONE public.ponto_fuso_do_tenant(p_tenant))   AS fim   -- exclusivo
),
sdrs AS (
  -- Quem é "SDR" para o relatório: perfil do tenant com papel sdr. Quando
  -- p_user é NULL (visão do gestor) exige papel EXCLUSIVAMENTE sdr, o mesmo
  -- critério de equipe_listar/equipe_alvo_sdr — listar aqui quem a aba Equipe
  -- não lista deixaria as duas telas contando equipes diferentes.
  SELECT p.id                            AS uid,
         p.nome                          AS nome,
         p.email                         AS email,
         COALESCE(m.ativo, false)        AS no_rodizio,
         COALESCE(p.is_blocked, false)   AS bloqueada
    FROM public.profiles p
    LEFT JOIN public.crm_rodizio_membros m
           ON m.tenant_id = p_tenant AND m.user_id = p.id
   WHERE p.tenant_id = p_tenant
     AND EXISTS (SELECT 1 FROM public.user_roles ur
                  WHERE ur.user_id = p.id AND ur.role = 'sdr'::app_role)
     AND (p_user IS NULL OR p.id = p_user)
     AND (p_user IS NOT NULL
          OR NOT EXISTS (SELECT 1 FROM public.user_roles ur2
                          WHERE ur2.user_id = p.id AND ur2.role <> 'sdr'::app_role))
),
-- ------------------------------------------------------------ leads recebidos
recebidos_bruto AS (
  SELECT l.assigned_to                                   AS uid,
         l.id                                            AS lead_id,
         COALESCE(l.distribuido_em, l.created_at)         AS recebido_em
    FROM public.crm_leads l
    JOIN sdrs s ON s.uid = l.assigned_to
    CROSS JOIN janela j
   WHERE l.tenant_id = p_tenant
     AND COALESCE(l.distribuido_em, l.created_at) >= j.ini
     AND COALESCE(l.distribuido_em, l.created_at) <  j.fim
  UNION ALL
  SELECT a.para_user_id, a.lead_id, a.criado_em
    FROM public.crm_lead_atribuicoes a
    JOIN sdrs s ON s.uid = a.para_user_id
    -- O lead tem de ser do tenant (o livro é escrito só pelo servidor, mas o
    -- cerco de cliente não depende de ninguém ter escrito certo).
    JOIN public.crm_leads l ON l.id = a.lead_id AND l.tenant_id = p_tenant
    CROSS JOIN janela j
   WHERE a.tenant_id = p_tenant
     -- 'reserva' não é entrega (o lead nunca foi dela) e 'saneamento'/'comparecimento'
     -- não dão posse a uma SDR: contavam o lead reservado à noite como "recebido e
     -- não respondido" por uma e de novo por quem o recebeu no corte (teste 09/09).
     AND a.fase IN ('aplicacao', 'corte_9h', 'realocacao_1h', 'manual')
     AND a.para_user_id IS NOT NULL
     AND a.criado_em >= j.ini
     AND a.criado_em <  j.fim
),
recebidos AS (
  SELECT rb.uid, rb.lead_id, min(rb.recebido_em) AS recebido_em
    FROM recebidos_bruto rb
   GROUP BY rb.uid, rb.lead_id
),
-- Janela em que o lead foi DELA: [recebido_em, saida_em). saida_em = primeira
-- linha do livro depois de recebido_em em que ela é a origem.
posse AS (
  SELECT r.uid, r.lead_id, r.recebido_em,
         COALESCE(sa.em, 'infinity'::timestamptz) AS saida_em
    FROM recebidos r
    LEFT JOIN LATERAL (
      SELECT min(a.criado_em) AS em
        FROM public.crm_lead_atribuicoes a
       WHERE a.lead_id = r.lead_id
         AND a.de_user_id = r.uid
         -- Só SAÍDA de verdade fecha a janela de posse. O filtro antigo era
         -- "fase <> 'sombra'", e a linha de 'saneamento' escrita quando a
         -- entrega ao administrador é CANCELADA tem de_user_id = ela mesma
         -- (que continua dona): o relatório fechava a posse ali e passava a
         -- contar o lead como "recebido e não respondido".
         AND a.fase IN ('aplicacao', 'corte_9h', 'realocacao_1h', 'manual', 'comparecimento')
         AND a.criado_em > r.recebido_em
    ) sa ON true
),
-- ------------------------------------------------------- 1ª resposta humana
-- Tudo por lead_id (o lead já é do tenant); os índices são por lead.
resposta AS (
  SELECT p.uid,
         t.t0,
         o.primeira_resposta
    FROM posse p
    -- último inbound ANTES de ela receber (para saber se havia pendência)
    LEFT JOIN LATERAL (
      SELECT m.created_at
        FROM public.messages m
       WHERE m.lead_id = p.lead_id
         AND m.direction = 'inbound'
         AND m.deleted_at IS NULL
         AND m.instagram_comment_id IS NULL
         AND m.created_at < p.recebido_em
       ORDER BY m.created_at DESC
       LIMIT 1
    ) ui ON true
    -- última resposta humana ANTES de ela receber (régua única rodizio_msg_humana)
    LEFT JOIN LATERAL (
      SELECT m.created_at
        FROM public.messages m
       WHERE m.lead_id = p.lead_id
         AND m.created_at < p.recebido_em
         AND public.rodizio_msg_humana(m)
       ORDER BY m.created_at DESC
       LIMIT 1
    ) uo ON true
    -- primeiro inbound DEPOIS de ela receber (enquanto era dela)
    LEFT JOIN LATERAL (
      SELECT min(m.created_at) AS em
        FROM public.messages m
       WHERE m.lead_id = p.lead_id
         AND m.direction = 'inbound'
         AND m.deleted_at IS NULL
         AND m.instagram_comment_id IS NULL
         AND m.created_at >= p.recebido_em
         AND m.created_at <  p.saida_em
    ) pi ON true
    -- t0: pendência na entrega → recebido_em; senão, 1º inbound depois.
    CROSS JOIN LATERAL (
      SELECT CASE
               WHEN ui.created_at IS NOT NULL
                AND (uo.created_at IS NULL OR uo.created_at < ui.created_at)
               THEN p.recebido_em
               ELSE pi.em
             END AS t0
    ) t
    -- primeira resposta humana a partir de t0 (ou de recebido_em, se não há
    -- t0: contato proativo), enquanto o lead era dela (régua única
    -- rodizio_msg_humana — a mesma da realocação do motor)
    LEFT JOIN LATERAL (
      SELECT min(m.created_at) AS primeira_resposta
        FROM public.messages m
       WHERE m.lead_id = p.lead_id
         AND m.created_at >= COALESCE(t.t0, p.recebido_em)
         AND m.created_at <  p.saida_em
         AND public.rodizio_msg_humana(m)
    ) o ON true
),
resp_agg AS (
  SELECT r.uid,
         count(*)::integer AS leads_recebidos,
         count(*) FILTER (WHERE r.primeira_resposta IS NOT NULL)::integer AS leads_respondidos,
         count(*) FILTER (WHERE r.primeira_resposta IS NOT NULL
                            AND r.t0 IS NOT NULL)::integer  AS resp_amostra,
         percentile_cont(0.5) WITHIN GROUP (
           ORDER BY extract(epoch FROM (r.primeira_resposta - r.t0))::double precision
         ) FILTER (WHERE r.primeira_resposta IS NOT NULL AND r.t0 IS NOT NULL) AS mediana_seg,
         avg(extract(epoch FROM (r.primeira_resposta - r.t0)))
           FILTER (WHERE r.primeira_resposta IS NOT NULL AND r.t0 IS NOT NULL) AS media_seg
    FROM resposta r
   GROUP BY r.uid
),
resp_total AS (
  SELECT count(*)::integer AS leads_recebidos,
         count(*) FILTER (WHERE r.primeira_resposta IS NOT NULL)::integer AS leads_respondidos,
         count(*) FILTER (WHERE r.primeira_resposta IS NOT NULL
                            AND r.t0 IS NOT NULL)::integer  AS resp_amostra,
         percentile_cont(0.5) WITHIN GROUP (
           ORDER BY extract(epoch FROM (r.primeira_resposta - r.t0))::double precision
         ) FILTER (WHERE r.primeira_resposta IS NOT NULL AND r.t0 IS NOT NULL) AS mediana_seg,
         avg(extract(epoch FROM (r.primeira_resposta - r.t0)))
           FILTER (WHERE r.primeira_resposta IS NOT NULL AND r.t0 IS NOT NULL) AS media_seg
    FROM resposta r
),
-- ----------------------------------------------- agendamentos (régua canônica)
agend AS (
  SELECT a.responsavel_credito_id AS uid,
         count(*) FILTER (WHERE COALESCE(a.status, '') <> 'cancelled')::integer AS agendamentos,
         count(*) FILTER (WHERE a.status IN ('contracted', 'not_contracted'))::integer AS compareceram,
         count(*) FILTER (WHERE a.status = 'no_show')::integer AS faltas,
         count(*) FILTER (WHERE a.status = 'contracted')::integer AS contratados,
         count(*) FILTER (WHERE a.status = 'cancelled')::integer AS cancelados
    FROM public.crm_appointments a
    JOIN sdrs s ON s.uid = a.responsavel_credito_id
   WHERE a.tenant_id = p_tenant
     AND a.scheduled_date BETWEEN p_de AND p_ate
   GROUP BY a.responsavel_credito_id
),
-- --------------------------------------------------------- conversas fechadas
fechadas AS (
  SELECT COALESCE(l.conversa_fechada_por, l.assigned_to) AS uid,
         count(*)::integer AS conversas_fechadas
    FROM public.crm_leads l
    CROSS JOIN janela j
   WHERE l.tenant_id = p_tenant
     AND l.conversa_fechada_em IS NOT NULL
     AND l.conversa_fechada_em >= j.ini
     AND l.conversa_fechada_em <  j.fim
     -- P2: fechamento do robô (fila dos 15 min em Agendado, ou entrada em
     -- Reagendado/Relacionamento) não é trabalho de SDR. Sem esta linha, como a
     -- autoria automática é NULA, o COALESCE acima creditaria tudo à dona do
     -- lead e o indicador inflaria sozinho.
     AND NOT COALESCE(l.conversa_fechada_auto, false)
     AND COALESCE(l.conversa_fechada_por, l.assigned_to) IN (SELECT s.uid FROM sdrs s)
   GROUP BY COALESCE(l.conversa_fechada_por, l.assigned_to)
),
-- ------------------------------------------------------------------- pesquisa
pesquisa AS (
  SELECT r.responsavel_credito_id AS uid,
         count(r.nota)::integer AS respostas,
         sum(r.nota)            AS soma_notas,
         count(r.nota)          AS n_notas
    FROM public.crm_pesquisa_respostas r
    JOIN sdrs s ON s.uid = r.responsavel_credito_id
    CROSS JOIN janela j
   WHERE r.tenant_id = p_tenant
     AND r.respondida_em IS NOT NULL
     AND r.respondida_em >= j.ini
     AND r.respondida_em <  j.fim
   GROUP BY r.responsavel_credito_id
),
-- --------------------------------------------------------- expediente e pausa
ponto_ev AS (
  SELECT e.user_id AS uid,
         e.tipo,
         e.em,
         lead(e.em) OVER (PARTITION BY e.user_id ORDER BY e.em, e.id) AS prox_em
    FROM public.crm_ponto_eventos e
    JOIN sdrs s ON s.uid = e.user_id
    CROSS JOIN janela j
   WHERE e.tenant_id = p_tenant
     AND e.em >= j.ini
     AND e.em <  j.fim
),
ponto_int AS (
  SELECT v.uid,
         v.tipo,
         LEAST(
           COALESCE(v.prox_em, 'infinity'::timestamptz),
           (date_trunc('day', v.em AT TIME ZONE (SELECT j2.tz FROM janela j2)) + interval '1 day')
             AT TIME ZONE (SELECT j2.tz FROM janela j2),
           now(),
           (SELECT j2.fim FROM janela j2)
         ) - v.em AS dur
    FROM ponto_ev v
   WHERE v.tipo IN ('abrir', 'retomar', 'pausar')
),
ponto AS (
  SELECT pi.uid,
         COALESCE(round(sum(extract(epoch FROM pi.dur) / 60.0)
           FILTER (WHERE pi.tipo IN ('abrir', 'retomar'))), 0)::integer AS minutos_expediente,
         COALESCE(round(sum(extract(epoch FROM pi.dur) / 60.0)
           FILTER (WHERE pi.tipo = 'pausar')), 0)::integer               AS minutos_pausa
    FROM ponto_int pi
   WHERE pi.dur > interval '0'
   GROUP BY pi.uid
)
-- ------------------------------------------------------------ uma linha por SDR
SELECT s.uid,
       s.nome,
       s.email,
       s.no_rodizio,
       s.bloqueada,
       COALESCE(ra.leads_recebidos, 0),
       COALESCE(ra.leads_respondidos, 0),
       COALESCE(ra.resp_amostra, 0),
       round(ra.mediana_seg)::integer,
       round(ra.media_seg)::integer,
       COALESCE(ag.agendamentos, 0),
       COALESCE(ag.compareceram, 0),
       COALESCE(ag.faltas, 0),
       COALESCE(ag.contratados, 0),
       COALESCE(ag.cancelados, 0),
       COALESCE(fc.conversas_fechadas, 0),
       COALESCE(pq.respostas, 0),
       CASE WHEN COALESCE(pq.n_notas, 0) > 0
            THEN round(pq.soma_notas::numeric / pq.n_notas, 2) END,
       COALESCE(pt.minutos_expediente, 0),
       COALESCE(pt.minutos_pausa, 0),
       false
  FROM sdrs s
  LEFT JOIN resp_agg ra ON ra.uid = s.uid
  LEFT JOIN agend    ag ON ag.uid = s.uid
  LEFT JOIN fechadas fc ON fc.uid = s.uid
  LEFT JOIN pesquisa pq ON pq.uid = s.uid
  LEFT JOIN ponto    pt ON pt.uid = s.uid

UNION ALL

-- ------------------------------------------------ linha de total da equipe
-- Só quando pedida E quando existe pelo menos uma SDR (zero SDRs = zero linhas).
SELECT NULL::uuid,
       'Equipe (total)'::text,
       NULL::text,
       NULL::boolean,
       NULL::boolean,
       COALESCE((SELECT rt.leads_recebidos   FROM resp_total rt), 0),
       COALESCE((SELECT rt.leads_respondidos FROM resp_total rt), 0),
       COALESCE((SELECT rt.resp_amostra      FROM resp_total rt), 0),
       (SELECT round(rt.mediana_seg)::integer FROM resp_total rt),
       (SELECT round(rt.media_seg)::integer   FROM resp_total rt),
       COALESCE((SELECT sum(ag.agendamentos) FROM agend ag), 0)::integer,
       COALESCE((SELECT sum(ag.compareceram) FROM agend ag), 0)::integer,
       COALESCE((SELECT sum(ag.faltas)       FROM agend ag), 0)::integer,
       COALESCE((SELECT sum(ag.contratados)  FROM agend ag), 0)::integer,
       COALESCE((SELECT sum(ag.cancelados)   FROM agend ag), 0)::integer,
       COALESCE((SELECT sum(fc.conversas_fechadas) FROM fechadas fc), 0)::integer,
       COALESCE((SELECT sum(pq.respostas) FROM pesquisa pq), 0)::integer,
       (SELECT CASE WHEN COALESCE(sum(pq.n_notas), 0) > 0
                    THEN round(sum(pq.soma_notas)::numeric / sum(pq.n_notas), 2) END
          FROM pesquisa pq),
       COALESCE((SELECT sum(pt.minutos_expediente) FROM ponto pt), 0)::integer,
       COALESCE((SELECT sum(pt.minutos_pausa)      FROM ponto pt), 0)::integer,
       true
 WHERE COALESCE(p_total, false) AND EXISTS (SELECT 1 FROM sdrs)

ORDER BY 21, 2;   -- is_total (total por último), depois nome
$fn$;


-- =============================================================================
-- CRON — NÃO EXECUTADO AQUI. Agendar à mão depois de aplicar (jobid novo):
--
-- SELECT cron.schedule(
--   'fechar-conversas-agendadas',
--   '* * * * *',
--   $$SELECT public.fechar_conversas_agendadas();$$
-- );
--
-- POR QUE DE MINUTO EM MINUTO, e não no passo de 5 minutos da família do rodízio
-- (jobs 37-41): o dono pediu QUINZE minutos. Num job a cada 5 minutos o
-- fechamento cairia entre 15 e 20 minutos e ele veria "esperei 15 e não fechou".
-- A varredura é barata: duas leituras por índice numa tabela que costuma ter
-- poucas linhas (uma por lead agendado nos últimos 15 min). Se um dia pesar,
-- trocar por '4,9,14,19,24,29,34,39,44,49,54,59 * * * *' (a vaga livre entre os
-- jobs 39/41, que usam os minutos 2 e 3) e assumir a folga de até 5 min.
--
-- Para desligar sem migration: UPDATE public.crm_rodizio_config
--   SET fechar_agendado_apos_min = 0 WHERE tenant_id = '...';  -- para de enfileirar
-- ou SELECT cron.unschedule('fechar-conversas-agendadas');     -- para de fechar
-- =============================================================================


-- =============================================================================
-- VERIFICAÇÃO (só leitura, depois de aplicar)
--
-- SELECT
--   (SELECT count(*) FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='crm_rodizio_config'
--       AND column_name='fechar_agendado_apos_min')                       AS col_atraso,
--   (SELECT count(*) FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='crm_pesquisa_config'
--       AND column_name='intervalo_dias')                                 AS col_dias,
--   (SELECT count(*) FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='crm_leads'
--       AND column_name='conversa_fechada_auto')                          AS col_auto,
--   (SELECT count(*) FROM pg_class WHERE relname='crm_fechamentos_agendados')          AS fila,
--   (SELECT relrowsecurity FROM pg_class WHERE relname='crm_fechamentos_agendados')    AS fila_rls,
--   (SELECT count(*) FROM pg_policy WHERE polrelid='public.crm_fechamentos_agendados'::regclass) AS fila_policies,
--   (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
--     WHERE c.relname='crm_leads' AND t.tgname='trg_zzz_fecha_agendado_enfileira')     AS gatilho,
--   (SELECT count(*) FROM pg_indexes
--     WHERE schemaname='public' AND indexname='crm_pesquisa_respostas_lead_dia_uidx')  AS indice_unico,
--   (SELECT pg_get_functiondef(p.oid) ILIKE '%conversa_fechada_auto%'
--      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--     WHERE n.nspname='public' AND p.proname='relatorio_sdr_calc')                     AS relatorio_filtra,
--   -- a lista literal do gatilho irmão (não vale procurar a palavra "agendado":
--   -- ela aparece nos comentários do corpo)
--   (SELECT pg_get_functiondef(p.oid) LIKE '%NOT IN (''reagendado'', ''relacionamento'')%'
--      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--     WHERE n.nspname='public' AND p.proname='conversa_fecha_na_etapa')                AS etapa_so_reag_e_relac;
-- -- esperado: 1,1,1,1,true,0,1,1,true,true
--
--
-- ENSAIOS — RODADOS DE VERDADE, e desfeitos.
--
-- Onde: Postgres 17 local, descartável, com um esqueleto das tabelas e funções
-- que esta migration toca (crm_leads, crm_stages, crm_pesquisa_config/respostas,
-- crm_rodizio_config, messages, profiles, user_roles, auth.uid(),
-- conversa_lead_alcancavel, normaliza_nome_etapa, rodizio_msg_sistema…). A
-- migration subiu inteira, sem erro, e os blocos abaixo rodaram dentro de
-- transações que terminaram em ROLLBACK. NADA foi executado no banco de
-- produção. Os resultados anotados em cada linha são os que saíram.
--
-- Para repetir em produção (SQL editor), use os mesmos blocos trocando o
-- RAISE NOTICE do fim por RAISE EXCEPTION, para o Postgres desfazer tudo.
--
-- ---------------------------------------------------------------- ENSAIO A
-- O caminho automático inteiro, sem precisar de sessão de usuária.
--
-- DO $t$
-- DECLARE
--   v_pipe uuid; v_novo uuid; v_agen uuid; v_outra uuid; v_rel uuid; v_lead uuid;
--   v_em timestamptz; v_por uuid; v_auto boolean; v_prazo timestamptz;
--   v_n integer; v_pend boolean; v_pode boolean; v_erro text; rep text := E'\n';
-- BEGIN
--   SELECT p.id INTO v_pipe FROM public.crm_pipelines p
--    WHERE p.tenant_id = '00000000-0000-0000-0000-000000000010' AND p.name = 'Funil Principal';
--   SELECT s.id INTO v_novo  FROM public.crm_stages s WHERE s.pipeline_id = v_pipe AND public.normaliza_nome_etapa(s.name) = 'novo lead';
--   SELECT s.id INTO v_agen  FROM public.crm_stages s WHERE s.pipeline_id = v_pipe AND public.normaliza_nome_etapa(s.name) = 'agendado';
--   SELECT s.id INTO v_outra FROM public.crm_stages s WHERE s.pipeline_id = v_pipe AND public.normaliza_nome_etapa(s.name) = 'em atendimento';
--   SELECT s.id INTO v_rel   FROM public.crm_stages s WHERE s.pipeline_id = v_pipe AND public.normaliza_nome_etapa(s.name) = 'relacionamento';
--
--   -- distribuido_em preenchido de propósito: rodizio_lead_na_fila exige
--   -- distribuido_em NULL, então o lead do ensaio não entra no rodízio.
--   INSERT INTO public.crm_leads (tenant_id, pipeline_id, stage_id, name, phone, source, distribuido_em)
--   VALUES ('00000000-0000-0000-0000-000000000010', v_pipe, v_novo,
--           'ENSAIO fechar agendado', '5577999999999', 'Retroativo', now())
--   RETURNING id INTO v_lead;
--
--   -- 1) entrou em Agendado: enfileira com 15 min e NÃO fecha agora
--   UPDATE public.crm_leads SET stage_id = v_agen WHERE id = v_lead;
--   SELECT f.fechar_em INTO v_prazo FROM public.crm_fechamentos_agendados f WHERE f.lead_id = v_lead;
--   SELECT conversa_fechada_em INTO v_em FROM public.crm_leads WHERE id = v_lead;
--   rep := rep || '1) enfileirou=' || (v_prazo IS NOT NULL)
--              || ' | prazo ~15min=' || (v_prazo BETWEEN now() + interval '14 minutes' AND now() + interval '16 minutes')
--              || ' | ainda aberta=' || (v_em IS NULL) || E'\n';          -- saiu: true | true | true
--
--   -- 2) antes da hora a varredura não toca
--   PERFORM public.fechar_conversas_agendadas();
--   SELECT conversa_fechada_em INTO v_em FROM public.crm_leads WHERE id = v_lead;
--   rep := rep || '2) antes da hora: continua aberta=' || (v_em IS NULL) || E'\n';   -- saiu: true
--
--   -- 3) na hora: fecha, autoria nula, carimbo automático, 1 aviso no chat,
--   --    e a linha da fila vira "pesquisa pendente"
--   UPDATE public.crm_fechamentos_agendados SET fechar_em = now() - interval '1 minute' WHERE lead_id = v_lead;
--   PERFORM public.fechar_conversas_agendadas();
--   SELECT conversa_fechada_em, conversa_fechada_por, conversa_fechada_auto INTO v_em, v_por, v_auto
--     FROM public.crm_leads WHERE id = v_lead;
--   SELECT count(*) INTO v_n FROM public.messages
--    WHERE lead_id = v_lead AND status = 'system' AND content LIKE '🔒 Conversa fechada automaticamente%';
--   SELECT f.pesquisa_pendente INTO v_pend FROM public.crm_fechamentos_agendados f WHERE f.lead_id = v_lead;
--   rep := rep || '3) fechou=' || (v_em IS NOT NULL) || ' | autoria nula=' || (v_por IS NULL)
--              || ' | auto=' || COALESCE(v_auto, false) || ' | avisos=' || v_n
--              || ' | pesquisa pendente=' || COALESCE(v_pend, false) || E'\n';  -- saiu: true|true|true|1|true
--
--   -- 4) TRAVA 1 — reabriu: rodar a varredura dez vezes não refecha nada
--   UPDATE public.crm_leads SET conversa_fechada_em = NULL, conversa_fechada_por = NULL,
--          conversa_fechada_auto = false WHERE id = v_lead;
--   FOR v_n IN 1..10 LOOP PERFORM public.fechar_conversas_agendadas(); END LOOP;
--   SELECT conversa_fechada_em INTO v_em FROM public.crm_leads WHERE id = v_lead;
--   SELECT count(*) INTO v_n FROM public.messages
--    WHERE lead_id = v_lead AND status = 'system' AND content LIKE '🔒 Conversa fechada automaticamente%';
--   rep := rep || '4) reabriu e rodou 10x: aberta=' || (v_em IS NULL) || ' | avisos ainda=' || v_n || E'\n';  -- saiu: true | 1
--
--   -- 5) TRAVA 3 — com pesquisa de hoje, a régua diz não e o índice recusa a 2ª
--   INSERT INTO public.crm_pesquisa_respostas (tenant_id, lead_id, lead_nome, lead_telefone, enviada_em, canal)
--   VALUES ('00000000-0000-0000-0000-000000000010', v_lead, 'ENSAIO', '5577999999999', now(), 'whatsapp');
--   v_pode := public.pesquisa_pode_enviar(v_lead);
--   BEGIN
--     INSERT INTO public.crm_pesquisa_respostas (tenant_id, lead_id, lead_nome, lead_telefone, enviada_em, canal)
--     VALUES ('00000000-0000-0000-0000-000000000010', v_lead, 'ENSAIO', '5577999999999', now(), 'whatsapp');
--     v_erro := 'passou (ERRADO)';
--   EXCEPTION WHEN unique_violation THEN v_erro := 'recusada pelo indice (certo)';
--   END;
--   rep := rep || '5) pode_enviar=' || v_pode || ' | 2a no mesmo dia: ' || v_erro || E'\n';  -- saiu: false | recusada
--
--   -- 6) a janela é de dias, não de "uma por lead para sempre"
--   UPDATE public.crm_pesquisa_respostas SET enviada_em = now() - interval '14 days' WHERE lead_id = v_lead;
--   rep := rep || '6a) 14 dias atras: pode=' || public.pesquisa_pode_enviar(v_lead) || E'\n';   -- saiu: false
--   UPDATE public.crm_pesquisa_respostas SET enviada_em = now() - interval '16 days' WHERE lead_id = v_lead;
--   rep := rep || '6b) 16 dias atras: pode=' || public.pesquisa_pode_enviar(v_lead) || E'\n';   -- saiu: true
--
--   -- 7) TRAVA 2 — sair da etapa limpa a fila
--   UPDATE public.crm_leads SET stage_id = v_agen  WHERE id = v_lead;   -- reentra: enfileira
--   UPDATE public.crm_leads SET stage_id = v_outra WHERE id = v_lead;   -- sai: a linha some
--   SELECT count(*) INTO v_n FROM public.crm_fechamentos_agendados WHERE lead_id = v_lead;
--   rep := rep || '7) saiu de Agendado: linhas na fila=' || v_n || E'\n';   -- saiu: 0
--
--   -- 8) Relacionamento continua fechando NA HORA (gatilho irmão), com carimbo auto
--   UPDATE public.crm_leads SET conversa_fechada_em = NULL, conversa_fechada_auto = false WHERE id = v_lead;
--   UPDATE public.crm_leads SET stage_id = v_rel WHERE id = v_lead;
--   SELECT conversa_fechada_em, conversa_fechada_auto INTO v_em, v_auto FROM public.crm_leads WHERE id = v_lead;
--   rep := rep || '8) Relacionamento: fechou na hora=' || (v_em IS NOT NULL)
--              || ' | auto=' || COALESCE(v_auto, false) || E'\n';          -- saiu: true | true
--
--   -- 9) Agendado NÃO fecha mais na hora: ele espera a fila
--   UPDATE public.crm_leads SET conversa_fechada_em = NULL, conversa_fechada_auto = false WHERE id = v_lead;
--   UPDATE public.crm_leads SET stage_id = v_agen WHERE id = v_lead;
--   SELECT conversa_fechada_em INTO v_em FROM public.crm_leads WHERE id = v_lead;
--   SELECT count(*) INTO v_n FROM public.crm_fechamentos_agendados WHERE lead_id = v_lead;
--   rep := rep || '9) Agendado: aberta=' || (v_em IS NULL) || ' | enfileirada=' || v_n || E'\n';  -- saiu: true | 1
--
--   RAISE EXCEPTION 'ENSAIO A (desfeito): %', rep;
-- END $t$;
--
-- ---------------------------------------------------------------- ENSAIO B
-- As quatro saídas da fila ("deixou de fazer sentido"), rodadas do mesmo jeito.
-- Resultados obtidos:
--   i)   pendência parada há 25 h  -> fila=0, 1 aviso ⚠️ no chat, 0 pesquisas criadas
--   ii)  lead bloqueado            -> fila=0, conversa NÃO fechada, 0 mensagens escritas
--   iii) alguém já tinha fechado   -> fila=0, carimbo e autoria antigos INTACTOS
--   iv)  fechar_agendado_apos_min=0 -> nem enfileira (cliente que desligou a régua)
--
-- ---------------------------------------------------------------- ENSAIO C
-- Com sessão de usuária (a tela). No SQL editor não há auth.uid(), então este
-- rodou na réplica local com um auth.uid() de mentira lendo um GUC; em produção
-- ele se repete pela própria tela, com a SDR dona do lead. Resultados obtidos:
--   A) conversa_fechar(lead, true)                -> pesquisa criada, sem motivo de recusa,
--      texto "Olá, Maria! … de 1 a 5, como você avalia…" (primeiro nome e escala aplicados)
--   B) reabriu e fechou de novo pedindo pesquisa  -> pesquisa=null,
--      pesquisa_nao_enviada='pesquisa_recente', o lead continua com UMA linha de pesquisa
--      (é exatamente o pedido P3 do dono)
--   C) depois do fechamento automático            -> pesquisa_pendentes() devolve 1 linha para a SDR dona
--   D) pesquisa_pendente_tomar(lead)              -> devolve resposta_id + telefone + texto pronto
--   E) tomar de novo (2ª aba)                     -> 'sem_pendencia', e continua UMA linha de pesquisa
--   F) pesquisa_pendentes() depois de tomar       -> 0
--   G) relatorio_sdr_calc no dia com 1 fechamento do robô e 1 dela -> conversas_fechadas = 1
-- =============================================================================
