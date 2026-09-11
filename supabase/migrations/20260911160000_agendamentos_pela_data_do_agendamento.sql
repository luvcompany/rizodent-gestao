-- =============================================================================
-- "Agendamentos" passa a contar pela data em que a SDR AGENDOU.
--
-- O QUE O DONO VIU (11/09/2026): o Relatório por SDR mostrava 10 agendamentos no
-- filtro do mês e 3 no filtro de hoje, no primeiro dia em que o sistema rodou.
-- Ele perguntou como podia, e depois decidiu: "está errado, tem que contar pela
-- data que a sdr agendou".
--
-- O QUE EU APUREI ANTES DE MEXER. A aritmética estava certa; a régua é que
-- respondia outra pergunta. Foram criados exatamente 10 agendamentos naquele dia,
-- entre 08:51 e 11:43 — 7 da Bia e 3 da Fabíola, o que bate com a tela. Mas as
-- consultas estavam marcadas assim:
--     11/09 (hoje) ....... 3
--     12/09 .............. 3
--     14/09 .............. 1
--     16/09 .............. 2
--     21/09 .............. 1
-- A coluna contava por scheduled_date, então o filtro de hoje mostrava as 3
-- consultas de hoje, e o do mês somava as 10 porque todas caem em setembro.
--
-- A MUDANÇA. A CTE "agend" passa a recortar por a.created_at dentro da janela do
-- período (a mesma CTE "janela" que o resto da função já usa, com o fuso do
-- cliente), no lugar de a.scheduled_date BETWEEN p_de AND p_ate.
--
-- POR QUE OS DESFECHOS VÃO JUNTO. compareceram, faltas, contratados e cancelados
-- passam a seguir a mesma régua. A linha vira uma COORTE: "do que ela agendou
-- neste período, isto aconteceu". Misturar as duas réguas na mesma linha somaria
-- conjuntos diferentes — "10 agendamentos, 5 compareceram" em que os 5 vieram de
-- agendamentos de outro período — e isso é pior que o problema de origem.
--
-- O QUE MUDA NA LEITURA, e a tela precisa dizer: no filtro de HOJE os desfechos
-- ficam baixos ou zerados, porque a consulta marcada hoje ainda não aconteceu. A
-- coorte amadurece com os dias. Para "quantas consultas acontecem neste período"
-- existe o Calendário e o relatório de agendamentos — são perguntas diferentes.
--
-- Nada mais da função muda: leads recebidos/respondidos, tempo de 1ª resposta,
-- conversas fechadas, pesquisa e expediente continuam com as réguas de sempre.
-- Corpo copiado de 20260910012000_ciclo_carencia_e_relatorios.sql.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.relatorio_sdr_calc(
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
     -- RÉGUA: a data em que a SDR AGENDOU, não a data da consulta.
     -- Decisão do dono em 11/09/2026, depois de ver 10 no mês e 3 no dia: "está
     -- errado, tem que contar pela data que a sdr agendou". Ele tem razão sobre o
     -- que a coluna deve medir — o trabalho dela acontece no dia em que ela marca
     -- a consulta, e sete das dez marcadas naquela manhã eram para 12, 14, 16 e
     -- 21 de setembro. Pela régua antiga, o esforço do dia aparecia espalhado
     -- pelas semanas seguintes e o dia de hoje parecia vazio.
     --
     -- As COLUNAS DE DESFECHO (compareceram, faltas, contratados, cancelados)
     -- passam a andar junto, de propósito: a linha vira uma COORTE coerente —
     -- "do que ela agendou neste período, isto aconteceu". Deixar agendamentos
     -- por criação e desfechos por data da consulta faria a mesma linha somar
     -- coisas de conjuntos diferentes: "10 agendamentos, 5 compareceram" em que
     -- os 5 seriam de agendamentos de outro período. Isso é pior do que o
     -- problema original.
     --
     -- Efeito que a tela precisa explicar: no filtro de HOJE os desfechos ficam
     -- baixos ou zerados, porque a consulta que ela marcou hoje ainda não
     -- aconteceu. Não é número faltando; é a coorte amadurecendo.
     AND a.created_at >= (SELECT j.ini FROM janela j)
     AND a.created_at <  (SELECT j.fim FROM janela j)
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
GRANT EXECUTE ON FUNCTION public.relatorio_sdr_calc(uuid, date, date, uuid, boolean)
  TO service_role;
-- =============================================================================
-- VERIFICAÇÃO (só leitura, depois de aplicar). Para o dia 11/09/2026 os números
-- esperados são: filtro do dia = 10 agendamentos (7 Bia, 3 Fabíola) e desfechos
-- em 0; filtro do mês = 10 também, porque as 10 foram criadas em setembro.
--
-- SELECT nome, agendamentos, compareceram, faltas
--   FROM public.relatorio_sdr_calc('00000000-0000-0000-0000-000000000010',
--                                  '2026-09-11','2026-09-11', NULL, false)
--  ORDER BY nome;
-- =============================================================================
