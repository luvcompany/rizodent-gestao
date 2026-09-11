-- =============================================================================
-- A tela passa a dizer, ANTES de tentar, se dá para responder no Instagram.
--
-- RELATO DO DONO (11/09/2026): "as sdrs relataram que as vezes dá erro no
-- instagram e elas não conseguem enviar mensagem, aí elas tem que entrar no
-- aplicativo do instagram e responder".
--
-- O DIAGNÓSTICO, com os números do dia. Dos 71 leads do funil Instagram com
-- mensagem nos últimos 7 dias:
--     17  podem receber Direct agora
--     41  estão com a janela de 24 h da Meta FECHADA
--     13  só têm comentário, sem nenhum Direct — não existe conversa para responder
-- Ou seja, 54 de 71 (76%) não aceitam Direct pelo sistema. Não é defeito do
-- CRClin: a Meta só permite responder um Direct enquanto a pessoa tiver escrito
-- nas últimas 24 horas, e comentário não abre essa janela. No aplicativo do
-- Instagram funciona porque lá quem responde é o dono da conta, sem a API.
--
-- O QUE DÁ PARA MELHORAR. A edge function instagram-send-message já detecta os
-- dois casos e devolve um texto explicando — mas só DEPOIS que a SDR escreveu a
-- mensagem e clicou em enviar. Ela perde o trabalho e a confiança na tela. Esta
-- função deixa a tela perguntar ANTES, e mostrar quanto tempo ainda resta.
--
-- Não dá para contornar a regra da Meta. Dá para parar de fazer a equipe
-- descobrir o limite errando.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.instagram_janela_do_lead(p_lead_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_lead public.crm_leads;
  v_ultimo_dm timestamptz;
  v_tem_comentario boolean;
  v_fecha timestamptz;
BEGIN
  IF auth.uid() IS NULL OR p_lead_id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_lead FROM public.crm_leads WHERE id = p_lead_id;
  IF NOT FOUND OR v_lead.tenant_id IS DISTINCT FROM public.current_tenant_id() THEN
    RETURN NULL;
  END IF;

  -- Mesma régua de quem pode abrir o lead. A SDR passa por sdr_pode_ver_lead
  -- (que desde 11/09 inclui a caixa comum do Instagram); os outros papéis do
  -- cliente veem pelo tenant, que já foi conferido acima.
  IF public.has_role(auth.uid(), 'sdr'::app_role) AND NOT public.sdr_pode_ver_lead(p_lead_id) THEN
    RETURN NULL;
  END IF;

  -- SÓ mensagem de Direct conta, e só as que a PESSOA mandou. Comentário não
  -- abre a janela de 24 h — é a mesma régua que a edge function usa para achar
  -- o destinatário, e a razão de os dois lugares concordarem.
  SELECT max(im.created_at) INTO v_ultimo_dm
    FROM public.instagram_messages im
   WHERE im.lead_id = p_lead_id
     AND im.message_type = 'dm'
     AND NOT im.is_outbound;

  SELECT EXISTS (SELECT 1 FROM public.instagram_messages im
                  WHERE im.lead_id = p_lead_id AND im.message_type = 'comment')
    INTO v_tem_comentario;

  IF v_ultimo_dm IS NULL THEN
    RETURN jsonb_build_object(
      'pode_enviar', false,
      'situacao', CASE WHEN v_tem_comentario THEN 'so_comentario' ELSE 'sem_direct' END,
      'tem_comentario', v_tem_comentario,
      'aviso', CASE WHEN v_tem_comentario
                    THEN 'Esta pessoa só comentou, nunca mandou Direct. O Instagram não deixa iniciar um Direct — responda pelo comentário, na aba Comentário.'
                    ELSE 'Não há Direct desta pessoa registrado nesta conta. O Instagram só deixa responder quem mandou Direct primeiro.' END);
  END IF;

  v_fecha := v_ultimo_dm + interval '24 hours';

  IF now() < v_fecha THEN
    RETURN jsonb_build_object(
      'pode_enviar', true,
      'situacao', 'aberta',
      'fecha_em', v_fecha,
      'minutos_restantes', floor(extract(epoch FROM (v_fecha - now())) / 60)::integer,
      'ultimo_direct_em', v_ultimo_dm,
      'tem_comentario', v_tem_comentario,
      'aviso', NULL);
  END IF;

  RETURN jsonb_build_object(
    'pode_enviar', false,
    'situacao', 'fechada',
    'fechou_em', v_fecha,
    'ultimo_direct_em', v_ultimo_dm,
    'tem_comentario', v_tem_comentario,
    'aviso', 'A janela de 24 horas do Instagram fechou em '
             || to_char(v_fecha AT TIME ZONE public.rodizio_tz(v_lead.tenant_id), 'DD/MM às HH24:MI')
             || '. A Meta não deixa mais enviar Direct por aqui até a pessoa escrever de novo.'
             || CASE WHEN v_tem_comentario THEN ' Você pode responder pelo comentário, na aba Comentário.'
                     ELSE ' Para falar agora, use o aplicativo do Instagram.' END);
END $fn$;
REVOKE ALL ON FUNCTION public.instagram_janela_do_lead(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.instagram_janela_do_lead(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.instagram_janela_do_lead(uuid) IS
  'Diz se dá para responder este lead por Direct agora, quanto tempo resta da janela de 24 h da Meta, e o que fazer quando não dá. A tela chama antes de deixar escrever, para a equipe não descobrir o limite errando.';

-- =============================================================================
-- VERIFICAÇÃO (só leitura)
--
-- Quadro do dia, que é o mesmo que a função responde lead a lead:
-- WITH a AS (SELECT l.id FROM public.crm_leads l
--             WHERE l.pipeline_id='c2d3e4f5-0001-4000-8000-000000000002'
--               AND l.last_inbound_at > now() - interval '7 days')
-- SELECT count(*) FILTER (WHERE (public.instagram_janela_do_lead(a.id)->>'situacao')='aberta') AS pode_agora,
--        count(*) FILTER (WHERE (public.instagram_janela_do_lead(a.id)->>'situacao')='fechada') AS janela_fechada,
--        count(*) FILTER (WHERE (public.instagram_janela_do_lead(a.id)->>'situacao')='so_comentario') AS so_comentario
--   FROM a;
-- =============================================================================
