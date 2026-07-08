-- ============================================================================
-- rpt_origem_conversao: agregados da aba "Origem & Conversão" por ORIGEM
-- CANÔNICA da coorte de leads (mesmo padrão da 20260708000000_rpt_canonical_reports).
-- ============================================================================
-- Motivação: a aba calculava tudo no cliente sob RLS — cada papel de usuário
-- via números diferentes. Esta função roda como SECURITY DEFINER com o tenant
-- resolvido no servidor (rpt_resolve_tenant), então QUALQUER usuário autorizado
-- do tenant vê O MESMO número. Retorna APENAS agregados por origem — nenhum
-- dado individual de lead/paciente sai daqui.
--
-- Semântica (espelha OrigemConversaoTab.tsx — coorte fechada):
--   * COORTE       = leads CRIADOS no período (created_at em America/Bahia,
--                    período inclusivo nas duas pontas). Agendamentos,
--                    mensagens e pagamentos desses leads contam EM QUALQUER
--                    DATA — todos os degraus descrevem a mesma população.
--   * ATENDIDO     = lead com 1º inbound (mensagem inbound mais antiga; fallback
--                    crm_leads.first_inbound_at) e ao menos um outbound DEPOIS
--                    do 1º inbound (o template inicial antes do lead escrever
--                    não conta como atendimento).
--   * AGENDADO     = lead com qualquer crm_appointment.
--   * COMPARECEU   = lead com appointment de desfecho presencial
--                    (status IN ('contracted','not_contracted')).
--   * CONTRATADO   = lead com paciente vinculado cujo PRIMEIRO pagamento
--                    (MIN(data_pagamento) global no tenant) é >= dia de criação
--                    do lead (America/Bahia) menos 30 dias de tolerância.
--                    ⚠ SINCRONIA: os 30 dias espelham TOLERANCIA_CONTRATO_DIAS
--                    em src/components/relatorios/OrigemConversaoTab.tsx —
--                    mudou lá, mude aqui (e vice-versa).
--   * FATURAMENTO  = soma de TODOS os pagamentos (qualquer data, qualquer
--                    clínica do tenant) dos pacientes contratados da origem,
--                    com paciente DISTINTO por origem (dois leads da mesma
--                    origem apontando pro mesmo paciente não somam duas vezes).
--                    Fonte: pagamentos (NUNCA crm_leads.value).
--   * p_pipeline_id NULL = todos os funis; senão restringe a coorte ao funil.
--
-- Segurança: SECURITY DEFINER + SET search_path = public; tenant SEMPRE via
-- rpt_resolve_tenant() (nunca vem do cliente). Sem EXECUTE para PUBLIC/anon.
-- Validado em produção (jun/2026, tenant Rizodent): 1564 leads, 89 contratados,
-- faturamento R$ 95.645,65 — coerente com a soma por paciente distinto.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helper: normalização de texto — minúsculas, sem acentos, espaços colapsados.
-- ⚠ SINCRONIA: espelha norm() de src/lib/reportKit.ts (NFD + remoção de
-- diacríticos + lower + colapso de espaços + trim). O banco não tem a extensão
-- unaccent, por isso translate() com o mapa de acentos do PT-BR.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpt_norm_txt(p_txt text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT trim(regexp_replace(
    translate(lower(coalesce(p_txt, '')),
              'áàâãäéèêëíìîïóòôõöúùûüçñ',
              'aaaaaeeeeiiiiooooouuuucn'),
    '\s+', ' ', 'g'));
$$;

-- ----------------------------------------------------------------------------
-- Helper: classificação canônica de origem do lead.
-- ⚠ SINCRONIA: espelha REGRA POR REGRA classifyOrigemCanonica() de
-- src/lib/reportKit.ts — qualquer mudança lá TEM de ser replicada aqui
-- (e vice-versa), senão RPC e fallback do cliente divergem.
--
-- Prioridade (idêntica ao TS):
--   1. ad_id presente (trim não vazio)                          → 'Anúncio'
--   2. marcador "SEM ANÚNCIO"/"NÃO IDENTIFICADO" (regex
--      '^(sem an|nao identificado)' no nome_anuncio OU source
--      normalizados) bloqueia a regra 3                          → cai nas 4-7
--   3. source de anúncio: 'facebook_ad' | 'instagram_ad' |
--      termina em '_ad'/'_ads' | começa com 'anuncio'            → 'Anúncio'
--   4. source começa com 'instagram'                             → 'Instagram Orgânico'
--   5. source contém 'whats'                                     → 'WhatsApp/Direto'
--   6. source contém 'indica'                                    → 'Indicação'
--   7. resto (inclui null, 'Outros', 'Retroativo', 'Site', ...)  → 'Outros'
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpt_classify_origem(
  p_source text,
  p_ad_id text,
  p_nome_anuncio text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_s  text := public.rpt_norm_txt(p_source);
  v_na text := public.rpt_norm_txt(p_nome_anuncio);
  v_sem_anuncio boolean;
BEGIN
  -- 1. ad_id é o sinal mais forte (webhook da Meta): sempre Anúncio.
  IF NULLIF(trim(coalesce(p_ad_id, '')), '') IS NOT NULL THEN
    RETURN 'Anúncio';
  END IF;

  -- 2. Marcador "SEM ANÚNCIO"/"NÃO IDENTIFICADO" sem ad_id → NÃO é anúncio.
  v_sem_anuncio := (v_na ~ '^(sem an|nao identificado)')
                OR (v_s  ~ '^(sem an|nao identificado)');

  -- 3. source de anúncio.
  IF NOT v_sem_anuncio AND (
       v_s = 'facebook_ad'
    OR v_s = 'instagram_ad'
    OR v_s ~ '_ads?$'
    OR v_s LIKE 'anuncio%'
  ) THEN
    RETURN 'Anúncio';
  END IF;

  -- 4-7. Demais origens.
  IF v_s LIKE 'instagram%' THEN RETURN 'Instagram Orgânico'; END IF;
  IF v_s LIKE '%whats%'    THEN RETURN 'WhatsApp/Direto';    END IF;
  IF v_s LIKE '%indica%'   THEN RETURN 'Indicação';          END IF;
  RETURN 'Outros';
END;
$$;

-- ----------------------------------------------------------------------------
-- RPC principal: agregados por origem canônica (uma linha por origem presente
-- na coorte; origens sem leads no período simplesmente não aparecem).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpt_origem_conversao(
  p_from date,
  p_to date,
  p_pipeline_id uuid DEFAULT NULL
)
RETURNS TABLE (
  origem text,
  leads bigint,
  atendidos bigint,
  agendados bigint,
  compareceram bigint,
  contratados bigint,
  faturamento numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.rpt_resolve_tenant();
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'Período inválido: informe p_from <= p_to';
  END IF;

  RETURN QUERY
  WITH cohort AS (
    -- Coorte fechada: leads criados no período (dia local America/Bahia),
    -- opcionalmente restrita a um funil.
    SELECT l.id, l.paciente_id, l.created_at, l.first_inbound_at,
           public.rpt_classify_origem(l.source, l.ad_id, l.nome_anuncio) AS origem_lead
    FROM public.crm_leads l
    WHERE l.tenant_id = v_tenant
      AND l.created_at >= (p_from::timestamp AT TIME ZONE 'America/Bahia')
      AND l.created_at <  ((p_to + 1)::timestamp AT TIME ZONE 'America/Bahia')
      AND (p_pipeline_id IS NULL OR l.pipeline_id = p_pipeline_id)
  ),
  first_in AS (
    -- 1º inbound real (mensagem) de cada lead da coorte.
    SELECT m.lead_id, min(m.created_at) AS fi
    FROM public.messages m
    JOIN cohort c ON c.id = m.lead_id
    WHERE m.direction = 'inbound'
    GROUP BY m.lead_id
  ),
  prim_pag AS (
    -- 1º pagamento GLOBAL (menor data_pagamento no tenant) e total pago de
    -- cada paciente vinculado à coorte. pagamentos não tem tenant_id: o
    -- tenant vem de clinicas.tenant_id (mesmo padrão de rpt_contratados).
    SELECT p.paciente_id,
           min(p.data_pagamento) AS primeiro,
           sum(p.valor)          AS total_pago
    FROM public.pagamentos p
    JOIN public.clinicas cl ON cl.id = p.clinica_id
    WHERE cl.tenant_id = v_tenant
      AND p.paciente_id IN (SELECT c2.paciente_id FROM cohort c2 WHERE c2.paciente_id IS NOT NULL)
    GROUP BY p.paciente_id
  ),
  flags AS (
    SELECT
      c.id,
      c.origem_lead,
      c.paciente_id,
      -- Atendido: existe outbound ESTRITAMENTE depois do 1º inbound
      -- (fallback: first_inbound_at do lead quando não há mensagem inbound).
      (COALESCE(f.fi, c.first_inbound_at) IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.messages m
        WHERE m.lead_id = c.id
          AND m.direction = 'outbound'
          AND m.created_at > COALESCE(f.fi, c.first_inbound_at)
      )) AS atendido,
      EXISTS (
        SELECT 1 FROM public.crm_appointments a WHERE a.lead_id = c.id
      ) AS agendado,
      EXISTS (
        SELECT 1 FROM public.crm_appointments a
        WHERE a.lead_id = c.id AND a.status IN ('contracted','not_contracted')
      ) AS compareceu,
      -- Contratado com guarda de coorte: 1º pagamento >= criação do lead
      -- (dia local) - 30 dias (TOLERANCIA_CONTRATO_DIAS do front). Paciente
      -- antigo revinculado (pagamento bem anterior ao lead) NÃO conta.
      (pp.primeiro IS NOT NULL
        AND pp.primeiro >= ((c.created_at AT TIME ZONE 'America/Bahia')::date - 30)
      ) AS contratado,
      pp.total_pago
    FROM cohort c
    LEFT JOIN first_in f  ON f.lead_id = c.id
    LEFT JOIN prim_pag pp ON pp.paciente_id = c.paciente_id
  ),
  fat AS (
    -- Faturamento por origem com paciente DISTINTO (dois leads da mesma
    -- origem com o mesmo paciente não somam o pagamento duas vezes).
    SELECT x.origem_lead, sum(x.total_pago) AS fat_total
    FROM (
      SELECT DISTINCT fl.origem_lead, fl.paciente_id, fl.total_pago
      FROM flags fl
      WHERE fl.contratado
    ) x
    GROUP BY x.origem_lead
  )
  SELECT
    fl.origem_lead                                   AS origem,
    count(*)::bigint                                 AS leads,
    count(*) FILTER (WHERE fl.atendido)::bigint      AS atendidos,
    count(*) FILTER (WHERE fl.agendado)::bigint      AS agendados,
    count(*) FILTER (WHERE fl.compareceu)::bigint    AS compareceram,
    count(*) FILTER (WHERE fl.contratado)::bigint    AS contratados,
    COALESCE(max(ft.fat_total), 0)::numeric          AS faturamento
  FROM flags fl
  LEFT JOIN fat ft ON ft.origem_lead = fl.origem_lead
  GROUP BY fl.origem_lead
  ORDER BY count(*) DESC, fl.origem_lead;
END;
$$;

-- ----------------------------------------------------------------------------
-- Permissões (mesmo padrão das demais rpt_*): sem EXECUTE para PUBLIC/anon;
-- apenas usuários autenticados do app e service_role.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.rpt_norm_txt(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpt_classify_origem(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpt_origem_conversao(date, date, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.rpt_norm_txt(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpt_classify_origem(text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpt_origem_conversao(date, date, uuid) TO authenticated, service_role;
