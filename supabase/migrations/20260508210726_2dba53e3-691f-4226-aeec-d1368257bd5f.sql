-- ============================================
-- White-label multi-tenant base (sem ALTER TYPE)
-- ============================================

-- 2) Tenants
CREATE TABLE IF NOT EXISTS public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  logo_url text,
  primary_color text NOT NULL DEFAULT '#f97316',
  status text NOT NULL DEFAULT 'active',
  trial_ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  monthly_price numeric NOT NULL DEFAULT 0,
  user_limit int NOT NULL DEFAULT 1,
  lead_limit int NOT NULL DEFAULT 1000,
  message_limit int NOT NULL DEFAULT 5000,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.tenant_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan_id uuid REFERENCES public.plans(id),
  status text NOT NULL DEFAULT 'active',
  started_at timestamptz NOT NULL DEFAULT now(),
  next_billing_at timestamptz,
  amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tenant_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.tenant_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  month date NOT NULL,
  leads_created int NOT NULL DEFAULT 0,
  messages_sent int NOT NULL DEFAULT 0,
  active_users int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, month)
);
ALTER TABLE public.tenant_usage ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.tenant_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  reference_month date NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open',
  paid_at timestamptz,
  receipt_url text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tenant_invoices ENABLE ROW LEVEL SECURITY;

INSERT INTO storage.buckets (id, name, public)
VALUES ('tenant-logos', 'tenant-logos', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.plans (id, name, monthly_price, user_limit, lead_limit, message_limit, features)
VALUES ('00000000-0000-0000-0000-000000000001'::uuid, 'Pro', 497, 20, 50000, 100000,
  '{"whatsapp":true,"bots":true,"reports":true,"automations":true,"instagram":true}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tenants (id, slug, name, primary_color, status)
VALUES ('00000000-0000-0000-0000-000000000010'::uuid, 'rizodent', 'Rizodent', '#f97316', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tenant_subscriptions (tenant_id, plan_id, status, amount)
SELECT '00000000-0000-0000-0000-000000000010'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, 'active', 497
WHERE NOT EXISTS (SELECT 1 FROM public.tenant_subscriptions WHERE tenant_id = '00000000-0000-0000-0000-000000000010'::uuid);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id),
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

UPDATE public.profiles SET tenant_id = '00000000-0000-0000-0000-000000000010'::uuid WHERE tenant_id IS NULL;

CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
$$;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'crm_pipelines','crm_stages','crm_leads','crm_tasks','crm_appointments',
    'pacientes','clinicas','bots','crm_whatsapp_templates','crm_quick_replies',
    'crm_followup_configs','crm_automations','crm_custom_fields','crm_broadcasts',
    'dashboard_holidays','ai_assistant_config','funnel_channels','ad_id_mapping',
    'crm_conversation_notes','user_roles','messages'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    BEGIN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) DEFAULT ''00000000-0000-0000-0000-000000000010''::uuid', t);
      EXECUTE format('UPDATE public.%I SET tenant_id = ''00000000-0000-0000-0000-000000000010''::uuid WHERE tenant_id IS NULL', t);
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_tenant ON public.%I(tenant_id)', t, t);
    EXCEPTION WHEN undefined_table THEN
      RAISE NOTICE 'Table % not found, skipping', t;
    END;
  END LOOP;
END $$;

CREATE POLICY "superadmin_manage_tenants" ON public.tenants FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'superadmin')) WITH CHECK (has_role(auth.uid(), 'superadmin'));
CREATE POLICY "users_view_own_tenant" ON public.tenants FOR SELECT TO authenticated
  USING (id = current_tenant_id());
CREATE POLICY "public_view_tenants" ON public.tenants FOR SELECT TO anon USING (true);

CREATE POLICY "auth_view_plans" ON public.plans FOR SELECT TO authenticated USING (true);
CREATE POLICY "superadmin_manage_plans" ON public.plans FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'superadmin')) WITH CHECK (has_role(auth.uid(), 'superadmin'));

CREATE POLICY "superadmin_manage_subs" ON public.tenant_subscriptions FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'superadmin')) WITH CHECK (has_role(auth.uid(), 'superadmin'));
CREATE POLICY "view_own_subs" ON public.tenant_subscriptions FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id());

CREATE POLICY "superadmin_manage_usage" ON public.tenant_usage FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'superadmin')) WITH CHECK (has_role(auth.uid(), 'superadmin'));
CREATE POLICY "view_own_usage" ON public.tenant_usage FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id());

CREATE POLICY "superadmin_manage_invoices" ON public.tenant_invoices FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'superadmin')) WITH CHECK (has_role(auth.uid(), 'superadmin'));
CREATE POLICY "view_own_invoices" ON public.tenant_invoices FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id());

CREATE POLICY "tenant_logos_public_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'tenant-logos');
CREATE POLICY "tenant_logos_superadmin_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'tenant-logos' AND has_role(auth.uid(), 'superadmin'));
CREATE POLICY "tenant_logos_superadmin_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'tenant-logos' AND has_role(auth.uid(), 'superadmin'));
CREATE POLICY "tenant_logos_superadmin_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'tenant-logos' AND has_role(auth.uid(), 'superadmin'));

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'crm_pipelines','crm_stages','crm_leads','crm_tasks','crm_appointments',
    'pacientes','clinicas','bots','crm_whatsapp_templates','crm_quick_replies',
    'crm_followup_configs','crm_automations','crm_custom_fields','crm_broadcasts',
    'dashboard_holidays','ai_assistant_config','funnel_channels','ad_id_mapping',
    'crm_conversation_notes','messages'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    BEGIN
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (tenant_id = current_tenant_id() OR has_role(auth.uid(), ''superadmin'')) WITH CHECK (tenant_id = current_tenant_id() OR has_role(auth.uid(), ''superadmin''))', t);
    EXCEPTION
      WHEN undefined_table THEN NULL;
      WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.set_tenant_id_default()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := COALESCE(current_tenant_id(), '00000000-0000-0000-0000-000000000010'::uuid);
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'crm_pipelines','crm_stages','crm_leads','crm_tasks','crm_appointments',
    'pacientes','clinicas','bots','crm_whatsapp_templates','crm_quick_replies',
    'crm_followup_configs','crm_automations','crm_custom_fields','crm_broadcasts',
    'dashboard_holidays','ai_assistant_config','funnel_channels','ad_id_mapping',
    'crm_conversation_notes','messages','user_roles'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    BEGIN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_set_tenant_id ON public.%I', t);
      EXECUTE format('CREATE TRIGGER trg_set_tenant_id BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_default()', t);
    EXCEPTION WHEN undefined_table THEN NULL;
    END;
  END LOOP;
END $$;

CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_tenant_subs_updated_at BEFORE UPDATE ON public.tenant_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid;
BEGIN
  v_tenant := COALESCE(
    (NEW.raw_user_meta_data->>'tenant_id')::uuid,
    '00000000-0000-0000-0000-000000000010'::uuid
  );
  INSERT INTO public.profiles (id, nome, email, tenant_id, must_change_password)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nome', NEW.email),
    NEW.email,
    v_tenant,
    COALESCE((NEW.raw_user_meta_data->>'must_change_password')::boolean, false)
  );
  RETURN NEW;
END;
$$;