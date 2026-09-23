-- ============================================================================
-- API DE CONVERSÕES DA META — event_source_url em todo evento
--
-- Achado em 23/09/2026, na aba Diagnóstico do conjunto de dados do site
-- (1544399400393116, categoria "Saúde e bem-estar", análise rejeitada):
--   "Os eventos enviados pela API de Conversões sem o parâmetro
--    event_source_url estão bloqueados porque sua empresa envia dados de
--    sites em categorias com restrições."
-- A regra é da EMPRESA, não só daquele conjunto: qualquer conjunto da Rizodent
-- pode passar a bloquear evento de CRM sem URL. Por isso o worker passa a
-- mandar event_source_url em todo evento, com o site do cliente configurado
-- aqui (meta_capi_config.event_source_url). Vazio = não manda o parâmetro.
--
-- Idempotente (o Lovable grava uma cópia com carimbo próprio).
-- ============================================================================

ALTER TABLE public.meta_capi_config ADD COLUMN IF NOT EXISTS event_source_url text;
COMMENT ON COLUMN public.meta_capi_config.event_source_url IS
  'URL do site do cliente enviada como event_source_url em todo evento (a Meta bloqueia evento sem URL em conjuntos de categoria restrita).';

-- Rizodent: o site é rizodent.com.br. Só preenche se estiver vazio.
UPDATE public.meta_capi_config
   SET event_source_url = 'https://rizodent.com.br/'
 WHERE tenant_id = '00000000-0000-0000-0000-000000000010'
   AND (event_source_url IS NULL OR event_source_url = '');

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
    'existe',           c.tenant_id IS NOT NULL,
    'enabled',          COALESCE(c.enabled, false),
    'dataset_id',       COALESCE(c.dataset_id, ''),
    'waba_id',          COALESCE(c.waba_id, ''),
    'test_event_code',  COALESCE(c.test_event_code, ''),
    'event_source_url', COALESCE(c.event_source_url, ''),
    'send_crm_events',  COALESCE(c.send_crm_events, true),
    'send_lead_event',  COALESCE(c.send_lead_event, true),
    'tem_token',        c.access_token IS NOT NULL AND c.access_token <> '',
    'updated_at',       c.updated_at,
    'waba_sugerido',    COALESCE(v_waba_sugerido, ''),
    'numeros',          v_numeros
  );
END $function$;

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
    enabled          = COALESCE((p->>'enabled')::boolean, enabled),
    dataset_id       = CASE WHEN p ? 'dataset_id'       THEN NULLIF(regexp_replace(COALESCE(p->>'dataset_id', ''), '\D', '', 'g'), '') ELSE dataset_id END,
    waba_id          = CASE WHEN p ? 'waba_id'          THEN NULLIF(regexp_replace(COALESCE(p->>'waba_id', ''), '\D', '', 'g'), '') ELSE waba_id END,
    test_event_code  = CASE WHEN p ? 'test_event_code'  THEN NULLIF(btrim(COALESCE(p->>'test_event_code', '')), '') ELSE test_event_code END,
    event_source_url = CASE WHEN p ? 'event_source_url' THEN NULLIF(btrim(COALESCE(p->>'event_source_url', '')), '') ELSE event_source_url END,
    send_crm_events  = COALESCE((p->>'send_crm_events')::boolean, send_crm_events),
    send_lead_event  = COALESCE((p->>'send_lead_event')::boolean, send_lead_event),
    access_token     = CASE
                         WHEN v_token = '__limpar__' THEN NULL
                         WHEN v_token IS NOT NULL    THEN v_token
                         ELSE access_token
                       END
  WHERE tenant_id = v_tenant;

  RETURN public.meta_capi_config_ler();
END $function$;

-- VERIFICAÇÃO:
-- SELECT tenant_id, dataset_id, event_source_url FROM public.meta_capi_config;
