-- Rodízio de SDRs — Fase 5: relatórios por SDR.
--
-- O que entra: TRÊS funções de leitura (nenhuma escreve nada, nenhuma liga o
-- motor) e dois índices de apoio. Nada de policy nova, nada de gatilho, nada
-- de coluna. Nenhum papel passa a poder mais nem menos: quem já lia o dado
-- cru continua lendo, quem não lia continua sem ler — as duas RPCs públicas
-- só devolvem números agregados, nunca um lead.
--
--   relatorio_sdr(p_de, p_ate)        → gestor da equipe (is_gestor_equipe()):
--                                        uma linha por SDR + a linha de total.
--   relatorio_sdr_minha(p_de, p_ate)  → a própria SDR: só a linha dela.
--   relatorio_sdr_calc(...)           → motor interno (REVOKE de todo mundo).
--
-- Zero SDRs cadastradas devolve ZERO LINHAS (a tela mostra o aviso); nunca
-- erro. O motor do rodízio continua como está (crm_rodizio_config.modo não é
-- lido nem escrito aqui).
--
-- ---------------------------------------------------------------------------
-- RÉGUAS (escritas aqui porque número de gente precisa de definição única)
-- ---------------------------------------------------------------------------
-- 1) LEADS RECEBIDOS no período, por SDR = a união de duas fontes, deduplicada
--    por lead:
--      (a) leads que HOJE são dela cujo COALESCE(distribuido_em, created_at)
--          cai no período — a MESMA régua do "Leads hoje" da aba Equipe
--          (equipe_listar), para os dois números nunca se contradizerem;
--      (b) leads que o livro crm_lead_atribuicoes registrou como entregues a
--          ela no período (fase <> 'sombra') — é o que segura a conta quando o
--          lead é transferido para outra pessoa depois: sem isso, transferir um
--          lead apagaria retroativamente o trabalho dela.
--    "Recebido em" = o MENOR dos dois instantes. "Saiu dela em" = a primeira
--    linha do livro DEPOIS disso em que ela é a origem (de_user_id); nada que
--    aconteça no lead depois de sair dela conta para ela.
--    Fase 'sombra' fica fora de propósito: em modo sombra o rodízio só anota
--    quem TERIA recebido — ninguém recebeu nada.
--
-- 2) PRIMEIRA RESPOSTA HUMANA — a régua ÚNICA public.rodizio_msg_humana
--    (migration 20260909100000; a mesma da realocação por silêncio do motor
--    e do admin-api): outbound não apagada com sender_id ou from_device, ou
--    LIGAÇÃO (type='call' — ligar conta como contato, decisão a confirmar com
--    o dono: reverter é uma linha na função), ou CONTEÚDO (text/audio/image/
--    document/video) que NÃO seja a saudação automática do bot ("*Elisa:*"),
--    template ("📋 Template:"), a espera automática ("Aguarde você será
--    atendido") nem status 'system' — dada ENQUANTO o lead era dela.
--    type='system' (logs de etapa/bot), 'comment', 'button', 'interactive'
--    não são resposta. Sem esse filtro o número vira ficção: era assim que o
--    card antigo mostrava "1min27s". Inbound com os mesmos filtros da régua
--    canônica (deleted_at IS NULL e instagram_comment_id IS NULL — comentário
--    de post não é conversa).
--    O RELÓGIO começa (t0):
--      • em recebido_em, se o lead já tinha mensagem SEM resposta humana no
--        instante em que ela o recebeu (é o caso do lead que chegou e o rodízio
--        entregou um minuto depois, do corte das 9h e da realocação por 1h sem
--        resposta — ela não podia responder antes de o lead ser dela);
--      • senão, na primeira mensagem recebida depois de recebido_em.
--    Lead sem t0 (ninguém escreveu) que ela contatou conta como respondido, mas
--    não entra na amostra de tempo — não há o que medir.
--    Tempo = relógio corrido (não desconta fora do expediente) — é o mesmo
--    relógio dos números que o dono já viu (mediana ~54min, média ~7h).
--    Mediana é percentile_cont sobre a amostra inteira; a linha de total
--    recalcula a mediana sobre TODOS os leads da equipe (média de medianas
--    seria um número inventado).
--    Crédito: a resposta conta para a DONA DO LEAD naquele instante, não para
--    quem digitou — messages.sender_id vem vazio em 99,5% das mensagens, então
--    "quem respondeu" não existe no banco. A tela diz isso.
--
-- 3) AGENDAMENTOS / COMPARECIMENTOS: régua canônica do resto do sistema
--    (reportKit.kpiAgendamentos + rpt_kpis_agendamentos), sempre por DATA
--    AGENDADA (scheduled_date), filtrada por crm_appointments
--    .responsavel_credito_id (carimbado na criação e imutável):
--      agendamentos  = total − cancelados
--      compareceram  = contracted + not_contracted   ('rescheduled' NÃO conta)
--      faltas        = no_show
--      contratados   = contracted
--
-- 4) CONVERSAS FECHADAS = leads com conversa_fechada_em no período, creditadas
--    a COALESCE(conversa_fechada_por, assigned_to) — o COALESCE cobre um
--    fechamento gravado pelo servidor sem autor. Reabrir e fechar de novo conta
--    só o último fechamento (a coluna guarda estado, não histórico).
--
-- 5) PESQUISA = respostas de crm_pesquisa_respostas com respondida_em no
--    período e crédito em responsavel_credito_id. A nota da equipe é a média
--    ponderada (soma das notas / número de notas), nunca a média das médias.
--
-- 6) EXPEDIENTE E PAUSA saem de crm_ponto_eventos (eventos, não estado):
--    cada evento vale até o evento seguinte da mesma pessoa. "Expediente" é o
--    tempo em estado ABERTO (abrir/retomar), já SEM as pausas; "pausa" é o
--    tempo em estado pausado. Um evento sem par (a SDR esqueceu de encerrar)
--    é fechado no menor entre: agora, o fim do período e a meia-noite do dia
--    dele no fuso da clínica — assim um esquecimento não vira 40 horas.
--    Fuso: o banco roda em UTC; toda fronteira de dia aqui é o fuso do tenant
--    (tenants.timezone via public.ponto_fuso_do_tenant, criada na
--    20260909100100 — América/Bahia na Rizodent), o mesmo de ponto_relatorio,
--    ponto_vigia e do motor; fixar 'America/Bahia' aqui faria relatório e ponto
--    contarem dias diferentes em outro cliente.
--
-- Pré-requisitos: 20260909100000 (rodizio_msg_humana) e 20260909100100
-- (ponto_fuso_do_tenant).
-- Rollback: DROP das três funções e dos dois índices. Nada mais foi tocado.

SET LOCAL lock_timeout = '5s';

-- ============================================================ 1. índices de apoio
-- Só leitura mais barata; não mudam comportamento. Estreitos porque as duas
-- colunas estão praticamente vazias hoje. As demais consultas já têm índice:
-- crm_leads_tenant_assigned_idx, crm_lead_atribuicoes_lead_idx,
-- crm_appointments_credito_idx, crm_ponto_eventos_user_idx,
-- idx_messages_inbound_no_comment e idx_messages_lead_created.
CREATE INDEX IF NOT EXISTS crm_leads_conversa_fechada_idx
  ON public.crm_leads (tenant_id, conversa_fechada_em)
  WHERE conversa_fechada_em IS NOT NULL;

CREATE INDEX IF NOT EXISTS crm_pesquisa_respostas_credito_idx
  ON public.crm_pesquisa_respostas (tenant_id, responsavel_credito_id, respondida_em);

-- ============================================================ 2. motor de cálculo (interno)
-- Não é chamável por usuário: REVOKE de authenticated/anon logo abaixo. As duas
-- RPCs públicas (que checam permissão) a chamam como donas.
--   p_user  NULL = todas as SDRs do tenant; preenchido = só aquela pessoa.
--   p_total TRUE = acrescenta a linha de total da equipe (is_total = true).
DROP FUNCTION IF EXISTS public.relatorio_sdr_calc(uuid, date, date, uuid, boolean);
CREATE FUNCTION public.relatorio_sdr_calc(
  p_tenant uuid,
  p_de date,
  p_ate date,
  p_user uuid,
  p_total boolean
)
RETURNS TABLE (
  user_id uuid,
  nome text,
  email text,
  no_rodizio boolean,
  bloqueada boolean,
  leads_recebidos integer,
  leads_respondidos integer,
  resp_amostra integer,
  resp_mediana_seg integer,
  resp_media_seg integer,
  agendamentos integer,
  compareceram integer,
  faltas integer,
  contratados integer,
  agend_cancelados integer,
  conversas_fechadas integer,
  pesquisa_respostas integer,
  pesquisa_nota_media numeric,
  minutos_expediente integer,
  minutos_pausa integer,
  is_total boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
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
     AND a.fase <> 'sombra'
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
         AND a.fase <> 'sombra'
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

REVOKE ALL ON FUNCTION public.relatorio_sdr_calc(uuid, date, date, uuid, boolean)
  FROM PUBLIC, anon, authenticated;

-- ============================================================ 3. RPC do gestor
-- Todas as SDRs + linha de total. Porta: is_gestor_equipe() (superadmin ou o
-- gestor NOMEADO em crm_rodizio_config.gestor_user_id) — papel nenhum abre
-- esta função sozinho, igual às RPCs equipe_*.
DROP FUNCTION IF EXISTS public.relatorio_sdr(date, date);
CREATE FUNCTION public.relatorio_sdr(p_de date, p_ate date)
RETURNS TABLE (
  user_id uuid,
  nome text,
  email text,
  no_rodizio boolean,
  bloqueada boolean,
  leads_recebidos integer,
  leads_respondidos integer,
  resp_amostra integer,
  resp_mediana_seg integer,
  resp_media_seg integer,
  agendamentos integer,
  compareceram integer,
  faltas integer,
  contratados integer,
  agend_cancelados integer,
  conversas_fechadas integer,
  pesquisa_respostas integer,
  pesquisa_nota_media numeric,
  minutos_expediente integer,
  minutos_pausa integer,
  is_total boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_tenant uuid := public.current_tenant_id();
BEGIN
  IF NOT public.is_gestor_equipe() THEN
    RAISE EXCEPTION 'Você não é o gestor da equipe desta clínica.' USING ERRCODE = '42501';
  END IF;
  -- Bloqueado/sem cliente: nada a mostrar, e sem erro na cara do usuário.
  IF v_tenant IS NULL THEN RETURN; END IF;
  IF p_de IS NULL OR p_ate IS NULL OR p_de > p_ate THEN
    RAISE EXCEPTION 'Período inválido: a data inicial precisa ser menor ou igual à final.' USING ERRCODE = '22007';
  END IF;
  IF (p_ate - p_de) > 400 THEN
    RAISE EXCEPTION 'Período muito longo: escolha no máximo 400 dias.' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY SELECT * FROM public.relatorio_sdr_calc(v_tenant, p_de, p_ate, NULL, true);
END $fn$;

REVOKE ALL ON FUNCTION public.relatorio_sdr(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.relatorio_sdr(date, date) TO authenticated, service_role;

-- ============================================================ 4. RPC da SDR
-- Só a linha de auth.uid(), e só para quem tem papel sdr. Sem linha de total
-- (uma linha só já é o total dela) e sem nome de lead nenhum.
DROP FUNCTION IF EXISTS public.relatorio_sdr_minha(date, date);
CREATE FUNCTION public.relatorio_sdr_minha(p_de date, p_ate date)
RETURNS TABLE (
  user_id uuid,
  nome text,
  email text,
  no_rodizio boolean,
  bloqueada boolean,
  leads_recebidos integer,
  leads_respondidos integer,
  resp_amostra integer,
  resp_mediana_seg integer,
  resp_media_seg integer,
  agendamentos integer,
  compareceram integer,
  faltas integer,
  contratados integer,
  agend_cancelados integer,
  conversas_fechadas integer,
  pesquisa_respostas integer,
  pesquisa_nota_media numeric,
  minutos_expediente integer,
  minutos_pausa integer,
  is_total boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_tenant uuid := public.current_tenant_id();
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'sdr'::app_role) THEN
    RAISE EXCEPTION 'Este relatório é da SDR.' USING ERRCODE = '42501';
  END IF;
  IF v_tenant IS NULL THEN RETURN; END IF;
  IF p_de IS NULL OR p_ate IS NULL OR p_de > p_ate THEN
    RAISE EXCEPTION 'Período inválido: a data inicial precisa ser menor ou igual à final.' USING ERRCODE = '22007';
  END IF;
  IF (p_ate - p_de) > 400 THEN
    RAISE EXCEPTION 'Período muito longo: escolha no máximo 400 dias.' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY SELECT * FROM public.relatorio_sdr_calc(v_tenant, p_de, p_ate, auth.uid(), false);
END $fn$;

REVOKE ALL ON FUNCTION public.relatorio_sdr_minha(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.relatorio_sdr_minha(date, date) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Verificação (rodar depois de aplicar):
--   SELECT * FROM public.relatorio_sdr('2026-09-01','2026-09-08');   -- gestor:
--     3 linhas (Bia, Fabíola, Júlia) + 'Equipe (total)', tudo zero até o
--     rodízio ser ligado.
--   SELECT * FROM public.relatorio_sdr_minha('2026-09-01','2026-09-08'); -- SDR:
--     só a linha dela.
-- Como crc comum (não gestor): a primeira responde
--   'Você não é o gestor da equipe desta clínica.' (42501).
-- Como crc/gerente: a segunda responde 'Este relatório é da SDR.' (42501).
-- Chamar relatorio_sdr_calc diretamente como authenticated: 'permission
--   denied for function' (42501) — é interna.
-- ---------------------------------------------------------------------------
