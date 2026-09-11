-- =============================================================================
-- Duas pendências que sobraram da entrega de 11/09.
--
--   (A) ponto_vigia ainda traduzia o motivo da pausa por uma LISTA FIXA
--       cafe/almoco/outro. Como os motivos viraram tabela no mesmo dia, o aviso
--       de pausa longa que chega ao gestor chamava "Ligação" de "outro".
--   (B) A busca em mensagens não achava palavra acentuada digitada sem acento
--       (543 mensagens com "orçamento" contra 8 com "orcamento") nem o texto dos
--       áudios já transcritos. Aqui entra só a FERRAMENTA (a função imutável que
--       tira acento); a busca passa a usá-la na migration seguinte, depois que os
--       índices estiverem criados — trocar a consulta antes do índice existir
--       derrubaria a busca para 8 segundos e ela quebraria na tela da SDR.
-- =============================================================================


-- ============================================ (A) o aviso de pausa longa, certo
-- Corpo idêntico ao que está em produção (conferido por pg_get_functiondef em
-- 11/09/2026), com uma única mudança: o CASE fixo vira ponto_rotulo_motivo, a
-- mesma tradução que o relatório e a tela usam. E o motivo escrito pela SDR em
-- "Outro" passa a aparecer no aviso — sem ele, o gestor lê "Em pausa (Outro) há
-- 80 min" e não sabe o que perguntar.
CREATE OR REPLACE FUNCTION public.ponto_vigia()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  r record;
  s record;
  h record;
  v_cfg record;
  v_tz text;
  v_dia date;
  v_corte timestamptz;
  v_fim timestamptz;
  v_adiado timestamptz;
  v_em timestamptz;
  v_nome text;
  v_min_pausa integer;
  v_rotulo text;
  v_detalhe text;
  v_encerrados integer := 0;
  v_alertas integer := 0;
BEGIN
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
      v_em := GREATEST(v_corte, s.ultimo_evento_em + interval '1 second');
      INSERT INTO public.crm_ponto_eventos (tenant_id, user_id, tipo, origem, em)
      VALUES (r.tenant_id, r.user_id, 'encerrar', 'auto', v_em);
      v_encerrados := v_encerrados + 1;
      CONTINUE;
    END IF;

    -- (a2) saída do horário da SDR: sessão aberta ANTES da saída de hoje encerra
    -- sozinha depois da saída + 1 min (o cartão pergunta antes), salvo adiamento
    -- em vigor. Aberta depois da saída (hora extra) fica para a regra (a).
    SELECT * INTO h FROM public.rodizio_horario_dia(r.tenant_id, r.user_id, (now() AT TIME ZONE v_tz)::date);
    IF h.saida IS NOT NULL THEN
      v_fim := ((now() AT TIME ZONE v_tz)::date + h.saida) AT TIME ZONE v_tz;
      SELECT m.encerramento_adiado_ate INTO v_adiado
        FROM public.crm_rodizio_membros m WHERE m.tenant_id = r.tenant_id AND m.user_id = r.user_id;
      IF v_adiado IS NOT NULL AND v_adiado > v_fim THEN v_fim := v_adiado; END IF;
      IF s.abriu_em < v_fim AND now() >= v_fim + interval '1 minute' THEN
        v_em := GREATEST(v_fim, s.ultimo_evento_em + interval '1 second');
        INSERT INTO public.crm_ponto_eventos (tenant_id, user_id, tipo, origem, em)
        VALUES (r.tenant_id, r.user_id, 'encerrar', 'auto', v_em);
        v_encerrados := v_encerrados + 1;
        CONTINUE;
      END IF;
    END IF;

    -- (b) pausa longa: um aviso por pausa (dedupe pelo id do evento 'pausar').
    IF s.estado = 'pausado' AND v_cfg.gestor_user_id IS NOT NULL
       AND now() - s.pausa_desde >= make_interval(mins => COALESCE(v_cfg.pausa_alerta_min, 75))
       AND NOT EXISTS (SELECT 1 FROM public.crm_notifications n
                        WHERE n.user_id = v_cfg.gestor_user_id
                          AND n.dedupe_key = 'ponto_pausa_longa:' || s.ultimo_evento_id) THEN
      SELECT p.nome INTO v_nome FROM public.profiles p WHERE p.id = r.user_id;
      v_min_pausa := (EXTRACT(EPOCH FROM (now() - s.pausa_desde)) / 60)::integer;

      -- AQUI: o rótulo vem da tabela de motivos do cliente, não de uma lista
      -- escrita dentro desta função.
      v_rotulo := public.ponto_rotulo_motivo(r.tenant_id, s.motivo_pausa);
      SELECT NULLIF(btrim(COALESCE(e.motivo_detalhe, '')), '') INTO v_detalhe
        FROM public.crm_ponto_eventos e WHERE e.id = s.ultimo_evento_id;

      INSERT INTO public.crm_notifications AS n (user_id, title, body, type, dedupe_key)
      VALUES (
        v_cfg.gestor_user_id,
        'Pausa longa: ' || COALESCE(v_nome, 'SDR'),
        'Em pausa (' || v_rotulo || COALESCE(': ' || v_detalhe, '')
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
END $function$;


-- ============================================ (B) a ferramenta para tirar acento
-- unaccent() é STABLE (o dicionário é carregado do disco), e índice de expressão
-- exige IMMUTABLE. O embrulho abaixo é o jeito canônico: fixa o dicionário pelo
-- nome, o que torna o resultado determinístico e permite indexar.
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION public.sem_acento(p_texto text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $fn$
  SELECT public.unaccent('public.unaccent'::regdictionary, p_texto);
$fn$;

REVOKE ALL ON FUNCTION public.sem_acento(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sem_acento(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.sem_acento(text) IS
  'Tira acento de forma IMUTÁVEL, para poder indexar. É o que faz "orcamento" achar "orçamento" na busca em mensagens. Não use unaccent() direto em índice: ela é STABLE e o índice sairia errado.';


-- =============================================================================
-- VERIFICAÇÃO (só leitura, depois de aplicar)
--
-- 1) O aviso de pausa longa passou a usar a tabela?
-- SELECT position('ponto_rotulo_motivo' in pg_get_functiondef(p.oid)) > 0 AS usa_tabela,
--        position('WHEN ''cafe''' in pg_get_functiondef(p.oid)) = 0 AS sem_lista_fixa
--   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--  WHERE n.nspname='public' AND p.proname='ponto_vigia';
--
-- 2) sem_acento funciona nos dois sentidos?
-- SELECT public.sem_acento('orçamento') AS a,      -- esperado: orcamento
--        public.sem_acento('AVALIAÇÃO') AS b,      -- esperado: AVALIACAO
--        public.sem_acento('já não é') AS c;       -- esperado: ja nao e
--
-- 3) O tamanho do problema que ela resolve:
-- SELECT count(*) FILTER (WHERE m.content ILIKE '%orçamento%') AS com_acento,
--        count(*) FILTER (WHERE m.content ILIKE '%orcamento%') AS sem_acento,
--        count(*) FILTER (WHERE public.sem_acento(m.content) ILIKE '%orcamento%') AS pelas_duas
--   FROM public.messages m WHERE m.deleted_at IS NULL;
-- =============================================================================
