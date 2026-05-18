
-- =====================================================================
-- 1) Templates: owner tracking + role-based RLS
-- =====================================================================

ALTER TABLE public.crm_whatsapp_templates
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS owner_role public.app_role;

-- Helper: primary role of a user (admin/gerente/superadmin preferred,
-- otherwise crc/posvenda). NULL if user has no role.
CREATE OR REPLACE FUNCTION public.get_user_primary_role(_user_id uuid)
RETURNS public.app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles
   WHERE user_id = _user_id
   ORDER BY CASE role
     WHEN 'superadmin' THEN 1
     WHEN 'admin'      THEN 2
     WHEN 'gerente'    THEN 3
     WHEN 'posvenda'   THEN 4
     WHEN 'crc'        THEN 5
     ELSE 99
   END
   LIMIT 1
$$;

-- Drop old SELECT policy that allowed any authenticated user
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'crm_whatsapp_templates' AND cmd = 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.crm_whatsapp_templates', pol.policyname);
  END LOOP;
END $$;

-- New SELECT: tenant isolation + role scoping
CREATE POLICY "Templates visible by role"
ON public.crm_whatsapp_templates
FOR SELECT
TO authenticated
USING (
  tenant_id = current_tenant_id()
  AND (
    owner_role IS NULL
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'gerente'::app_role)
    OR has_role(auth.uid(), 'superadmin'::app_role)
    OR has_role(auth.uid(), owner_role)
  )
);

-- Allow the creator to also UPDATE / DELETE their own templates (in addition
-- to existing admin/gerente policies that we leave intact)
DROP POLICY IF EXISTS "Owners can update own templates" ON public.crm_whatsapp_templates;
CREATE POLICY "Owners can update own templates"
ON public.crm_whatsapp_templates
FOR UPDATE
TO authenticated
USING (created_by_user_id = auth.uid())
WITH CHECK (created_by_user_id = auth.uid());

DROP POLICY IF EXISTS "Owners can delete own templates" ON public.crm_whatsapp_templates;
CREATE POLICY "Owners can delete own templates"
ON public.crm_whatsapp_templates
FOR DELETE
TO authenticated
USING (created_by_user_id = auth.uid());

-- =====================================================================
-- 2) Cron job: auto transfer contracted leads to Pós-venda every weekday 10:00 UTC (07:00 BRT)
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  PERFORM cron.unschedule('auto-transfer-contracted-posvenda');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'auto-transfer-contracted-posvenda',
  '0 10 * * 1-5',
  $$
  SELECT net.http_post(
    url := 'https://oybroifaleftwrhnlhqc.supabase.co/functions/v1/auto-transfer-contracted-to-posvenda',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im95YnJvaWZhbGVmdHdyaG5saHFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyMzMzNzAsImV4cCI6MjA4ODgwOTM3MH0.taPn4xLjXxBH846R8sZ6APwoOptGkY-12pqKHCjboYs'
    ),
    body := jsonb_build_object('triggered_at', now())
  );
  $$
);
