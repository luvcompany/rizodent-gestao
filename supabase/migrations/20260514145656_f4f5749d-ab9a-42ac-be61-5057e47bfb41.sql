
-- ============================================================
-- BLINDAGEM MULTI-CLIENTE: garantir isolamento estrito por tenant
-- ============================================================

-- 1) Remover defaults perigosos que silenciosamente atribuem
--    qualquer dado novo ao tenant Rizodent quando o cliente
--    não é informado. Mantém a coluna nullable por compatibilidade,
--    mas agora um INSERT sem tenant_id falhará nos triggers/RLS
--    em vez de cair na Rizodent.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'crm_leads','messages','crm_tasks','crm_appointments',
    'crm_conversation_notes','crm_pipelines','crm_stages',
    'crm_whatsapp_templates','crm_quick_replies','crm_broadcasts',
    'crm_followup_configs','crm_automations','crm_custom_fields',
    'integrations','funnel_channels','instagram_accounts',
    'ad_id_mapping','bots','clinicas','pacientes','tipos_procedimento',
    'ai_assistant_config','dashboard_holidays','tenant_invoices',
    'tenant_subscriptions','tenant_usage','access_logs'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name=t AND column_name='tenant_id'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN tenant_id DROP DEFAULT', t);
    END IF;
  END LOOP;
END $$;

-- 2) Reforçar trigger em messages: SEMPRE herdar tenant do lead
--    e BLOQUEAR mensagem cujo tenant divergir do lead.
CREATE OR REPLACE FUNCTION public.enforce_message_tenant_matches_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead_tenant uuid;
BEGIN
  IF NEW.lead_id IS NULL THEN
    RAISE EXCEPTION 'messages.lead_id é obrigatório para isolamento por cliente';
  END IF;

  SELECT tenant_id INTO v_lead_tenant FROM public.crm_leads WHERE id = NEW.lead_id;
  IF v_lead_tenant IS NULL THEN
    RAISE EXCEPTION 'Lead % não possui tenant_id; mensagem rejeitada', NEW.lead_id;
  END IF;

  -- Se vier sem tenant, herda do lead
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := v_lead_tenant;
  ELSIF NEW.tenant_id <> v_lead_tenant THEN
    RAISE EXCEPTION 'Tentativa de gravar mensagem do lead % (tenant %) com tenant_id divergente %',
      NEW.lead_id, v_lead_tenant, NEW.tenant_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_message_tenant_from_lead ON public.messages;
DROP TRIGGER IF EXISTS trg_enforce_message_tenant ON public.messages;
CREATE TRIGGER trg_enforce_message_tenant
BEFORE INSERT OR UPDATE OF tenant_id, lead_id ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.enforce_message_tenant_matches_lead();

-- 3) Trigger em crm_leads: garantir consistência com pipeline/stage.
CREATE OR REPLACE FUNCTION public.enforce_lead_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pipeline_tenant uuid;
  v_stage_tenant uuid;
  v_stage_pipeline uuid;
BEGIN
  IF NEW.pipeline_id IS NOT NULL THEN
    SELECT tenant_id INTO v_pipeline_tenant FROM public.crm_pipelines WHERE id = NEW.pipeline_id;
  END IF;
  IF NEW.stage_id IS NOT NULL THEN
    SELECT tenant_id, pipeline_id INTO v_stage_tenant, v_stage_pipeline FROM public.crm_stages WHERE id = NEW.stage_id;
  END IF;

  -- Se o lead veio sem tenant, deduz do pipeline ou stage (NUNCA assume Rizodent).
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := COALESCE(v_pipeline_tenant, v_stage_tenant);
  END IF;

  IF NEW.tenant_id IS NULL THEN
    RAISE EXCEPTION 'crm_leads.tenant_id é obrigatório (sem pipeline/stage para deduzir)';
  END IF;

  IF v_pipeline_tenant IS NOT NULL AND v_pipeline_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'Pipeline % pertence ao tenant %, mas lead foi atribuído ao tenant %',
      NEW.pipeline_id, v_pipeline_tenant, NEW.tenant_id;
  END IF;
  IF v_stage_tenant IS NOT NULL AND v_stage_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'Stage % pertence ao tenant %, mas lead foi atribuído ao tenant %',
      NEW.stage_id, v_stage_tenant, NEW.tenant_id;
  END IF;
  IF v_stage_pipeline IS NOT NULL AND NEW.pipeline_id IS NOT NULL AND v_stage_pipeline <> NEW.pipeline_id THEN
    RAISE EXCEPTION 'Stage % pertence ao pipeline %, mas lead aponta para pipeline %',
      NEW.stage_id, v_stage_pipeline, NEW.pipeline_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_lead_tenant ON public.crm_leads;
CREATE TRIGGER trg_enforce_lead_tenant
BEFORE INSERT OR UPDATE OF tenant_id, pipeline_id, stage_id ON public.crm_leads
FOR EACH ROW EXECUTE FUNCTION public.enforce_lead_tenant_consistency();

-- 4) Adicionar tenant_id em instagram_messages (faltando) e
--    triggar herança a partir do lead ou da conta IG.
ALTER TABLE public.instagram_messages
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);

CREATE INDEX IF NOT EXISTS idx_instagram_messages_tenant
  ON public.instagram_messages(tenant_id);

CREATE OR REPLACE FUNCTION public.enforce_ig_message_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead_tenant uuid;
  v_acc_tenant uuid;
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    SELECT tenant_id INTO v_lead_tenant FROM public.crm_leads WHERE id = NEW.lead_id;
  END IF;
  IF NEW.instagram_account_id IS NOT NULL THEN
    SELECT tenant_id INTO v_acc_tenant FROM public.ig_accounts
     WHERE ig_user_id = NEW.instagram_account_id LIMIT 1;
    IF v_acc_tenant IS NULL THEN
      SELECT tenant_id INTO v_acc_tenant FROM public.instagram_accounts
       WHERE instagram_account_id = NEW.instagram_account_id LIMIT 1;
    END IF;
  END IF;

  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := COALESCE(v_lead_tenant, v_acc_tenant);
  END IF;

  IF v_lead_tenant IS NOT NULL AND NEW.tenant_id IS DISTINCT FROM v_lead_tenant THEN
    RAISE EXCEPTION 'instagram_messages.tenant_id (%) diverge do tenant do lead (%)',
      NEW.tenant_id, v_lead_tenant;
  END IF;
  IF v_acc_tenant IS NOT NULL AND NEW.tenant_id IS DISTINCT FROM v_acc_tenant THEN
    RAISE EXCEPTION 'instagram_messages.tenant_id (%) diverge do tenant da conta IG (%)',
      NEW.tenant_id, v_acc_tenant;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_ig_message_tenant ON public.instagram_messages;
CREATE TRIGGER trg_enforce_ig_message_tenant
BEFORE INSERT OR UPDATE OF tenant_id, lead_id, instagram_account_id ON public.instagram_messages
FOR EACH ROW EXECUTE FUNCTION public.enforce_ig_message_tenant();

-- Backfill: preencher tenant_id existente
UPDATE public.instagram_messages im
   SET tenant_id = COALESCE(
     (SELECT tenant_id FROM public.crm_leads WHERE id = im.lead_id),
     (SELECT tenant_id FROM public.ig_accounts WHERE ig_user_id = im.instagram_account_id LIMIT 1),
     (SELECT tenant_id FROM public.instagram_accounts WHERE instagram_account_id = im.instagram_account_id LIMIT 1)
   )
 WHERE im.tenant_id IS NULL;

-- 5) RLS reforçada em instagram_messages: trocar policy permissiva
--    "auth.uid() IS NOT NULL" por isolamento por tenant.
DROP POLICY IF EXISTS "Authenticated can view instagram_messages" ON public.instagram_messages;
DROP POLICY IF EXISTS "Authenticated can insert instagram_messages" ON public.instagram_messages;
DROP POLICY IF EXISTS "Authenticated can update instagram_messages" ON public.instagram_messages;
DROP POLICY IF EXISTS "Authenticated can delete instagram_messages" ON public.instagram_messages;

CREATE POLICY "tenant view instagram_messages" ON public.instagram_messages
FOR SELECT TO authenticated
USING (tenant_id = current_tenant_id() OR has_role(auth.uid(),'superadmin'));
CREATE POLICY "tenant insert instagram_messages" ON public.instagram_messages
FOR INSERT TO authenticated
WITH CHECK (tenant_id = current_tenant_id() OR has_role(auth.uid(),'superadmin'));
CREATE POLICY "tenant update instagram_messages" ON public.instagram_messages
FOR UPDATE TO authenticated
USING (tenant_id = current_tenant_id() OR has_role(auth.uid(),'superadmin'))
WITH CHECK (tenant_id = current_tenant_id() OR has_role(auth.uid(),'superadmin'));
CREATE POLICY "tenant delete instagram_messages" ON public.instagram_messages
FOR DELETE TO authenticated
USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'gerente') OR has_role(auth.uid(),'superadmin'));

-- 6) RLS reforçada em instagram_accounts (remover permissivas amplas)
DROP POLICY IF EXISTS "Authenticated can insert instagram_accounts" ON public.instagram_accounts;
DROP POLICY IF EXISTS "Authenticated can update instagram_accounts" ON public.instagram_accounts;
DROP POLICY IF EXISTS "Authenticated can delete instagram_accounts" ON public.instagram_accounts;

-- 7) Helpers para uso pelas Edge Functions
CREATE OR REPLACE FUNCTION public.tenant_of_lead(_lead_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT tenant_id FROM public.crm_leads WHERE id = _lead_id;
$$;

CREATE OR REPLACE FUNCTION public.tenant_of_message(_message_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT tenant_id FROM public.messages WHERE id = _message_id;
$$;
