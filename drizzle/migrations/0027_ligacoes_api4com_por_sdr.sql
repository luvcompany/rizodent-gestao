-- Ligações da Api4Com creditadas à SDR (pedido do dono, 09/10/2026).
--
-- Em out/26 as 715 ligações de telefonia saíram todas do ramal 1000 (usuário
-- rizodentmarketing) sem metadata.userId: as SDRs ligam pelo link tel: do lead e
-- quem disca é a extensão da Api4Com no Chrome, sem passar pelo CRM (só o botão
-- do CRM → api4com-dial manda o userId, e ele não é usado desde 08/09). Por isso
-- relatorio_sdr_ligacoes e o relatório por SDR mostravam só as ligações de
-- WhatsApp (5 no mês).
--
-- Agora cada ligação guarda QUEM ligou em api4com_calls.user_id, com a origem da
-- informação em user_origem:
--   'metadata'      → veio do botão do CRM (/dialer com userId);
--   'ramal'         → o ramal da ligação é de uma pessoa (api4com_extensions);
--   'dona_do_lead'  → estimativa: a SDR dona do lead na hora da ligação;
--   'retroativo'    → a mesma estimativa, gravada para as ligações antigas.
-- A estimativa usa o livro crm_lead_atribuicoes (só as fases que mudam a dona,
-- as mesmas que fecham a posse em relatorio_sdr_calc) e foi conferida em out/26:
-- 678 de 715 creditadas (Bia 397, Kelly 281); em 66 de 67 ligações feitas com uma
-- das SDRs em pausa o crédito foi para a outra; erro estimado de 1–2%. Quando
-- cada SDR tiver o próprio ramal na Api4Com (e em api4com_extensions), passa a
-- valer o ramal.
--
-- Atenção ao horário: a Api4Com manda o horário LOCAL (Bahia) com sufixo "Z", então
-- started_at fica gravado 3 h antes do real (conferido nas 2.876 ligações). A
-- dona na hora da ligação é buscada em started_at + 3 h.

ALTER TABLE public.api4com_calls
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS user_origem text;

DO $migracao$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api4com_calls_user_origem_chk') THEN
    ALTER TABLE public.api4com_calls
      ADD CONSTRAINT api4com_calls_user_origem_chk
      CHECK (user_origem IS NULL OR user_origem IN ('metadata', 'ramal', 'dona_do_lead', 'retroativo'));
  END IF;
END
$migracao$;

COMMENT ON COLUMN public.api4com_calls.user_id IS
  'Quem fez a ligação. A origem da informação está em user_origem (dona_do_lead/retroativo = estimativa).';

CREATE INDEX IF NOT EXISTS api4com_calls_tenant_user_idx
  ON public.api4com_calls (tenant_id, user_id);

-- Dona SDR do lead num instante: última atribuição até ali; se nada antes, quem
-- entregou na primeira atribuição depois; se o lead nunca mudou de mãos, a dona
-- atual (se já existia). Só devolve se for SDR. Uso do servidor (poll + backfill).
CREATE OR REPLACE FUNCTION public.api4com_dona_sdr_no_momento(p_lead uuid, p_quando timestamptz)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  WITH livro AS (
    SELECT a.para_user_id, a.de_user_id, a.criado_em
      FROM public.crm_lead_atribuicoes a
     WHERE a.lead_id = p_lead
       AND a.fase IN ('aplicacao', 'corte_9h', 'realocacao_1h', 'manual', 'comparecimento')
  ), d AS (
    SELECT CASE
      WHEN EXISTS (SELECT 1 FROM livro WHERE criado_em <= p_quando)
        THEN (SELECT para_user_id FROM livro WHERE criado_em <= p_quando ORDER BY criado_em DESC LIMIT 1)
      WHEN EXISTS (SELECT 1 FROM livro WHERE criado_em > p_quando)
        THEN (SELECT de_user_id FROM livro WHERE criado_em > p_quando ORDER BY criado_em LIMIT 1)
      ELSE (SELECT l.assigned_to FROM public.crm_leads l WHERE l.id = p_lead AND l.created_at <= p_quando)
    END AS uid
  )
  SELECT d.uid FROM d
   WHERE EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = d.uid AND ur.role = 'sdr'::app_role);
$fn$;

REVOKE ALL ON FUNCTION public.api4com_dona_sdr_no_momento(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api4com_dona_sdr_no_momento(uuid, timestamptz) TO service_role;

-- Ligações antigas: quem veio pelo botão fica com o userId do metadata; as demais,
-- desde o início do rodízio (08/09/2026), com a dona SDR do lead na hora.
UPDATE public.api4com_calls c
   SET user_id = NULLIF(c.raw_payload->'metadata'->>'userId', '')::uuid,
       user_origem = 'metadata'
 WHERE c.user_id IS NULL
   AND c.raw_payload->'metadata'->>'userId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

UPDATE public.api4com_calls c
   SET user_id = public.api4com_dona_sdr_no_momento(c.lead_id, c.started_at + interval '3 hours'),
       user_origem = 'retroativo'
 WHERE c.user_id IS NULL
   AND c.lead_id IS NOT NULL
   AND c.started_at >= timestamptz '2026-09-08 00:00-03' - interval '3 hours'
   AND public.api4com_dona_sdr_no_momento(c.lead_id, c.started_at + interval '3 hours') IS NOT NULL;

-- Relatório de ligações por SDR: quem ligou vem de user_id (com o metadata como
-- reserva); antes só contava ligação com metadata.userId.
CREATE OR REPLACE FUNCTION public.relatorio_sdr_ligacoes(p_de date, p_ate date, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(user_id uuid, ligacoes_feitas integer, ligacoes_atendidas integer, duracao_media_seg integer, telefonia_feitas integer, whatsapp_feitas integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid := public.current_tenant_id(); v_ini timestamptz; v_fim timestamptz; v_tz text;
BEGIN
  IF auth.uid() IS NULL OR v_tenant IS NULL THEN RETURN; END IF;
  IF p_de IS NULL OR p_ate IS NULL OR p_de > p_ate OR (p_ate - p_de) > 400 THEN
    RAISE EXCEPTION 'Período inválido.' USING ERRCODE = '22007';
  END IF;
  IF public.has_role(auth.uid(), 'sdr'::app_role) THEN
    p_user_id := auth.uid();                      -- a SDR só vê a si mesma
  ELSIF NOT public.is_gestor_equipe() THEN
    RAISE EXCEPTION 'Você não é o gestor da equipe desta clínica.' USING ERRCODE = '42501';
  END IF;
  v_tz := public.rodizio_tz(v_tenant);
  v_ini := (p_de::timestamp) AT TIME ZONE v_tz;
  v_fim := ((p_ate + 1)::timestamp) AT TIME ZONE v_tz;

  RETURN QUERY
  WITH tel AS (
    SELECT COALESCE(c.user_id, NULLIF(c.raw_payload->'metadata'->>'userId', '')::uuid) AS uid,
           (c.status = 'answered') AS atendida, c.duration_seconds AS dur
      FROM public.api4com_calls c
     WHERE c.tenant_id = v_tenant AND c.direction = 'outbound'
       AND COALESCE(c.started_at, c.created_at) >= v_ini AND COALESCE(c.started_at, c.created_at) < v_fim
  ), wa AS (
    SELECT w.initiated_by AS uid,
           (w.connected_at IS NOT NULL OR w.status IN ('accepted', 'completed')) AS atendida, w.duration_seconds AS dur
      FROM public.whatsapp_calls w
     WHERE w.tenant_id = v_tenant AND w.direction = 'outbound' AND w.initiated_by IS NOT NULL
       AND COALESCE(w.started_at, w.created_at) >= v_ini AND COALESCE(w.started_at, w.created_at) < v_fim
  ), tudo AS (
    SELECT uid, atendida, dur, 'tel' AS origem FROM tel
    UNION ALL
    SELECT uid, atendida, dur, 'wa' FROM wa
  )
  SELECT t.uid,
         count(*)::integer,
         count(*) FILTER (WHERE t.atendida)::integer,
         COALESCE(avg(t.dur) FILTER (WHERE t.atendida AND t.dur > 0), 0)::integer,
         count(*) FILTER (WHERE t.origem = 'tel')::integer,
         count(*) FILTER (WHERE t.origem = 'wa')::integer
    FROM tudo t
   WHERE t.uid IS NOT NULL
     AND (p_user_id IS NULL OR t.uid = p_user_id)
     AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = t.uid AND ur.role = 'sdr'::app_role)
   GROUP BY t.uid;
END $function$;
