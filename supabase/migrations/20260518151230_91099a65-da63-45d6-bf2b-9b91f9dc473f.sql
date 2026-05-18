-- Make admin/superadmin-owned items globally visible (baseline shared)
-- bots
DROP POLICY IF EXISTS "Bots visible by role" ON public.bots;
CREATE POLICY "Bots visible by role"
ON public.bots FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
  OR has_role(auth.uid(), 'superadmin'::app_role)
  OR owner_role IS NULL
  OR owner_role IN ('admin'::app_role, 'superadmin'::app_role)
  OR has_role(auth.uid(), owner_role)
);

-- crm_broadcasts
DROP POLICY IF EXISTS "Broadcasts visible by role" ON public.crm_broadcasts;
CREATE POLICY "Broadcasts visible by role"
ON public.crm_broadcasts FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
  OR has_role(auth.uid(), 'superadmin'::app_role)
  OR owner_role IS NULL
  OR owner_role IN ('admin'::app_role, 'superadmin'::app_role)
  OR has_role(auth.uid(), owner_role)
);

-- crm_quick_replies
DROP POLICY IF EXISTS "Quick replies visible by role" ON public.crm_quick_replies;
CREATE POLICY "Quick replies visible by role"
ON public.crm_quick_replies FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
  OR has_role(auth.uid(), 'superadmin'::app_role)
  OR owner_role IS NULL
  OR owner_role IN ('admin'::app_role, 'superadmin'::app_role)
  OR has_role(auth.uid(), owner_role)
);

-- crm_whatsapp_templates (only if owner_role exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='crm_whatsapp_templates' AND column_name='owner_role') THEN
    EXECUTE 'DROP POLICY IF EXISTS "Templates visible by role" ON public.crm_whatsapp_templates';
    EXECUTE $POL$
      CREATE POLICY "Templates visible by role"
      ON public.crm_whatsapp_templates FOR SELECT TO authenticated
      USING (
        has_role(auth.uid(), 'admin'::app_role)
        OR has_role(auth.uid(), 'gerente'::app_role)
        OR has_role(auth.uid(), 'superadmin'::app_role)
        OR owner_role IS NULL
        OR owner_role IN ('admin'::app_role, 'superadmin'::app_role)
        OR has_role(auth.uid(), owner_role)
      )
    $POL$;
  END IF;
END $$;

-- crm_tasks
DROP POLICY IF EXISTS "Tasks visible by role" ON public.crm_tasks;
CREATE POLICY "Tasks visible by role"
ON public.crm_tasks FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
  OR has_role(auth.uid(), 'superadmin'::app_role)
  OR owner_role IS NULL
  OR owner_role IN ('admin'::app_role, 'superadmin'::app_role)
  OR has_role(auth.uid(), owner_role)
  OR assigned_to = auth.uid()
);

-- crm_appointments
DROP POLICY IF EXISTS "Appointments visible by role" ON public.crm_appointments;
CREATE POLICY "Appointments visible by role"
ON public.crm_appointments FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
  OR has_role(auth.uid(), 'superadmin'::app_role)
  OR owner_role IS NULL
  OR owner_role IN ('admin'::app_role, 'superadmin'::app_role)
  OR has_role(auth.uid(), owner_role)
);