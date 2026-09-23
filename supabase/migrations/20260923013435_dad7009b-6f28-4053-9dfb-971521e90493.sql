-- lovable-cron-fallback-reviewed: 1440 runs/day; fila de eventos da API de Conversões da Meta precisa de latência de 1 minuto (arquivo do repositório, aplicado sem alterações)
-- ============================================================================
-- API DE CONVERSÕES DA META — o CRM devolve à Meta o que acontece com o lead
--
-- Pedido do dono em 22/09/2026 ("Já construa os itens 1 e 2"):
--   1. guardar o ctwa_clid — o identificador do clique no anúncio de
--      clique-para-WhatsApp — que o webhook recebe no objeto referral e
--      descartava (só guardava headline/body/imagem/link/ad_id);
--   2. enviar à Meta, por cliente (tenant), os eventos do funil para a Meta
--      otimizar as campanhas de WhatsApp por agendamento/contrato, e não só por
--      "conversa iniciada":
--        • LeadSubmitted   — lead novo vindo de anúncio (tem ctwa_clid)
--        • QualifiedLead   — AGENDOU (consulta confirmada em crm_appointments)
--        • InitiateCheckout — COMPARECEU (consulta saiu de confirmada para
--                            not_contracted/contracted)
--        • Purchase        — PAGOU (linha em pagamentos), com valor
--      Os nomes são os que a Meta aceita para mensagens de negócio
--      (action_source business_messaging); Schedule/Contact não existem lá.
--
-- Como funciona:
--   • Gatilhos enfileiram em meta_capi_events (outbox: UMA linha por lead × evento,
--     event_id = '<lead_id>:<evento>', então remarcação/pagamento em parcelas
--     não repetem evento). Todo gatilho engole erro: receita, consulta e lead
--     nunca falham por causa da Meta.
--   • A edge function meta-capi-worker (cron de minuto em minuto, x-cron-secret)
--     pega a fila (meta_capi_claim, SKIP LOCKED), monta a carga e faz POST em
--     graph.facebook.com/<versão>/<dataset>/events. Lead com ctwa_clid vai como
--     business_messaging (WhatsApp); lead sem ctwa_clid (site, Google, Instagram)
--     vai como evento de CRM (system_generated) casado por telefone em hash.
--   • Credenciais (conjunto de dados + token) ficam em meta_capi_config, tabela
--     que o app NÃO lê: só service_role. A tela usa RPCs que nunca devolvem o
--     token (meta_capi_config_ler devolve só "tem_token").
--   • NASCE DESLIGADO: nada é enfileirado para tenant sem meta_capi_config.enabled.
--
-- Idempotente: o agente do Lovable grava uma cópia desta migration com carimbo
-- próprio e o original pode rodar de novo.
-- ============================================================================

-- ======================================================= 1. colunas novas
ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS ctwa_clid text;
ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS ctwa_clid_at timestamptz;
COMMENT ON COLUMN public.crm_leads.ctwa_clid IS
  'Identificador do clique no anúncio de clique-para-WhatsApp (referral.ctwa_clid do webhook). Último clique vence.';
COMMENT ON COLUMN public.crm_leads.ctwa_clid_at IS 'Quando chegou a mensagem que trouxe o ctwa_clid.';

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS ctwa_clid text;
COMMENT ON COLUMN public.messages.ctwa_clid IS 'ctwa_clid do referral desta mensagem (só na primeira mensagem vinda do anúncio).';

-- ================================================ 2. configuração por tenant
CREATE TABLE IF NOT EXISTS public.meta_capi_config (
  tenant_id        uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  enabled          boolean NOT NULL DEFAULT false,
  dataset_id       text,
  access_token     text,
  waba_id          text,
  test_event_code  text,
  send_crm_events  boolean NOT NULL DEFAULT true,
  send_lead_event  boolean NOT NULL DEFAULT true,
  partner_agent    text NOT NULL DEFAULT 'crclin',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.meta_capi_config IS
  'API de Conversões da Meta por tenant. Só service_role lê (token). A tela usa as RPCs meta_capi_config_ler/salvar.';
COMMENT ON COLUMN public.meta_capi_config.waba_id IS
  'Conta do WhatsApp Business do número principal (o dos anúncios). Vazio = usa integrations.whatsapp_config.waba_id ou a env WABA_ID.';
COMMENT ON COLUMN public.meta_capi_config.test_event_code IS
  'Enquanto preenchido, TODO envio vai para a aba Eventos de teste do Gerenciador de Eventos (não entra nos dados reais).';
COMMENT ON COLUMN public.meta_capi_config.send_crm_events IS
  'Lead SEM ctwa_clid (site, Google, Instagram): manda QualifiedLead/InitiateCheckout/Purchase como evento de CRM casado por telefone em hash.';
COMMENT ON COLUMN public.meta_capi_config.send_lead_event IS 'Manda LeadSubmitted quando entra lead de anúncio (com ctwa_clid).';

ALTER TABLE public.meta_capi_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_capi_config FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.meta_capi_config TO service_role;

-- ============================================================= 3. a fila
CREATE TABLE IF NOT EXISTS public.meta_capi_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  lead_id          uuid NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  event_name       text NOT NULL,
  event_id         text NOT NULL,
  event_time       timestamptz NOT NULL DEFAULT now(),
  origem           text,
  value            numeric,
  currency         text NOT NULL DEFAULT 'BRL',
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'skipped')),
  modo             text,
  attempts         integer NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  last_error       text,
  response         jsonb,
  sent_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, event_id)
);
COMMENT ON TABLE public.meta_capi_events IS
  'Outbox da API de Conversões da Meta: uma linha por lead × evento; o worker meta-capi-worker envia e registra a resposta.';
CREATE INDEX IF NOT EXISTS idx_meta_capi_events_fila
  ON public.meta_capi_events (next_attempt_at) WHERE status IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS idx_meta_capi_events_tenant_created
  ON public.meta_capi_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_meta_capi_events_lead ON public.meta_capi_events (lead_id);

ALTER TABLE public.meta_capi_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_capi_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.meta_capi_events TO service_role;

CREATE OR REPLACE FUNCTION public.meta_capi_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_meta_capi_config_updated_at ON public.meta_capi_config;
CREATE TRIGGER trg_meta_capi_config_updated_at
BEFORE UPDATE ON public.meta_capi_config
FOR EACH ROW EXECUTE FUNCTION public.meta_capi_touch_updated_at();

DROP TRIGGER IF EXISTS trg_meta_capi_events_updated_at ON public.meta_capi_events;
CREATE TRIGGER trg_meta_capi_events_updated_at
BEFORE UPDATE ON public.meta_capi_events
FOR EACH ROW EXECUTE FUNCTION public.meta_capi_touch_updated_at();

-- ====================================================== 4. enfileirar
-- Uma linha por lead × evento. Devolve true só quando enfileirou de fato.
-- Nunca lança: quem chama é gatilho de negócio.
CREATE OR REPLACE FUNCTION public.meta_capi_enfileirar(
  p_tenant_id uuid, p_lead_id uuid, p_event_name text, p_origem text,
  p_value numeric DEFAULT NULL, p_event_time timestamptz DEFAULT now())
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_tenant_id IS NULL OR p_lead_id IS NULL OR p_event_name IS NULL THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.meta_capi_config c WHERE c.tenant_id = p_tenant_id AND c.enabled) THEN
    RETURN false;
  END IF;
  INSERT INTO public.meta_capi_events (tenant_id, lead_id, event_name, event_id, event_time, origem, value)
  VALUES (p_tenant_id, p_lead_id, p_event_name, p_lead_id::text || ':' || p_event_name,
          COALESCE(p_event_time, now()), p_origem, p_value)
  ON CONFLICT (tenant_id, event_id) DO NOTHING;
  RETURN FOUND;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'meta_capi_enfileirar: % (lead %, evento %)', SQLERRM, p_lead_id, p_event_name;
  RETURN false;
END $function$;

-- ================================================ 5. gatilhos de negócio

-- (a) LeadSubmitted: lead ganhou ctwa_clid (nasceu de anúncio ou voltou por um
--     clique novo). O webhook grava o ctwa_clid junto do insert/update do lead.
CREATE OR REPLACE FUNCTION public.meta_capi_lead_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.ctwa_clid IS NULL OR NEW.ctwa_clid = '' OR NEW.tenant_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.ctwa_clid IS NOT DISTINCT FROM NEW.ctwa_clid THEN RETURN NEW; END IF;
  BEGIN
    IF EXISTS (SELECT 1 FROM public.meta_capi_config c
                WHERE c.tenant_id = NEW.tenant_id AND c.enabled AND c.send_lead_event) THEN
      PERFORM public.meta_capi_enfileirar(NEW.tenant_id, NEW.id, 'LeadSubmitted', 'lead_anuncio',
                                          NULL, COALESCE(NEW.ctwa_clid_at, now()));
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'meta_capi_lead_trigger: % (lead %)', SQLERRM, NEW.id;
  END;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_zz_meta_capi_lead ON public.crm_leads;
CREATE TRIGGER trg_zz_meta_capi_lead
AFTER INSERT OR UPDATE OF ctwa_clid ON public.crm_leads
FOR EACH ROW EXECUTE FUNCTION public.meta_capi_lead_trigger();

-- (b) QualifiedLead (agendou) e InitiateCheckout (compareceu) — a partir de
--     crm_appointments.status, que é a fonte canônica (não a etapa, que é nome
--     e pode ser revertida à mão). Cobre a tela, a barra de confirmação, o
--     admin-api e a remarcação. Compareceu = saiu de confirmada/pendente (ou de
--     uma falta corrigida pela SDR) para not_contracted/contracted — a mesma
--     régua de sdr_comparecimento_entrega. not_contracted → contracted (promoção
--     por pagamento) NÃO é comparecimento novo e não dispara nada aqui.
CREATE OR REPLACE FUNCTION public.meta_capi_appointment_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.lead_id IS NULL OR NEW.tenant_id IS NULL THEN RETURN NEW; END IF;
  BEGIN
    IF (TG_OP = 'INSERT' AND NEW.status = 'confirmed')
       OR (TG_OP = 'UPDATE' AND OLD.status = 'pending' AND NEW.status = 'confirmed') THEN
      PERFORM public.meta_capi_enfileirar(NEW.tenant_id, NEW.lead_id, 'QualifiedLead',
                                          'agendamento', NULL, now());
    END IF;
    IF TG_OP = 'UPDATE'
       AND OLD.status IN ('confirmed', 'pending', 'no_show')
       AND NEW.status IN ('not_contracted', 'contracted') THEN
      PERFORM public.meta_capi_enfileirar(NEW.tenant_id, NEW.lead_id, 'InitiateCheckout',
                                          'consulta:' || NEW.status, NULL, now());
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'meta_capi_appointment_trigger: % (consulta %)', SQLERRM, NEW.id;
  END;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_zz_meta_capi_appointment ON public.crm_appointments;
CREATE TRIGGER trg_zz_meta_capi_appointment
AFTER INSERT OR UPDATE OF status ON public.crm_appointments
FOR EACH ROW EXECUTE FUNCTION public.meta_capi_appointment_trigger();

-- (c) Purchase: pagamento que significa CONTRATO (mesma régua de
--     lead_tem_pagamento_de_contrato: titular do vínculo, sem orto em
--     manutenção, sem "não marketing", clínica do mesmo tenant). O valor é a
--     soma do que o paciente pagou nos últimos 90 dias (parcelas do mesmo
--     contrato entram numa linha só, porque o evento é um por lead).
--     Pagamento com data de mais de 7 dias é histórico (importação/backfill do
--     Dontus) e não vira evento — a Meta recusa evento com mais de 7 dias.
--     Nome trg_zzz_* para rodar DEPOIS de trg_auto_link_paciente_to_lead e de
--     trg_zz_contratado_apos_pagamento (ordem alfabética dos gatilhos).
CREATE OR REPLACE FUNCTION public.meta_capi_valor_contrato(p_paciente_id uuid, p_tenant_id uuid, p_ref date)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(p.valor), 0)
    FROM public.pagamentos p
    JOIN public.clinicas c ON c.id = p.clinica_id AND c.tenant_id = p_tenant_id
   WHERE p.paciente_id = p_paciente_id
     AND p.recorrencia_orto IS NOT TRUE
     AND p.nao_marketing IS NOT TRUE
     AND p.data_pagamento >= p_ref - 90
     AND p.data_pagamento <= p_ref + 3;
$function$;

CREATE OR REPLACE FUNCTION public.meta_capi_pagamento_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lead uuid;
  v_tenant uuid;
  v_valor numeric;
BEGIN
  IF NEW.recorrencia_orto IS TRUE OR NEW.nao_marketing IS TRUE THEN RETURN NEW; END IF;
  IF NEW.data_pagamento IS NULL OR NEW.data_pagamento < current_date - 7 THEN RETURN NEW; END IF;
  BEGIN
    SELECT l.id, l.tenant_id INTO v_lead, v_tenant
      FROM public.crm_lead_pacientes lp
      JOIN public.crm_leads l ON l.id = lp.lead_id
      JOIN public.clinicas c  ON c.id = NEW.clinica_id AND c.tenant_id = l.tenant_id
     WHERE lp.paciente_id = NEW.paciente_id
       AND lp.is_primary
     ORDER BY (l.ctwa_clid IS NOT NULL) DESC, l.created_at DESC
     LIMIT 1;
    IF v_lead IS NULL THEN RETURN NEW; END IF;
    v_valor := public.meta_capi_valor_contrato(NEW.paciente_id, v_tenant, NEW.data_pagamento);
    PERFORM public.meta_capi_enfileirar(v_tenant, v_lead, 'Purchase', 'pagamento', v_valor, now());
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'meta_capi_pagamento_trigger: % (pagamento %)', SQLERRM, NEW.id;
  END;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_zzz_meta_capi_pagamento ON public.pagamentos;
CREATE TRIGGER trg_zzz_meta_capi_pagamento
AFTER INSERT ON public.pagamentos
FOR EACH ROW EXECUTE FUNCTION public.meta_capi_pagamento_trigger();

-- (d) Vínculo lead↔paciente que nasce DEPOIS do pagamento (o Dontus importa o
--     pagamento sem telefone e o lead só é achado dias depois). Mesma cautela de
--     contratado_apos_vinculo: vínculo feito à mão só vale de gestão.
CREATE OR REPLACE FUNCTION public.meta_capi_vinculo_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_ref date;
  v_valor numeric;
BEGIN
  IF NOT COALESCE(NEW.is_primary, false) THEN RETURN NEW; END IF;
  IF auth.uid() IS NOT NULL
     AND NOT (public.has_role(auth.uid(), 'crc'::app_role)
              OR public.has_role(auth.uid(), 'gerente'::app_role)
              OR public.has_role(auth.uid(), 'superadmin'::app_role)) THEN
    RETURN NEW;
  END IF;
  BEGIN
    SELECT l.tenant_id INTO v_tenant FROM public.crm_leads l WHERE l.id = NEW.lead_id;
    IF v_tenant IS NULL THEN RETURN NEW; END IF;
    SELECT max(p.data_pagamento) INTO v_ref
      FROM public.pagamentos p
      JOIN public.clinicas c ON c.id = p.clinica_id AND c.tenant_id = v_tenant
     WHERE p.paciente_id = NEW.paciente_id
       AND p.recorrencia_orto IS NOT TRUE
       AND p.nao_marketing IS NOT TRUE
       AND p.data_pagamento >= current_date - 7;
    IF v_ref IS NULL THEN RETURN NEW; END IF;
    v_valor := public.meta_capi_valor_contrato(NEW.paciente_id, v_tenant, v_ref);
    PERFORM public.meta_capi_enfileirar(v_tenant, NEW.lead_id, 'Purchase', 'vinculo_com_pagamento', v_valor, now());
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'meta_capi_vinculo_trigger: % (lead %)', SQLERRM, NEW.lead_id;
  END;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_zzz_meta_capi_vinculo ON public.crm_lead_pacientes;
CREATE TRIGGER trg_zzz_meta_capi_vinculo
AFTER INSERT ON public.crm_lead_pacientes
FOR EACH ROW EXECUTE FUNCTION public.meta_capi_vinculo_trigger();

-- ===================================================== 6. fila do worker
-- Pega até p_limite eventos pendentes (SKIP LOCKED) e marca 'processing'.
-- Evento preso em 'processing' há mais de 10 min volta para 'pending'.
CREATE OR REPLACE FUNCTION public.meta_capi_claim(p_limite integer DEFAULT 50)
RETURNS SETOF public.meta_capi_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.meta_capi_events
     SET status = 'pending'
   WHERE status = 'processing' AND updated_at < now() - interval '10 minutes';

  RETURN QUERY
  WITH escolhidos AS (
    SELECT e.id
      FROM public.meta_capi_events e
     WHERE e.status = 'pending' AND e.next_attempt_at <= now()
     ORDER BY e.created_at
     LIMIT GREATEST(COALESCE(p_limite, 50), 1)
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.meta_capi_events e
     SET status = 'processing', updated_at = now()
    FROM escolhidos
   WHERE e.id = escolhidos.id
  RETURNING e.*;
END $function$;

-- ================================================== 7. RPCs da tela
-- Quem pode mexer: crc, gerente ou superadmin, sempre no próprio tenant.
CREATE OR REPLACE FUNCTION public.meta_capi_pode_gerir()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL
     AND public.current_tenant_id() IS NOT NULL
     AND (public.has_role(auth.uid(), 'crc'::app_role)
          OR public.has_role(auth.uid(), 'gerente'::app_role)
          OR public.has_role(auth.uid(), 'superadmin'::app_role));
$function$;

CREATE OR REPLACE FUNCTION public.meta_capi_config_ler()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  c public.meta_capi_config%ROWTYPE;
  v_waba_sugerido text;
  v_numeros jsonb;
BEGIN
  IF NOT public.meta_capi_pode_gerir() THEN
    RAISE EXCEPTION 'Sem permissão para a API de Conversões' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.meta_capi_config WHERE tenant_id = v_tenant;

  SELECT i.config->>'waba_id' INTO v_waba_sugerido
    FROM public.integrations i
   WHERE i.tenant_id = v_tenant AND i.key = 'whatsapp_config'
   LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'display_name', n.display_name, 'phone_e164', n.phone_e164,
           'waba_id', n.waba_id, 'is_default', n.is_default) ORDER BY n.is_default DESC, n.created_at), '[]'::jsonb)
    INTO v_numeros
    FROM public.whatsapp_numbers n
   WHERE n.tenant_id = v_tenant AND n.is_active;

  RETURN jsonb_build_object(
    'existe',          c.tenant_id IS NOT NULL,
    'enabled',         COALESCE(c.enabled, false),
    'dataset_id',      COALESCE(c.dataset_id, ''),
    'waba_id',         COALESCE(c.waba_id, ''),
    'test_event_code', COALESCE(c.test_event_code, ''),
    'send_crm_events', COALESCE(c.send_crm_events, true),
    'send_lead_event', COALESCE(c.send_lead_event, true),
    'tem_token',       c.access_token IS NOT NULL AND c.access_token <> '',
    'updated_at',      c.updated_at,
    'waba_sugerido',   COALESCE(v_waba_sugerido, ''),
    'numeros',         v_numeros
  );
END $function$;

-- p aceita: enabled, dataset_id, waba_id, test_event_code, send_crm_events,
-- send_lead_event e access_token. O token só muda quando vem preenchido;
-- '__limpar__' apaga. Nunca é devolvido.
CREATE OR REPLACE FUNCTION public.meta_capi_config_salvar(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_token text := NULLIF(btrim(COALESCE(p->>'access_token', '')), '');
BEGIN
  IF NOT public.meta_capi_pode_gerir() THEN
    RAISE EXCEPTION 'Sem permissão para a API de Conversões' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.meta_capi_config (tenant_id) VALUES (v_tenant)
  ON CONFLICT (tenant_id) DO NOTHING;

  UPDATE public.meta_capi_config SET
    enabled         = COALESCE((p->>'enabled')::boolean, enabled),
    dataset_id      = CASE WHEN p ? 'dataset_id'      THEN NULLIF(regexp_replace(COALESCE(p->>'dataset_id', ''), '\D', '', 'g'), '') ELSE dataset_id END,
    waba_id         = CASE WHEN p ? 'waba_id'         THEN NULLIF(regexp_replace(COALESCE(p->>'waba_id', ''), '\D', '', 'g'), '') ELSE waba_id END,
    test_event_code = CASE WHEN p ? 'test_event_code' THEN NULLIF(btrim(COALESCE(p->>'test_event_code', '')), '') ELSE test_event_code END,
    send_crm_events = COALESCE((p->>'send_crm_events')::boolean, send_crm_events),
    send_lead_event = COALESCE((p->>'send_lead_event')::boolean, send_lead_event),
    access_token    = CASE
                        WHEN v_token = '__limpar__' THEN NULL
                        WHEN v_token IS NOT NULL    THEN v_token
                        ELSE access_token
                      END
  WHERE tenant_id = v_tenant;

  RETURN public.meta_capi_config_ler();
END $function$;

CREATE OR REPLACE FUNCTION public.meta_capi_eventos_status(p_dias integer DEFAULT 7)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_desde timestamptz := now() - make_interval(days => GREATEST(COALESCE(p_dias, 7), 1));
  v_por_status jsonb;
  v_por_evento jsonb;
  v_ultimos jsonb;
  v_ultimo_envio timestamptz;
  v_ultimo_erro text;
BEGIN
  IF NOT public.meta_capi_pode_gerir() THEN
    RAISE EXCEPTION 'Sem permissão para a API de Conversões' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_object_agg(s.status, s.n), '{}'::jsonb) INTO v_por_status
    FROM (SELECT status, count(*) AS n FROM public.meta_capi_events
           WHERE tenant_id = v_tenant AND created_at >= v_desde GROUP BY status) s;

  SELECT COALESCE(jsonb_object_agg(s.event_name, s.n), '{}'::jsonb) INTO v_por_evento
    FROM (SELECT event_name, count(*) AS n FROM public.meta_capi_events
           WHERE tenant_id = v_tenant AND created_at >= v_desde AND status = 'sent' GROUP BY event_name) s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', e.id, 'event_name', e.event_name, 'status', e.status, 'modo', e.modo,
           'origem', e.origem, 'value', e.value, 'attempts', e.attempts,
           'last_error', e.last_error, 'created_at', e.created_at, 'sent_at', e.sent_at,
           'lead_id', e.lead_id, 'lead_nome', l.name,
           'com_ctwa', l.ctwa_clid IS NOT NULL) ORDER BY e.created_at DESC), '[]'::jsonb)
    INTO v_ultimos
    FROM (SELECT * FROM public.meta_capi_events
           WHERE tenant_id = v_tenant ORDER BY created_at DESC LIMIT 25) e
    LEFT JOIN public.crm_leads l ON l.id = e.lead_id;

  SELECT max(sent_at) INTO v_ultimo_envio FROM public.meta_capi_events WHERE tenant_id = v_tenant AND status = 'sent';
  SELECT last_error INTO v_ultimo_erro FROM public.meta_capi_events
   WHERE tenant_id = v_tenant AND last_error IS NOT NULL ORDER BY updated_at DESC LIMIT 1;

  RETURN jsonb_build_object(
    'dias', p_dias,
    'por_status', v_por_status,
    'enviados_por_evento', v_por_evento,
    'ultimos', v_ultimos,
    'ultimo_envio', v_ultimo_envio,
    'ultimo_erro', v_ultimo_erro,
    'leads_com_ctwa_7d', (SELECT count(*) FROM public.crm_leads
                           WHERE tenant_id = v_tenant AND ctwa_clid IS NOT NULL
                             AND ctwa_clid_at >= now() - interval '7 days')
  );
END $function$;

-- Reenviar um evento que falhou (ou que ficou 'skipped' por falta de configuração).
CREATE OR REPLACE FUNCTION public.meta_capi_reenviar(p_event_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.meta_capi_pode_gerir() THEN
    RAISE EXCEPTION 'Sem permissão para a API de Conversões' USING ERRCODE = '42501';
  END IF;
  UPDATE public.meta_capi_events
     SET status = 'pending', attempts = 0, next_attempt_at = now(), last_error = NULL, event_time = now()
   WHERE id = p_event_id AND tenant_id = public.current_tenant_id()
     AND status IN ('failed', 'skipped');
  RETURN FOUND;
END $function$;

-- ====================================================================== grants
-- Função nova em public nasce com EXECUTE para anon/authenticated (pg_default_acl).
REVOKE ALL ON FUNCTION public.meta_capi_touch_updated_at()                                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.meta_capi_enfileirar(uuid, uuid, text, text, numeric, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.meta_capi_lead_trigger()                                        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.meta_capi_appointment_trigger()                                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.meta_capi_valor_contrato(uuid, uuid, date)                      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.meta_capi_pagamento_trigger()                                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.meta_capi_vinculo_trigger()                                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.meta_capi_claim(integer)                                        FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meta_capi_claim(integer) TO service_role;

REVOKE ALL ON FUNCTION public.meta_capi_pode_gerir()                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.meta_capi_config_ler()                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.meta_capi_config_salvar(jsonb)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.meta_capi_eventos_status(integer)      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.meta_capi_reenviar(uuid)               FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meta_capi_pode_gerir()              TO authenticated;
GRANT EXECUTE ON FUNCTION public.meta_capi_config_ler()              TO authenticated;
GRANT EXECUTE ON FUNCTION public.meta_capi_config_salvar(jsonb)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.meta_capi_eventos_status(integer)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.meta_capi_reenviar(uuid)            TO authenticated;

-- ======================================================================= crons
-- Mesmo formato do fechar-agendado-pesquisa: o segredo sai de _internal_secrets
-- na hora da chamada e nunca aparece no texto do job.
SELECT cron.unschedule('meta-capi-worker')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'meta-capi-worker');

SELECT cron.schedule(
  'meta-capi-worker',
  '* * * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://oybroifaleftwrhnlhqc.supabase.co/functions/v1/meta-capi-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT value FROM public._internal_secrets WHERE name = 'automation_cron_token')
    ),
    body    := '{"source":"cron","action":"processar"}'::jsonb,
    timeout_milliseconds := 55000
  );
  $cron$
);

-- Limpeza: evento terminado há mais de 90 dias sai da fila (a Meta já tem o dado).
SELECT cron.unschedule('meta-capi-limpeza')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'meta-capi-limpeza');
SELECT cron.schedule(
  'meta-capi-limpeza',
  '35 4 * * *',
  $$DELETE FROM public.meta_capi_events WHERE status IN ('sent', 'failed', 'skipped') AND created_at < now() - interval '90 days';$$
);
