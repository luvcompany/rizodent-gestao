-- Rodízio de SDRs — duas decisões do dono em 09/09/2026.
--
-- 1) "Quero que inclua todos os leads de todas as etapas": qualquer lead do
--    administrador no funil do rodízio que mandar mensagem vai para a SDR em
--    expediente, em qualquer etapa e mesmo com consulta marcada. A régua
--    restrita (só etapas antes de Pré-Agendado, sem consulta) continua
--    disponível: é o comportamento com a flag entrada_todas_etapas = false.
--    A realocação por silêncio NÃO muda aqui: continua não mexendo em lead com
--    consulta marcada (evita pingue-pongue de paciente agendado).
--
-- 2) Conversa fechada reabre quando a EQUIPE manda mensagem humana (mesma
--    régua rodizio_msg_humana), como fazem Intercom/Zendesk/Kommo. A
--    mensagem da pesquisa de satisfação, que sai logo depois do fechamento,
--    não reabre.

-- ---------------------------------------------------------------- 1. todas as etapas
ALTER TABLE public.crm_rodizio_config
  ADD COLUMN IF NOT EXISTS entrada_todas_etapas boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.crm_rodizio_config.entrada_todas_etapas IS
  'true = lead do administrador em QUALQUER etapa do funil do rodízio (mesmo com consulta marcada) entra ao mandar mensagem; false = só etapas_entrada e sem consulta viva.';
UPDATE public.crm_rodizio_config SET entrada_todas_etapas = true
 WHERE tenant_id = '00000000-0000-0000-0000-000000000010';

CREATE OR REPLACE FUNCTION public.rodizio_etapas_entrada(p_tenant uuid)
RETURNS uuid[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_cfg uuid[]; v_todas boolean; v_funil uuid; v_corte integer; v_ids uuid[];
BEGIN
  IF p_tenant IS NULL THEN RETURN NULL; END IF;
  SELECT c.etapas_entrada, COALESCE(c.entrada_todas_etapas, false) INTO v_cfg, v_todas
    FROM public.crm_rodizio_config c WHERE c.tenant_id = p_tenant;
  v_funil := public.rodizio_funil(p_tenant);
  IF v_funil IS NULL THEN RETURN NULL; END IF;
  -- Decisão do dono (09/09): todas as etapas do funil do rodízio.
  IF v_todas THEN
    SELECT array_agg(s.id ORDER BY s.position) INTO v_ids FROM public.crm_stages s WHERE s.pipeline_id = v_funil;
    RETURN v_ids;
  END IF;
  IF v_cfg IS NOT NULL AND array_length(v_cfg, 1) > 0 THEN RETURN v_cfg; END IF;
  SELECT min(s.position) INTO v_corte FROM public.crm_stages s
   WHERE s.pipeline_id = v_funil
     AND (COALESCE(s.is_won, false) OR COALESCE(s.is_lost, false) OR lower(s.name) LIKE '%agend%');
  SELECT array_agg(s.id ORDER BY s.position) INTO v_ids FROM public.crm_stages s
   WHERE s.pipeline_id = v_funil
     AND NOT COALESCE(s.is_won, false) AND NOT COALESCE(s.is_lost, false)
     AND (v_corte IS NULL OR s.position < v_corte);
  RETURN v_ids;
END $fn$;

CREATE OR REPLACE FUNCTION public.rodizio_lead_na_fila(p_lead public.crm_leads, p_admin uuid, p_funil uuid, p_numero uuid, p_etapas uuid[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT (p_lead).id IS NOT NULL
     AND p_funil IS NOT NULL AND (p_lead).pipeline_id = p_funil
     AND p_etapas IS NOT NULL AND (p_lead).stage_id = ANY (p_etapas)
     AND NOT COALESCE((p_lead).is_blocked, false)
     AND (p_lead).conversa_fechada_em IS NULL
     AND (p_lead).distribuido_em IS NULL
     AND (p_lead).rodizio_reservado_para IS NULL
     AND ((p_lead).assigned_to IS NULL OR (p_admin IS NOT NULL AND (p_lead).assigned_to = p_admin))
     AND NOT public.rodizio_fonte_excluida((p_lead).source)
     AND (p_lead).ig_account_uuid IS NULL
     AND ((p_lead).whatsapp_number_id IS NULL OR (p_numero IS NOT NULL AND (p_lead).whatsapp_number_id = p_numero))
     -- Consulta marcada só segura o lead quando a entrada é restrita.
     AND (EXISTS (SELECT 1 FROM public.crm_rodizio_config c
                   WHERE c.tenant_id = (p_lead).tenant_id AND c.entrada_todas_etapas)
          OR NOT EXISTS (SELECT 1 FROM public.crm_appointments a
                          WHERE a.lead_id = (p_lead).id AND COALESCE(a.status, '') <> 'cancelled'));
$fn$;

-- ---------------------------------------------------------------- 2. reabrir ao enviar
CREATE OR REPLACE FUNCTION public.conversa_reabre_ao_enviar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_fechada timestamptz; v_tenant uuid;
BEGIN
  IF NEW.lead_id IS NULL OR NEW.direction <> 'outbound' THEN RETURN NEW; END IF;
  BEGIN
    IF NOT public.rodizio_msg_humana(NEW) THEN RETURN NEW; END IF;
    SELECT l.conversa_fechada_em, l.tenant_id INTO v_fechada, v_tenant
      FROM public.crm_leads l WHERE l.id = NEW.lead_id;
    IF v_fechada IS NULL THEN RETURN NEW; END IF;
    -- A pesquisa de satisfação sai logo depois do fechamento: não é reabertura.
    IF EXISTS (SELECT 1 FROM public.crm_pesquisa_respostas r
                WHERE r.lead_id = NEW.lead_id AND r.respondida_em IS NULL
                  AND r.enviada_em >= now() - interval '5 minutes') THEN
      RETURN NEW;
    END IF;
    UPDATE public.crm_leads SET conversa_fechada_em = NULL, conversa_fechada_por = NULL
     WHERE id = NEW.lead_id AND conversa_fechada_em IS NOT NULL;
    INSERT INTO public.messages (lead_id, tenant_id, direction, type, content, status)
    VALUES (NEW.lead_id, v_tenant, 'outbound', 'system', '🔓 Conversa reaberta: a equipe enviou uma mensagem', 'system');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'conversa_reabre_ao_enviar: % (lead %)', SQLERRM, NEW.lead_id;
  END;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_zz_conversa_reabre_ao_enviar ON public.messages;
CREATE TRIGGER trg_zz_conversa_reabre_ao_enviar
  AFTER INSERT ON public.messages
  FOR EACH ROW WHEN (NEW.direction = 'outbound' AND NEW.type IS DISTINCT FROM 'system')
  EXECUTE FUNCTION public.conversa_reabre_ao_enviar();
