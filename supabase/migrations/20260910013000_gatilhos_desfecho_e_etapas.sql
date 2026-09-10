-- Dois gatilhos que apagam decisão de gente (10/09/2026, prescrito por revisão
-- adversarial do código do rodízio):
--
--   1. stamp_appointment_update carimbava outcome_source = 'ui' em TODO desfecho
--      registrado por um humano — inclusive no desfecho que a própria SDR grava
--      como 'sdr' pela RPC sdr_marcar_comparecimento. A marca 'sdr' morria no
--      mesmo UPDATE que a criava, e a rotina do Dontus perdia a única forma de
--      distinguir "a SDR marcou que o paciente compareceu" (dado de presença,
--      contrato ainda desconhecido) de "o gerente decidiu que não contratou"
--      (dado de venda). Sem essa distinção o sync sobrescreve um pelo outro.
--
--   2. stage_regras_padrao_trg recusava EM SILÊNCIO qualquer etapa inserida nos
--      primeiros 60 segundos de vida de um funil que já tivesse etapas. Um
--      revisor provou num Postgres local que a regra também barra INSERT em
--      lote — o gatilho é FOR EACH ROW e enxerga as linhas já inseridas pela
--      MESMA instrução, então da segunda linha em diante tudo cai — e que ela
--      quebra o fluxo "Duplicar funil" da tela de Automações, que cria o funil
--      e insere as etapas dele em seguida.
--
-- Nenhum gatilho é recriado aqui: as duas funções trocam de corpo com CREATE OR
-- REPLACE e a assinatura é a mesma (RETURNS trigger, sem argumentos), então os
-- gatilhos trg_stamp_appointment_update e trg_zz_stage_regras_padrao continuam
-- apontando para elas sem nenhuma janela sem proteção.

-- ---------------------------------------------------------------- 1. desfecho: a marca da SDR sobrevive
-- Corpo IDÊNTICO ao vigente (20260817144537, seção 4), com uma única mudança:
-- a linha que forçava outcome_source := 'ui' passa a PRESERVAR a fonte quando
-- ela vem explicitamente como 'sdr' E quem chama tem papel sdr. Em qualquer
-- outro caso continua 'ui' — inclusive se alguém sem papel sdr tentar se passar
-- por SDR mandando outcome_source = 'sdr' no UPDATE.
-- Tudo o mais fica de pé: carimbo de outcome_at/outcome_by, reabertura só por
-- gerente/serviço, imutabilidade de confirmed_by/created_at/confirmed_at/
-- rescheduled_from_id e a trava de data/hora depois do desfecho.
CREATE OR REPLACE FUNCTION public.stamp_appointment_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  terminais text[] := ARRAY['contracted','not_contracted','no_show','rescheduled','cancelled'];
  is_service boolean := (auth.uid() IS NULL);
  is_manager boolean := (auth.uid() IS NOT NULL AND (has_role(auth.uid(),'gerente'::app_role) OR has_role(auth.uid(),'superadmin'::app_role)));
BEGIN
  -- (a) carimbo do desfecho
  IF OLD.status IN ('confirmed','pending') AND NEW.status = ANY(terminais) THEN
    NEW.outcome_at := now();
    IF NOT is_service THEN
      NEW.outcome_by := auth.uid();
      -- Comparecimento marcado pela SDR: a fonte 'sdr' é o dado, não enfeite.
      -- Antes ela era sobrescrita por 'ui' aqui mesmo e o Dontus não sabia mais
      -- se o not_contracted era "compareceu, contrato em aberto" (SDR) ou
      -- "compareceu e não fechou" (decisão do gerente).
      IF NEW.outcome_source = 'sdr' AND public.has_role(auth.uid(), 'sdr'::app_role) THEN
        NULL;   -- preserva a marca da SDR
      ELSIF pg_trigger_depth() > 1 AND NEW.outcome_source = 'auto_stage_contratado' THEN
        NULL;
      ELSE
        NEW.outcome_source := 'ui';
      END IF;
    ELSE
      NEW.outcome_by := NULL;
      NEW.outcome_source := COALESCE(NEW.outcome_source, 'service');
    END IF;
  END IF;

  -- (b) reabrir bloqueado
  IF OLD.status = ANY(terminais) AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (is_service OR is_manager) THEN
      RAISE EXCEPTION 'Desfecho já registrado — reabertura é ação de gerente';
    END IF;
    IF NEW.status = 'confirmed' THEN
      NEW.outcome_by := NULL;
      NEW.outcome_at := NULL;
      NEW.outcome_source := NULL;
    END IF;
  END IF;

  -- (c) imutabilidade
  IF NOT is_service THEN
    IF NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by THEN
      RAISE EXCEPTION 'confirmed_by é imutável';
    END IF;
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'created_at é imutável';
    END IF;
    IF OLD.confirmed_at IS NOT NULL AND NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN
      RAISE EXCEPTION 'confirmed_at é imutável';
    END IF;
    IF OLD.rescheduled_from_id IS NOT NULL AND NEW.rescheduled_from_id IS DISTINCT FROM OLD.rescheduled_from_id THEN
      RAISE EXCEPTION 'rescheduled_from_id é imutável';
    END IF;
  END IF;

  NEW.is_rescheduled := (NEW.rescheduled_from_id IS NOT NULL);

  IF OLD.status = ANY(terminais)
     AND (NEW.scheduled_date IS DISTINCT FROM OLD.scheduled_date
          OR NEW.scheduled_time IS DISTINCT FROM OLD.scheduled_time)
     AND NOT (is_service OR is_manager) THEN
    RAISE EXCEPTION 'Data/hora não podem ser alteradas após o desfecho';
  END IF;

  RETURN NEW;
END;
$fn$;
COMMENT ON FUNCTION public.stamp_appointment_update() IS
  'Gatilho BEFORE UPDATE de crm_appointments: carimba o desfecho, trava reabertura fora de gerente/serviço e protege campos imutáveis. Desde 10/09/2026 preserva outcome_source = ''sdr'' quando quem grava tem papel sdr (antes virava ''ui'' e a rotina do Dontus perdia a distinção entre comparecimento marcado pela SDR e decisão de venda do gerente).';
-- Função de gatilho: ninguém chama direto por RPC.
REVOKE ALL ON FUNCTION public.stamp_appointment_update() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- 2. etapas: cai a regra dos 60 segundos
-- Corpo de 20260910000000 (seção 5) SEM a regra dos 60 segundos. O que fica:
--   (a) nome repetido no mesmo funil não entra — só em INSERT e só quando o GUC
--       app.clonando_etapas não está ligado (pipeline_clonar_etapas_padrao liga
--       esse GUC porque ele copia nomes de propósito);
--   (b) as etapas do administrador nascem ocultas para a SDR
--       (contratado, nao contratado, compareceu, compareceu e agendou).
--
-- Por que a regra dos 60 segundos sai:
--   • ela era FOR EACH ROW e olhava crm_stages: num INSERT em lote a primeira
--     linha entra, e da segunda em diante "o funil já tem etapas" passa a ser
--     verdade DENTRO DA MESMA INSTRUÇÃO — o resto do lote era recusado em
--     silêncio (RETURN NULL não dá erro, o front achava que salvou);
--   • ela quebrava "Duplicar funil" da tela de Automações, que cria o funil e
--     insere as etapas dele logo depois;
--   • ela existia só para impedir que a tela de Integrações inserisse etapas
--     padrão por cima das clonadas por pipeline_clonar_etapas_padrao. Essa tela
--     deixou de inserir etapas padrão (mudança feita em paralelo, no front), e a
--     regra (a) de nome repetido já barra a duplicata que sobrasse — então a
--     regra dos 60 segundos não tem mais função nenhuma e só causava dano.
CREATE OR REPLACE FUNCTION public.stage_regras_padrao_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF TG_OP = 'INSERT' AND current_setting('app.clonando_etapas', true) IS DISTINCT FROM 'sim' THEN
    IF EXISTS (SELECT 1 FROM public.crm_stages s
                WHERE s.pipeline_id = NEW.pipeline_id
                  AND public.normaliza_nome_etapa(s.name) = public.normaliza_nome_etapa(NEW.name)) THEN
      RETURN NULL;
    END IF;
  END IF;
  IF public.normaliza_nome_etapa(NEW.name) IN ('contratado', 'nao contratado', 'compareceu', 'compareceu e agendou') THEN
    NEW.visivel_para_sdr := false;
  END IF;
  RETURN NEW;
END $fn$;
COMMENT ON FUNCTION public.stage_regras_padrao_trg() IS
  'Gatilho BEFORE INSERT OR UPDATE OF name de crm_stages: recusa nome de etapa repetido no mesmo funil e marca as etapas do administrador como invisíveis para a SDR. A regra dos 60 segundos de vida do funil foi removida em 10/09/2026: ela recusava em silêncio o resto de qualquer INSERT em lote e quebrava "Duplicar funil".';
-- Função de gatilho: ninguém chama direto por RPC.
REVOKE ALL ON FUNCTION public.stage_regras_padrao_trg() FROM PUBLIC, anon, authenticated;

-- ============================================================ VERIFICAÇÃO (só leitura)
-- 1. As duas funções existem com a assinatura de gatilho e os gatilhos continuam ligados:
-- SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.prosecdef AS security_definer,
--        coalesce(array_to_string(p.proconfig, ' | '), '(sem search_path!)') AS config
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public' AND p.proname IN ('stamp_appointment_update', 'stage_regras_padrao_trg')
--  ORDER BY 1;
-- SELECT c.relname AS tabela, t.tgname, t.tgenabled, p.proname AS funcao
--   FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
--   JOIN pg_proc p ON p.oid = t.tgfoid
--  WHERE NOT t.tgisinternal
--    AND t.tgname IN ('trg_stamp_appointment_update', 'trg_zz_stage_regras_padrao')
--  ORDER BY 1, 2;   -- tgenabled deve ser 'O' (ligado)
--
-- 2. A regra dos 60 segundos saiu e a de nome repetido ficou:
-- SELECT position('60 seconds' in pg_get_functiondef(p.oid)) AS achou_60s,
--        position('normaliza_nome_etapa' in pg_get_functiondef(p.oid)) AS achou_nome_repetido,
--        position('visivel_para_sdr' in pg_get_functiondef(p.oid)) AS achou_marca_sdr
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public' AND p.proname = 'stage_regras_padrao_trg';
--   -- achou_60s tem de ser 0; os outros dois > 0
--
-- 3. A preservação da marca 'sdr' está no corpo novo:
-- SELECT position($q$NEW.outcome_source = 'sdr'$q$ in pg_get_functiondef(p.oid)) AS achou_preserva_sdr
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public' AND p.proname = 'stamp_appointment_update';   -- > 0
--
-- 4. Ninguém além do dono executa as duas (função de gatilho não é RPC):
-- SELECT p.proname, coalesce(array_to_string(p.proacl, ' | '), '(sem ACL = só o dono)') AS acl
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public' AND p.proname IN ('stamp_appointment_update', 'stage_regras_padrao_trg');
--
-- 5. Fontes de desfecho em uso (depois do deploy, 'sdr' tem de voltar a aparecer):
-- SELECT a.outcome_source, count(*) AS n, min(a.outcome_at) AS mais_antigo, max(a.outcome_at) AS mais_novo
--   FROM public.crm_appointments a
--  WHERE a.outcome_at IS NOT NULL
--  GROUP BY a.outcome_source ORDER BY 2 DESC;
--
-- 6. Etapas do administrador continuam ocultas para a SDR em TODOS os funis:
-- SELECT pl.name AS funil, s.name AS etapa, s.visivel_para_sdr
--   FROM public.crm_stages s JOIN public.crm_pipelines pl ON pl.id = s.pipeline_id
--  WHERE public.normaliza_nome_etapa(s.name) IN ('contratado','nao contratado','compareceu','compareceu e agendou')
--  ORDER BY 1, s.position;   -- visivel_para_sdr = false em todas
--
-- 7. Funis com etapas faltando ou duplicadas (o INSERT em lote recusado deixava funil pela metade):
-- SELECT pl.id, pl.name, count(s.id) AS etapas,
--        count(DISTINCT public.normaliza_nome_etapa(s.name)) AS nomes_distintos
--   FROM public.crm_pipelines pl LEFT JOIN public.crm_stages s ON s.pipeline_id = pl.id
--  GROUP BY pl.id, pl.name ORDER BY 3;
