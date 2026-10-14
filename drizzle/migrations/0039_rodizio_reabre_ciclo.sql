-- Paciente de ciclo encerrado que volta a escrever vai para uma SDR (14/10/2026).
--
-- Decisão do dono: "todas as pessoas que mandarem mensagem no sistema caem
-- para uma das SDRs, independente se for contratado ou não contratado" (só
-- WhatsApp — o Instagram continua na caixa comum). Até aqui o ciclo
-- encerrado (Contratado, Não contratado, Compareceu…, consulta com desfecho
-- nos últimos 30 dias ou entrega ao administrador agendada) ficava com o
-- administrador para sempre — era o que aparecia "no geral".
--
-- Só a ENTRADA por mensagem reabre o ciclo (rodizio_on_mensagem): o lead
-- novo, a realocação por silêncio e as varreduras continuam com a régua de
-- sempre (rodizio_lead_na_fila). A etapa não muda — a SDR enxerga o lead dela
-- mesmo em etapa oculta, e o contrato continua registrado.

CREATE OR REPLACE FUNCTION public.rodizio_lead_reabre_ciclo(p_lead crm_leads, p_admin uuid, p_numero uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT (p_lead).id IS NOT NULL
     AND (p_lead).pipeline_id IS NOT NULL
     AND COALESCE((p_lead).pipeline_id = ANY (public.rodizio_funis((p_lead).tenant_id)), false)
     AND NOT COALESCE((p_lead).is_blocked, false)
     AND (p_lead).rodizio_reservado_para IS NULL
     AND ((p_lead).assigned_to IS NULL OR (p_admin IS NOT NULL AND (p_lead).assigned_to = p_admin))
     AND NOT public.rodizio_fonte_excluida((p_lead).source)
     AND (p_lead).ig_account_uuid IS NULL
     AND (p_lead).instagram_user_id IS NULL
     AND public.mundo_numero_whatsapp((p_lead).tenant_id, (p_lead).whatsapp_number_id)
         = CASE WHEN p_numero IS NULL THEN 'crc'
                ELSE public.mundo_numero_whatsapp((p_lead).tenant_id, p_numero) END
     -- É ciclo encerrado (senão a régua normal já trata).
     AND (EXISTS (SELECT 1 FROM public.crm_stages s
                   WHERE s.id = (p_lead).stage_id AND NOT COALESCE(s.visivel_para_sdr, true))
          OR EXISTS (SELECT 1 FROM public.crm_appointments a
                      WHERE a.lead_id = (p_lead).id AND a.status IN ('contracted', 'not_contracted'))
          OR EXISTS (SELECT 1 FROM public.crm_entregas_gestor e WHERE e.lead_id = (p_lead).id)
          OR (p_lead).distribuido_em IS NOT NULL);
$function$;
REVOKE ALL ON FUNCTION public.rodizio_lead_reabre_ciclo(crm_leads, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rodizio_lead_reabre_ciclo(crm_leads, uuid, uuid) TO service_role;

-- O motor aceita o lead reaberto quando a entrada por mensagem pede
-- (GUC transacional rodizio.reabrir = 'sim', posta só por rodizio_on_mensagem).
CREATE OR REPLACE FUNCTION public.rodizio_processar_lead(p_lead_id uuid, p_origem text, p_run uuid DEFAULT gen_random_uuid())
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET lock_timeout TO '5s'
AS $function$
DECLARE
  l public.crm_leads;
  cfg public.crm_rodizio_config;
  v_funil uuid; v_numero uuid; v_hoje date;
  v_ids uuid[]; v_cargas integer[]; v_abertas uuid[]; v_cargas_abertas integer[];
  v_presentes uuid[]; v_cargas_presentes integer[];
  v_pool_ids uuid[]; v_pool_cargas integer[];
  v_imediato boolean; v_alvo uuid; v_alvo_nome text; v_ok uuid;
  v_reabrir boolean := COALESCE(current_setting('rodizio.reabrir', true), '') = 'sim';
BEGIN
  SELECT * INTO l FROM public.crm_leads WHERE id = p_lead_id;
  IF NOT FOUND OR l.tenant_id IS NULL THEN RETURN 'sem_lead'; END IF;

  -- Interruptor + mutex por cliente (solta no commit).
  SELECT * INTO cfg FROM public.crm_rodizio_config WHERE tenant_id = l.tenant_id FOR UPDATE;
  IF NOT FOUND OR cfg.modo = 'desligado' THEN RETURN 'desligado'; END IF;

  -- Relê o lead DEPOIS de ter o mutex: outra rodada pode ter tratado enquanto
  -- esta esperava.
  SELECT * INTO l FROM public.crm_leads WHERE id = p_lead_id;
  -- Funil de REFERÊNCIA: a régua aceita qualquer funil de rodizio_funis().
  v_funil := public.rodizio_funil(l.tenant_id);
  v_numero := public.rodizio_numero_principal(l.tenant_id);
  IF NOT public.rodizio_lead_na_fila(l, cfg.gestor_user_id, v_funil, v_numero, public.rodizio_etapas_entrada(l.tenant_id)) THEN
    IF NOT (v_reabrir AND public.rodizio_lead_reabre_ciclo(l, cfg.gestor_user_id, v_numero)) THEN
      RETURN 'fora_da_fila';
    END IF;
    IF cfg.modo = 'ligado' THEN
      -- Ciclo reaberto: a entrega pendente ao administrador cai e o lead volta
      -- a ser "sem distribuição" para o motor aplicar abaixo.
      DELETE FROM public.crm_entregas_gestor WHERE lead_id = l.id;
      UPDATE public.crm_leads SET distribuido_em = NULL WHERE id = l.id AND distribuido_em IS NOT NULL;
      SELECT * INTO l FROM public.crm_leads WHERE id = p_lead_id;
    END IF;
  END IF;

  IF cfg.modo = 'sombra' AND EXISTS (
       SELECT 1 FROM public.crm_lead_atribuicoes a
        WHERE a.lead_id = l.id AND a.fase = 'sombra' AND a.motivo LIKE 'entrada:%') THEN
    RETURN 'sombra_ja_anotado';
  END IF;

  SELECT array_agg(p.user_id ORDER BY p.ordem),
         array_agg(p.carga ORDER BY p.ordem),
         array_agg(p.user_id ORDER BY p.ordem) FILTER (WHERE p.aberta),
         array_agg(p.carga ORDER BY p.ordem) FILTER (WHERE p.aberta),
         array_agg(p.user_id ORDER BY p.ordem) FILTER (WHERE p.presente),
         array_agg(p.carga ORDER BY p.ordem) FILTER (WHERE p.presente)
    INTO v_ids, v_cargas, v_abertas, v_cargas_abertas, v_presentes, v_cargas_presentes
    FROM public.rodizio_pool(l.tenant_id) p;

  IF v_ids IS NULL THEN
    v_hoje := (now() AT TIME ZONE public.rodizio_tz(l.tenant_id))::date;
    PERFORM public.rodizio_notifica(cfg.gestor_user_id, NULL,
      'Rodízio: nenhuma SDR elegível',
      'Chegou lead no funil e não há SDR ativa no rodízio (desbloqueada e ligada na aba Equipe). O lead ficou com o administrador.',
      'rodizio:sem_elegiveis:' || l.tenant_id::text || ':' || v_hoje::text);
    RETURN 'sem_elegiveis';
  END IF;

  v_imediato := v_presentes IS NOT NULL;
  IF NOT v_imediato THEN
    v_pool_ids := v_ids; v_pool_cargas := v_cargas;
  ELSIF v_abertas IS NOT NULL THEN
    v_pool_ids := v_abertas; v_pool_cargas := v_cargas_abertas;
  ELSE
    v_pool_ids := v_presentes; v_pool_cargas := v_cargas_presentes;
  END IF;
  v_alvo := public.rodizio_escolher(v_pool_ids, v_pool_cargas, cfg.ponteiro_user_id);
  IF v_alvo IS NULL THEN RETURN 'sem_alvo'; END IF;
  v_alvo_nome := public.rodizio_nome(v_alvo);

  UPDATE public.crm_rodizio_config SET ponteiro_user_id = v_alvo WHERE tenant_id = l.tenant_id;

  IF cfg.modo = 'sombra' THEN
    PERFORM public.rodizio_livro(l, l.assigned_to, v_alvo, 'sombra',
      'entrada: ' || p_origem || ' — '
        || CASE WHEN v_imediato THEN 'iria na hora para ' || v_alvo_nome || ' (presente)'
                ELSE 'ficaria reservado para ' || v_alvo_nome || ' (ninguém presente)' END,
      p_run);
    RETURN 'sombra';
  END IF;

  IF v_imediato THEN
    UPDATE public.crm_leads
       SET assigned_to = v_alvo, distribuido_em = now(),
           rodizio_reservado_para = NULL, rodizio_reservado_em = NULL, updated_at = now()
     WHERE id = l.id
       AND distribuido_em IS NULL AND rodizio_reservado_para IS NULL
       AND (assigned_to IS NULL OR assigned_to = cfg.gestor_user_id)
     RETURNING id INTO v_ok;
    IF v_ok IS NULL THEN RETURN 'perdeu_corrida'; END IF;
    PERFORM public.rodizio_livro(l, l.assigned_to, v_alvo, 'aplicacao',
      'entrada: ' || p_origem || ' — distribuição imediata (SDR presente)', p_run);
    PERFORM public.rodizio_msg_sistema(l.id, l.tenant_id, '🔀 Lead distribuído para ' || v_alvo_nome || ' pelo rodízio');
    PERFORM public.rodizio_notifica(v_alvo, l.id, 'Novo lead para você',
      COALESCE(NULLIF(btrim(l.name), ''), 'Lead') || COALESCE(' · ' || NULLIF(btrim(l.phone), ''), ''));
    RETURN 'aplicado';
  END IF;

  UPDATE public.crm_leads
     SET rodizio_reservado_para = v_alvo, rodizio_reservado_em = now()
   WHERE id = l.id
     AND distribuido_em IS NULL AND rodizio_reservado_para IS NULL
     AND (assigned_to IS NULL OR assigned_to = cfg.gestor_user_id)
   RETURNING id INTO v_ok;
  IF v_ok IS NULL THEN RETURN 'perdeu_corrida'; END IF;
  PERFORM public.rodizio_livro(l, l.assigned_to, v_alvo, 'reserva',
    'entrada: ' || p_origem || ' — reservado (ninguém presente); aplica quando ela abrir o expediente', p_run);
  RETURN 'reservado';
END $function$;

CREATE OR REPLACE FUNCTION public.rodizio_on_mensagem()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET lock_timeout TO '5s'
AS $function$
DECLARE v_tenant uuid; v_modo text; v_admin uuid; l public.crm_leads; v_reabre boolean := false;
BEGIN
  -- Resposta por botão (ex.: "Ainda tenho interesse" de um disparo) também
  -- distribui: pedido do dono em 08/10/2026.
  IF NEW.direction <> 'inbound' OR NEW.lead_id IS NULL OR NEW.instagram_comment_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  v_tenant := COALESCE(NEW.tenant_id, (SELECT x.tenant_id FROM public.crm_leads x WHERE x.id = NEW.lead_id));
  IF v_tenant IS NULL THEN RETURN NEW; END IF;
  SELECT k.modo, k.gestor_user_id INTO v_modo, v_admin FROM public.crm_rodizio_config k WHERE k.tenant_id = v_tenant;
  IF v_modo IS NULL OR v_modo = 'desligado' THEN RETURN NEW; END IF;
  SELECT * INTO l FROM public.crm_leads x WHERE x.id = NEW.lead_id;
  IF NOT FOUND OR l.tenant_id IS NULL THEN RETURN NEW; END IF;
  IF NOT public.rodizio_lead_na_fila(l, v_admin, public.rodizio_funil(l.tenant_id),
                                     public.rodizio_numero_principal(l.tenant_id), public.rodizio_etapas_entrada(l.tenant_id)) THEN
    -- Ciclo encerrado (Contratado/Não contratado…) que volta a escrever pelo
    -- WhatsApp também vai para uma SDR (dono, 14/10/2026).
    v_reabre := public.rodizio_lead_reabre_ciclo(l, v_admin, public.rodizio_numero_principal(l.tenant_id));
    IF NOT v_reabre THEN RETURN NEW; END IF;
  END IF;
  IF COALESCE(NEW.type, 'text') = 'text'
     AND COALESCE(NEW.content, '') ~ '^\s*\d{1,2}\s*[.!]?\s*$'
     AND EXISTS (SELECT 1 FROM public.crm_pesquisa_respostas pr
                  WHERE pr.lead_id = NEW.lead_id
                    AND pr.respondida_em IS NULL AND pr.nota IS NULL
                    AND pr.enviada_em >= now() - interval '7 days') THEN
    RETURN NEW;
  END IF;
  BEGIN
    IF v_reabre THEN PERFORM set_config('rodizio.reabrir', 'sim', true); END IF;
    PERFORM public.rodizio_processar_lead(NEW.lead_id,
      CASE WHEN v_reabre THEN 'paciente de ciclo encerrado voltou a escrever'
           ELSE 'mensagem recebida em lead do administrador' END);
    IF v_reabre THEN PERFORM set_config('rodizio.reabrir', '', true); END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('rodizio.reabrir', '', true);
    RAISE WARNING 'rodizio_on_mensagem: lead % não distribuído (%): %', NEW.lead_id, SQLSTATE, SQLERRM;
  END;
  RETURN NEW;
END $function$;
