-- ============================================================================
-- Camada canônica de relatórios (rpt_*)
-- ============================================================================
-- Decisões canônicas (aprovadas pelo dono):
--   * FATURAMENTO  = soma de pagamentos.valor agrupada por pagamentos.data_pagamento.
--                    NUNCA usar crm_leads.value como faturamento.
--   * CONTRATADO   = paciente cujo PRIMEIRO pagamento (MIN(data_pagamento) global,
--                    considerando todas as clínicas do tenant) cai no período.
--   * DATAS        = sempre no fuso America/Bahia (UTC-3, sem horário de verão).
--                    pagamentos.data_pagamento e crm_appointments.scheduled_date já
--                    são DATE (dia local); "hoje" é calculado com
--                    (now() AT TIME ZONE 'America/Bahia')::date.
--   * PERÍODOS     = inclusivos nas duas pontas (BETWEEN p_from AND p_to).
--   * CONSISTÊNCIA = SECURITY DEFINER com filtro explícito de tenant: qualquer
--                    usuário autorizado do tenant vê O MESMO número (não depende
--                    de RLS por papel).
--
-- Segurança:
--   * Todas as funções são SECURITY DEFINER com SET search_path = public.
--   * O tenant é resolvido via profiles.tenant_id (auth.uid()), nunca vem do cliente.
--   * pagamentos não tem tenant_id próprio: o tenant é derivado de clinicas.tenant_id.
--   * Esta migração NÃO altera objetos existentes nem políticas de RLS.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helper: resolução canônica de tenant para os relatórios.
-- 1) Usuário autenticado -> profiles.tenant_id (mesmo padrão de current_tenant_id()).
-- 2) Sessão administrativa (service_role via PostgREST, ou conexão direta como
--    postgres/supabase_admin) sem auth.uid():
--      a) usa o GUC app.tenant_id, se definido (SET app.tenant_id = '<uuid>');
--      b) senão, usa o tenant ÚNICO com status = 'active';
--      c) se houver mais de um tenant ativo, exige o GUC (erro com dica).
-- Qualquer outro caso: erro (nunca retorna dados sem tenant resolvido).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpt_resolve_tenant()
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant     uuid;
  v_jwt_role   text;
  v_guc_tenant text;
  v_ativos     int;
BEGIN
  -- Caso normal: usuário autenticado do app
  IF auth.uid() IS NOT NULL THEN
    SELECT p.tenant_id INTO v_tenant FROM public.profiles p WHERE p.id = auth.uid();
    IF v_tenant IS NULL THEN
      RAISE EXCEPTION 'Usuário sem tenant associado';
    END IF;
    RETURN v_tenant;
  END IF;

  -- Sessão administrativa (validação/manutenção): service_role ou conexão direta
  v_jwt_role := COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  IF v_jwt_role = 'service_role'
     OR session_user IN ('postgres', 'supabase_admin', 'supabase_read_only_user') THEN

    v_guc_tenant := NULLIF(current_setting('app.tenant_id', true), '');
    IF v_guc_tenant IS NOT NULL THEN
      RETURN v_guc_tenant::uuid;
    END IF;

    SELECT count(*) INTO v_ativos FROM public.tenants t WHERE t.status = 'active';
    IF v_ativos = 1 THEN
      SELECT t.id INTO v_tenant FROM public.tenants t WHERE t.status = 'active';
      RETURN v_tenant;
    END IF;

    RAISE EXCEPTION 'Há % tenants ativos; defina o tenant com SET app.tenant_id = ''<uuid>''', v_ativos;
  END IF;

  RAISE EXCEPTION 'Não autenticado';
END;
$$;

-- ----------------------------------------------------------------------------
-- 1) rpt_faturamento: faturamento por dia/clínica/tipo/especialidade.
--    Fonte: pagamentos JOIN clinicas (tenant via clinicas.tenant_id).
--    dia = pagamentos.data_pagamento (já é DATE no dia local America/Bahia).
--    Reagregado por dia, o resultado bate com o caixa real da clínica.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpt_faturamento(
  p_from date,
  p_to date,
  p_clinica_id uuid DEFAULT NULL
)
RETURNS TABLE (
  dia date,
  clinica_id uuid,
  clinica text,
  tipo text,
  especialidade text,
  total numeric,
  qtd bigint
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
  SELECT
    p.data_pagamento           AS dia,
    c.id                       AS clinica_id,
    c.nome                     AS clinica,
    p.tipo                     AS tipo,
    p.especialidade            AS especialidade,
    SUM(p.valor)               AS total,
    COUNT(*)::bigint           AS qtd
  FROM public.pagamentos p
  JOIN public.clinicas c ON c.id = p.clinica_id
  WHERE c.tenant_id = v_tenant
    AND p.data_pagamento BETWEEN p_from AND p_to
    AND (p_clinica_id IS NULL OR p.clinica_id = p_clinica_id)
  GROUP BY p.data_pagamento, c.id, c.nome, p.tipo, p.especialidade
  ORDER BY p.data_pagamento, c.nome, p.tipo, p.especialidade;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2) rpt_contratados: pacientes cujo PRIMEIRO pagamento (global no tenant,
--    todas as clínicas) cai no período.
--    * primeiro_pagamento = MIN(data_pagamento) do paciente no tenant inteiro
--      (nunca relativo ao período — senão todo período "inventaria" contratados).
--    * clinica = clínica do primeiro pagamento (desempate determinístico por
--      created_at e id quando há mais de um pagamento no dia mínimo).
--    * valor_total_periodo = soma de TODOS os pagamentos do paciente dentro do
--      período (em qualquer clínica do tenant).
--    * p_clinica_id filtra pela clínica do primeiro pagamento.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpt_contratados(
  p_from date,
  p_to date,
  p_clinica_id uuid DEFAULT NULL
)
RETURNS TABLE (
  paciente_id uuid,
  nome text,
  clinica text,
  primeiro_pagamento date,
  valor_total_periodo numeric
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
  WITH pagtos_tenant AS (
    SELECT p.paciente_id, p.clinica_id, p.data_pagamento, p.valor, p.created_at, p.id
    FROM public.pagamentos p
    JOIN public.clinicas c ON c.id = p.clinica_id
    WHERE c.tenant_id = v_tenant
  ),
  primeiro AS (
    -- Primeiro pagamento GLOBAL de cada paciente (uma linha por paciente)
    SELECT DISTINCT ON (pt.paciente_id)
      pt.paciente_id,
      pt.data_pagamento AS primeiro_pagamento,
      pt.clinica_id     AS clinica_primeiro
    FROM pagtos_tenant pt
    ORDER BY pt.paciente_id, pt.data_pagamento, pt.created_at, pt.id
  )
  SELECT
    f.paciente_id,
    pa.nome,
    cl.nome AS clinica,
    f.primeiro_pagamento,
    COALESCE((
      SELECT SUM(pt2.valor)
      FROM pagtos_tenant pt2
      WHERE pt2.paciente_id = f.paciente_id
        AND pt2.data_pagamento BETWEEN p_from AND p_to
    ), 0) AS valor_total_periodo
  FROM primeiro f
  JOIN public.pacientes pa ON pa.id = f.paciente_id
  JOIN public.clinicas cl ON cl.id = f.clinica_primeiro
  WHERE f.primeiro_pagamento BETWEEN p_from AND p_to
    AND (p_clinica_id IS NULL OR f.clinica_primeiro = p_clinica_id)
  ORDER BY f.primeiro_pagamento, pa.nome;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3) rpt_kpis_agendamentos: contagens de crm_appointments por scheduled_date
--    no período, com TODOS os status em buckets explícitos e sem resíduo:
--      contracted | not_contracted | no_show | rescheduled | cancelled | pending
--    * pending = qualquer status que não seja desfecho nem cancelamento
--      (hoje o app grava 'confirmed' como estado inicial; qualquer status novo
--      ou desconhecido cai aqui, garantindo total = soma dos buckets).
--    * pending_vencidos = subconjunto de pending com scheduled_date anterior a
--      HOJE em America/Bahia (agendamento passou e ninguém registrou desfecho).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpt_kpis_agendamentos(
  p_from date,
  p_to date
)
RETURNS TABLE (
  contracted bigint,
  not_contracted bigint,
  no_show bigint,
  rescheduled bigint,
  cancelled bigint,
  pending bigint,
  pending_vencidos bigint,
  total bigint
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.rpt_resolve_tenant();
  v_hoje date := (now() AT TIME ZONE 'America/Bahia')::date;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'Período inválido: informe p_from <= p_to';
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*) FILTER (WHERE a.status = 'contracted')::bigint      AS contracted,
    COUNT(*) FILTER (WHERE a.status = 'not_contracted')::bigint  AS not_contracted,
    COUNT(*) FILTER (WHERE a.status = 'no_show')::bigint         AS no_show,
    COUNT(*) FILTER (WHERE a.status = 'rescheduled')::bigint     AS rescheduled,
    COUNT(*) FILTER (WHERE a.status = 'cancelled')::bigint       AS cancelled,
    COUNT(*) FILTER (
      WHERE a.status NOT IN ('contracted','not_contracted','no_show','rescheduled','cancelled')
    )::bigint                                                    AS pending,
    COUNT(*) FILTER (
      WHERE a.status NOT IN ('contracted','not_contracted','no_show','rescheduled','cancelled')
        AND a.scheduled_date < v_hoje
    )::bigint                                                    AS pending_vencidos,
    COUNT(*)::bigint                                             AS total
  FROM public.crm_appointments a
  WHERE a.tenant_id = v_tenant
    AND a.scheduled_date BETWEEN p_from AND p_to;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4) rpt_leads_inativos: buckets de ESTOQUE (base inteira do tenant, sem período).
--    Base considerada: leads não bloqueados (is_blocked = false), com
--    last_inbound_at preenchido e FORA de etapa protegida. Etapa protegida
--    (mesma semântica do antigo isProtectedStage do front, case-insensitive):
--      * "agend"  sem "não agend"   (Agendado; "Não agendado" NÃO é protegida)
--      * "reagend" ou "remarc"      (Reagendado/Remarcado)
--      * "contrat" sem "não contrat" (Contratado; "Não contratado" NÃO é
--        protegida — esses leads CONTAM como inativos).
--    Buckets CUMULATIVOS (mesma semântica dos cards "+7 / +15 / +30 dias" da UI):
--    mais_30_dias ⊆ mais_15_dias ⊆ mais_7_dias ⊆ base_total.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpt_leads_inativos()
RETURNS TABLE (
  mais_7_dias bigint,
  mais_15_dias bigint,
  mais_30_dias bigint,
  base_total bigint
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.rpt_resolve_tenant();
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*) FILTER (WHERE l.last_inbound_at < now() - interval '7 days')::bigint   AS mais_7_dias,
    COUNT(*) FILTER (WHERE l.last_inbound_at < now() - interval '15 days')::bigint  AS mais_15_dias,
    COUNT(*) FILTER (WHERE l.last_inbound_at < now() - interval '30 days')::bigint  AS mais_30_dias,
    COUNT(*)::bigint                                                                AS base_total
  FROM public.crm_leads l
  JOIN public.crm_stages s ON s.id = l.stage_id
  WHERE l.tenant_id = v_tenant
    AND l.is_blocked = false
    AND l.last_inbound_at IS NOT NULL
    -- Fora de etapa protegida (espelha o antigo isProtectedStage do front):
    -- "não agendado"/"não contratado" NÃO são protegidas e contam como inativos.
    AND NOT (
         (lower(s.name) ~ 'agend'   AND lower(s.name) !~ 'n[aã]o\s*agend')
      OR (lower(s.name) ~ '(reagend|remarc)')
      OR (lower(s.name) ~ 'contrat' AND lower(s.name) !~ 'n[aã]o\s*contrat')
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 5) rpt_ticket_medio: tickets do período (base = pagamentos por data_pagamento).
--    * ticket_por_pagamento = soma(valor) / nº de pagamentos
--    * ticket_por_paciente  = soma(valor) / nº de pacientes distintos com
--      pagamento no período
--    Retorna 0 (e contagens 0) quando não há pagamentos no período.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpt_ticket_medio(
  p_from date,
  p_to date
)
RETURNS TABLE (
  ticket_por_pagamento numeric,
  ticket_por_paciente numeric,
  num_pagamentos bigint,
  num_pacientes bigint
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
  SELECT
    COALESCE(ROUND(SUM(p.valor) / NULLIF(COUNT(*), 0), 2), 0)                       AS ticket_por_pagamento,
    COALESCE(ROUND(SUM(p.valor) / NULLIF(COUNT(DISTINCT p.paciente_id), 0), 2), 0)  AS ticket_por_paciente,
    COUNT(*)::bigint                                                                AS num_pagamentos,
    COUNT(DISTINCT p.paciente_id)::bigint                                           AS num_pacientes
  FROM public.pagamentos p
  JOIN public.clinicas c ON c.id = p.clinica_id
  WHERE c.tenant_id = v_tenant
    AND p.data_pagamento BETWEEN p_from AND p_to;
END;
$$;

-- ----------------------------------------------------------------------------
-- Permissões: sem EXECUTE para PUBLIC/anon; apenas usuários autenticados do app
-- e o service_role (integrações/validação administrativa).
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.rpt_resolve_tenant() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpt_faturamento(date, date, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpt_contratados(date, date, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpt_kpis_agendamentos(date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpt_leads_inativos() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpt_ticket_medio(date, date) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.rpt_resolve_tenant() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpt_faturamento(date, date, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpt_contratados(date, date, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpt_kpis_agendamentos(date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpt_leads_inativos() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpt_ticket_medio(date, date) TO authenticated, service_role;
