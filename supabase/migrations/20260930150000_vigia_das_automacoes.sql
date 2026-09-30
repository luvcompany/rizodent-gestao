-- =============================================================================
-- VIGIA DAS AUTOMAÇÕES (pedido do dono em 30/09/2026: "corrija pra que nunca
-- mais aconteça erros como esse")
--
-- Os dois defeitos do dia não foram difíceis de consertar — foram difíceis de
-- DESCOBRIR. Os dois falharam em silêncio por semanas:
--   1) o follow-up não alcançava quem nunca respondeu (57 leads invisíveis, 35
--      deles numa única etapa) — ninguém tinha como saber;
--   2) o bot seguia mandando mensagem depois que o lead saía da etapa (14
--      execuções assim no momento do conserto).
-- Em ambos o sistema só "avisou" quando a SDR reclamou.
--
-- Este vigia não impede bug novo: ele faz o bug do MESMO TIPO aparecer sozinho,
-- no dia seguinte, em vez de esperar uma reclamação. Três perguntas, todas
-- calibradas para dar ZERO quando está tudo certo:
--
--   followup_atrasado  — tem lead que as regras de hoje mandam cobrar e que não
--                        foi cobrado? (medido em 30/09 com o conserto no ar: 0)
--   bot_fora_da_etapa  — tem bot rodando com o lead em outra etapa? (era 14; a
--                        trava do bot-engine zera conforme cada prazo vence)
--   bot_sem_origem     — execução sem a automação carimbada, que a trava não
--                        alcança (eram 15; são bots iniciados à mão)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.automacoes_saude(_tenant uuid DEFAULT NULL)
RETURNS TABLE (
  achado text,
  quantos bigint,
  onde text,
  detalhe text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  WITH alvo AS (
    SELECT COALESCE(_tenant, public.current_tenant_id()) AS tenant_id
  ),
  regua AS (
    SELECT a.id, a.stage_id,
           (COALESCE((a.action_config->>'no_response_amount')::numeric, 1) *
            CASE COALESCE(a.action_config->>'no_response_unit', 'hours')
              WHEN 'minutes' THEN interval '1 minute'
              WHEN 'hours'   THEN interval '1 hour'
              WHEN 'days'    THEN interval '1 day'
              WHEN 'weeks'   THEN interval '1 week'
              ELSE interval '1 hour'
            END) AS prazo
      FROM crm_automations a, alvo
     WHERE a.trigger_type = 'no_response'
       AND a.is_active
       AND a.tenant_id = alvo.tenant_id
  ),
  atrasados AS (
    -- Lead que as regras VIGENTES mandam cobrar e que não foi cobrado. O prazo
    -- é multiplicado por 3 para não acusar quem está na fila normal, e o teto
    -- de idade de 30 dias (reguaFollowUp.ts) é respeitado — senão o vigia
    -- gritaria todo dia sobre os 25 leads que ficam de fora de propósito.
    SELECT s.name || ' (' || p.name || ')' AS onde, count(*) AS n,
           min(l.last_outbound_at)::date::text AS mais_antigo
      FROM regua r
      JOIN crm_leads l ON l.stage_id = r.stage_id
      JOIN crm_stages s ON s.id = r.stage_id
      JOIN crm_pipelines p ON p.id = s.pipeline_id
     WHERE l.last_outbound_at IS NOT NULL
       AND (l.last_inbound_at IS NULL OR l.last_outbound_at > l.last_inbound_at)
       AND now() - l.last_outbound_at > r.prazo * 3
       AND NOT (l.last_inbound_at IS NULL AND l.last_outbound_at <= now() - interval '30 days')
       AND COALESCE(l.automation_paused, false) = false
       AND l.is_blocked = false
       AND NOT EXISTS (
             SELECT 1 FROM crm_automation_queue q
              WHERE q.automation_id = r.id AND q.lead_id = l.id
                AND q.status = 'sent' AND q.created_at > l.last_outbound_at)
     GROUP BY 1
  ),
  fora AS (
    SELECT s.name || ' → ' || sa.name AS onde, count(*) AS n
      FROM bot_executions be
      JOIN crm_leads l ON l.id = be.lead_id
      JOIN crm_automations a ON a.id = be.started_by_automation_id
      JOIN crm_stages sa ON sa.id = l.stage_id
      JOIN crm_stages s ON s.id = a.stage_id, alvo
     WHERE be.status IN ('active', 'waiting_reply')
       AND l.tenant_id = alvo.tenant_id
       AND l.stage_id IS DISTINCT FROM a.stage_id
     GROUP BY 1
  ),
  sem_origem AS (
    SELECT count(*) AS n
      FROM bot_executions be
      JOIN crm_leads l ON l.id = be.lead_id, alvo
     WHERE be.status IN ('active', 'waiting_reply')
       AND l.tenant_id = alvo.tenant_id
       AND be.started_by_automation_id IS NULL
  )
  SELECT 'followup_atrasado', n, onde, 'mais antigo: ' || mais_antigo FROM atrasados
  UNION ALL
  SELECT 'bot_fora_da_etapa', n, onde, 'o bot continua rodando com o lead em outra etapa' FROM fora
  UNION ALL
  SELECT 'bot_sem_origem', n, 'execuções sem automação carimbada',
         'a trava de etapa não alcança estas' FROM sem_origem WHERE n > 0
  ORDER BY 2 DESC;
$fn$;

REVOKE ALL ON FUNCTION public.automacoes_saude(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.automacoes_saude(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.automacoes_saude(uuid) IS
  'Vigia das automações: acha em silêncio o que antes só aparecia por reclamação. Zero = tudo certo.';

-- =============================================================================
-- O AVISO: de nada adianta o vigia se ninguém olha. Uma vez por dia, se houver
-- achado, o gestor recebe notificação no CRM (mesmo caminho do rodízio), com
-- dedupe por dia para não repetir. Silêncio = está tudo certo.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.automacoes_saude_vigia()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $vigia$
DECLARE
  c record;
  r record;
  linhas text;
  total bigint;
  avisados int := 0;
  v_hoje date;
BEGIN
  -- não existe coluna de fuso na config: o projeto já tem rodizio_tz()
  FOR c IN SELECT tenant_id, gestor_user_id, public.rodizio_tz(tenant_id) AS tz
             FROM crm_rodizio_config
            WHERE gestor_user_id IS NOT NULL
  LOOP
    v_hoje := (now() AT TIME ZONE c.tz)::date;
    linhas := '';
    total := 0;

    FOR r IN SELECT * FROM public.automacoes_saude(c.tenant_id) LOOP
      total := total + r.quantos;
      linhas := linhas || CASE WHEN linhas = '' THEN '' ELSE E'\n' END
             || '• ' || r.quantos || ' — '
             || CASE r.achado
                  WHEN 'followup_atrasado' THEN 'lead(s) que deveriam ter recebido follow-up e não receberam'
                  WHEN 'bot_fora_da_etapa' THEN 'bot rodando com o lead já em outra etapa'
                  WHEN 'bot_sem_origem'    THEN 'execução de bot sem automação de origem (fora da trava de etapa)'
                  ELSE r.achado
                END
             || ' (' || r.onde || ')';
    END LOOP;

    IF total > 0 THEN
      PERFORM public.rodizio_notifica(
        c.gestor_user_id,
        NULL,
        'Automações: ' || total || ' ponto(s) para olhar',
        linhas || E'\n\nIsto é o vigia diário. Quando está tudo certo ele não avisa nada.',
        'automacoes:saude:' || c.tenant_id::text || ':' || v_hoje::text);
      avisados := avisados + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('tenants_avisados', avisados);
END $vigia$;

REVOKE ALL ON FUNCTION public.automacoes_saude_vigia() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.automacoes_saude_vigia() TO service_role;

-- Uma vez por dia, 08:10 na Bahia (11:10 UTC) — cedo o bastante para a gestão
-- ver antes do movimento do dia, e depois do corte das 9h do rodízio.
SELECT cron.unschedule('automacoes-saude-vigia')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'automacoes-saude-vigia');

SELECT cron.schedule(
  'automacoes-saude-vigia',
  '10 11 * * *',
  $cron$ SELECT public.automacoes_saude_vigia(); $cron$
);
