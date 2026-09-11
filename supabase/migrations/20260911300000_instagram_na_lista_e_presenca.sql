-- =============================================================================
-- A aba do Instagram volta a mostrar TODOS os leads, e rápido.
--
-- RELATO DO DONO (11/09/2026, fim da tarde): "A aba do instagram tá demorando
-- de carregar os leads para o sdr, e não está mostrando todos os leads do
-- instagram como eu pedi".
--
-- A CAUSA, medida antes de mexer. A migration 20260911010000 abriu a caixa do
-- Instagram para as SDRs mexendo nas POLICIES de crm_leads — e a tela de
-- conversas não lê crm_leads pela RLS: ela chama public.get_conversation_leads,
-- que é SECURITY DEFINER e por isso tem uma régua PRÓPRIA, escrita à mão para
-- reproduzir as policies. Essa régua ficou na versão antiga:
--
--     AND ( NOT v_dona OR l.assigned_to = v_uid )
--
-- Lead da caixa comum não tem dona (assigned_to é NULL por desenho), então não
-- passava. Medido com o usuário da Bia:
--
--     leads no funil Instagram ................ 1.279
--     get_conversation_leads devolvia ......... 0     <-- a aba vazia
--     o que a RLS deixava ela ver ............. 1.279 em 799 ms
--
-- Os poucos que ela via chegavam pelo realtime, um a um, conforme o paciente
-- mandava mensagem — que é exatamente a sensação de "demorando pra carregar" e
-- "não mostra todos".
--
-- DEPOIS: 1.278 conversas na aba do Instagram (o 1.279º está bloqueado, e a
-- função exclui bloqueado desde sempre), a lista inteira em 135 ms.
--
-- LIÇÃO PARA A PRÓXIMA VEZ: neste projeto existem DUAS réguas de visibilidade
-- para a mesma coisa — as policies e as funções SECURITY DEFINER que as
-- reproduzem à mão por desempenho (get_conversation_leads,
-- buscar_leads_por_mensagem, conversa_lead_visivel). Mudar uma sem mudar as
-- outras deixa o sistema com duas verdades. Ao abrir ou fechar acesso, procurar
-- as três.
-- =============================================================================


-- ============================================ 1. a lista de conversas
-- Só o bloco da SDR muda; o resto é idêntico ao que estava em produção.
-- A lista dos funis de Instagram é resolvida UMA vez, como já se faz com
-- v_pipes, para o teste virar um "= ANY(...)" barato em vez de uma função por
-- linha (a régua canônica lead_da_caixa_do_instagram faria uma chamada por
-- lead, sobre milhares de linhas).
CREATE OR REPLACE FUNCTION public.get_conversation_leads(p_tenant_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20000)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_super boolean; v_crc boolean; v_gerente boolean; v_posvenda boolean; v_priv boolean;
  v_escopo_numero boolean;
  v_dona boolean;
  v_pipes uuid[];
  v_pipes_ig uuid[];
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN '[]'::jsonb; END IF;
  v_super := has_role(v_uid, 'superadmin'::app_role);
  v_tenant := current_tenant_id();
  IF v_super AND p_tenant_id IS NOT NULL THEN v_tenant := p_tenant_id; END IF;
  IF v_tenant IS NULL THEN RETURN '[]'::jsonb; END IF;
  v_crc := has_role(v_uid, 'crc'::app_role);
  v_gerente := has_role(v_uid, 'gerente'::app_role);
  v_posvenda := has_role(v_uid, 'posvenda'::app_role);
  v_priv := v_super OR v_crc OR v_gerente;
  v_escopo_numero := has_role(v_uid, 'closer'::app_role) OR has_role(v_uid, 'recepcao'::app_role);
  -- SDR: só leads de que é dona (Fase 1 do rodízio) MAIS a caixa comum do
  -- Instagram (11/09/2026).
  v_dona := has_role(v_uid, 'sdr'::app_role);

  SELECT COALESCE(array_agg(p.id), ARRAY[]::uuid[]) INTO v_pipes
  FROM crm_pipelines p
  WHERE p.tenant_id = v_tenant
    AND COALESCE(
      user_override(v_uid, 'pipeline', p.id::text),
      v_super OR (p.allowed_roles IS NULL AND (v_crc OR v_gerente))
      OR EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = v_uid AND ur.role = ANY(p.allowed_roles))
    )
    AND ( v_posvenda OR v_super OR NOT COALESCE(p.is_posvenda, false) );

  SELECT COALESCE(array_agg(p.id), ARRAY[]::uuid[]) INTO v_pipes_ig
  FROM crm_pipelines p
  WHERE p.tenant_id = v_tenant AND COALESCE(p.is_instagram, false);

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.last_message_at DESC NULLS LAST), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT l.id, l.name, l.phone, l.instagram_user_id, l.active_channel,
      l.instagram_username, l.instagram_profile_pic_url, l.last_message,
      l.last_message_at, l.last_inbound_at, l.last_outbound_at, l.tags, l.source,
      l.stage_id, l.pipeline_id, l.created_at, l.updated_at, l.assigned_to,
      l.paciente_id, l.cidade, l.servico_interesse, l.imagem_origem, l.titulo_anuncio,
      l.descricao_anuncio, l.link_anuncio, l.ad_id, l.nome_anuncio, l.ad_account_id,
      l.ad_account_name, l.is_blocked,
      l.whatsapp_number_id,
      -- Sem estas duas a lista não sabia que a conversa estava fechada: o menu
      -- oferecia "Fechar conversa" numa conversa já fechada e nunca oferecia
      -- "Reabrir".
      l.conversa_fechada_em,
      l.conversa_fechada_auto,
      wn.display_name AS whatsapp_number_name
    FROM crm_leads l
    LEFT JOIN whatsapp_numbers wn ON wn.id = l.whatsapp_number_id
    WHERE l.tenant_id = v_tenant
      AND l.is_blocked = false
      AND ( v_super OR l.pipeline_id = ANY(v_pipes) )
      AND (
        CASE WHEN v_escopo_numero
          THEN l.whatsapp_number_id IS NOT NULL AND can_access_whatsapp_number(l.whatsapp_number_id)
          ELSE can_access_whatsapp_number(l.whatsapp_number_id)
        END
      )
      AND ( v_priv OR can_access_instagram_account(l.ig_account_uuid) )
      AND (
        NOT v_dona
        OR l.assigned_to = v_uid
        OR (l.assigned_to IS NULL AND l.pipeline_id = ANY(v_pipes_ig))
      )
    ORDER BY l.last_message_at DESC NULLS LAST
    LIMIT p_limit
  ) t;

  RETURN v_result;
END;
$function$;


-- =================== 2. a mesma falta, em quem decide se a conversa abre
-- conversa_lead_visivel é a régua de public.conversa_fechar / conversa_reabrir
-- (via conversa_lead_alcancavel) e de pesquisa_oferecer. Ela tinha a mesma
-- linha antiga, então a SDR via o lead do Instagram na lista e não conseguia
-- fechar a conversa dele nem receber a oferta da pesquisa.
CREATE OR REPLACE FUNCTION public.conversa_lead_visivel(p_lead crm_leads)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT (p_lead).id IS NOT NULL
     AND auth.uid() IS NOT NULL
     AND (p_lead).tenant_id = public.current_tenant_id()
     AND public.can_access_pipeline((p_lead).pipeline_id)
     AND public.can_access_whatsapp_number((p_lead).whatsapp_number_id)
     AND public.can_access_instagram_account((p_lead).ig_account_uuid)
     AND (public.has_role(auth.uid(), 'posvenda'::app_role)
          OR public.has_role(auth.uid(), 'superadmin'::app_role)
          OR (p_lead).pipeline_id IS NULL
          OR NOT public.is_posvenda_pipeline((p_lead).pipeline_id))
     AND (NOT public.has_role(auth.uid(), 'closer'::app_role)
          OR ((p_lead).whatsapp_number_id IS NOT NULL AND public.can_access_whatsapp_number((p_lead).whatsapp_number_id)))
     AND (NOT public.has_role(auth.uid(), 'recepcao'::app_role)
          OR ((p_lead).whatsapp_number_id IS NOT NULL AND public.can_access_whatsapp_number((p_lead).whatsapp_number_id)))
     AND (NOT public.has_role(auth.uid(), 'sdr'::app_role)
          OR (p_lead).assigned_to = auth.uid()
          OR ((p_lead).assigned_to IS NULL
              AND EXISTS (SELECT 1 FROM public.crm_pipelines pi
                           WHERE pi.id = (p_lead).pipeline_id
                             AND COALESCE(pi.is_instagram, false))));
$function$;


-- ============ 3. a presença deixa de ser um espaço que qualquer um sobrescreve
-- O carimbo em_atendimento_por é um só por lead, e quem chamasse por último
-- ganhava. Medido no primeiro dia no ar: o lead MICAELE NEVES COSTA, da Bia,
-- estava carimbado pelo GESTOR (13:58) — e o predicado da realocação exige
-- em_atendimento_por = assigned_to, então a trava tinha morrido para aquele
-- lead. Como as duas telas recarimbam a cada 60 s, o dono do carimbo alternava
-- e, em metade das rodadas do cron, a SDR perderia o lead no meio da resposta:
-- exatamente o relato que originou a funcionalidade.
CREATE OR REPLACE FUNCTION public.conversa_estou_aqui(p_lead_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_tenant uuid; v_ok boolean; v_min integer; n integer;
BEGIN
  IF auth.uid() IS NULL OR p_lead_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'sem_sessao');
  END IF;

  SELECT l.tenant_id INTO v_tenant FROM public.crm_leads l WHERE l.id = p_lead_id;
  IF v_tenant IS NULL OR v_tenant IS DISTINCT FROM public.current_tenant_id() THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'fora_do_cliente');
  END IF;

  IF public.has_role(auth.uid(), 'sdr'::app_role) THEN
    v_ok := public.sdr_pode_ver_lead(p_lead_id);
  ELSE
    v_ok := true;
  END IF;
  IF NOT v_ok THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'sem_acesso');
  END IF;

  SELECT COALESCE(c.presenca_segura_min, 5) INTO v_min
    FROM public.crm_rodizio_config c WHERE c.tenant_id = v_tenant;
  v_min := COALESCE(v_min, 5);

  -- A marca da dona só sai quando ela mesma recarimba, quando está velha, ou
  -- quando não havia dona ali.
  UPDATE public.crm_leads l
     SET em_atendimento_por = auth.uid(),
         em_atendimento_em  = now()
   WHERE l.id = p_lead_id
     AND (
           l.em_atendimento_por IS NULL
        OR l.em_atendimento_por = auth.uid()
        OR l.em_atendimento_por IS DISTINCT FROM l.assigned_to
        OR l.em_atendimento_em IS NULL
        OR l.em_atendimento_em <= now() - make_interval(mins => v_min)
     );
  GET DIAGNOSTICS n = ROW_COUNT;

  -- n = 0 não é erro: quer dizer que a dona está aqui e a marca dela ficou de pé.
  RETURN jsonb_build_object('ok', true, 'em', now(), 'carimbou', n > 0);
END $function$;


-- =============================================================================
-- VERIFICAÇÃO (só leitura, depois de aplicar)
--
-- DO $t$
-- DECLARE rep text := E'\n'; j jsonb; n int; t0 timestamptz;
-- BEGIN
--   PERFORM set_config('request.jwt.claims',
--     json_build_object('sub','9c32408d-d852-4c55-9637-b30a59a16c13','role','authenticated')::text, true);
--   t0 := clock_timestamp();
--   SELECT public.get_conversation_leads(NULL, 20000) INTO j;
--   SELECT count(*) INTO n FROM jsonb_array_elements(j) e
--    WHERE (e->>'pipeline_id') = 'c2d3e4f5-0001-4000-8000-000000000002';
--   rep := rep || 'Instagram na lista da Bia: ' || n || ' em '
--       || round(extract(epoch from (clock_timestamp()-t0))*1000) || ' ms' || E'\n';
--   RAISE EXCEPTION '%', rep;   -- esperado: 1278, abaixo de 200 ms
-- END $t$;
-- =============================================================================
