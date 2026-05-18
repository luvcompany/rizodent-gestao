
-- Add owner_role to crm_tasks and crm_appointments for role-based visibility
ALTER TABLE public.crm_tasks ADD COLUMN IF NOT EXISTS owner_role public.app_role;
ALTER TABLE public.crm_appointments ADD COLUMN IF NOT EXISTS owner_role public.app_role;

-- Trigger function: set owner_role from creator's primary role (reuse if exists)
CREATE OR REPLACE FUNCTION public.set_owner_role_from_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role public.app_role;
BEGIN
  IF NEW.owner_role IS NULL AND auth.uid() IS NOT NULL THEN
    SELECT role INTO v_role
    FROM public.user_roles
    WHERE user_id = auth.uid()
    ORDER BY CASE role
      WHEN 'superadmin' THEN 1
      WHEN 'admin' THEN 2
      WHEN 'gerente' THEN 3
      WHEN 'posvenda' THEN 4
      WHEN 'crc' THEN 5
      ELSE 99
    END
    LIMIT 1;
    NEW.owner_role := v_role;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_owner_role_crm_tasks ON public.crm_tasks;
CREATE TRIGGER trg_set_owner_role_crm_tasks
BEFORE INSERT ON public.crm_tasks
FOR EACH ROW EXECUTE FUNCTION public.set_owner_role_from_user();

DROP TRIGGER IF EXISTS trg_set_owner_role_crm_appointments ON public.crm_appointments;
CREATE TRIGGER trg_set_owner_role_crm_appointments
BEFORE INSERT ON public.crm_appointments
FOR EACH ROW EXECUTE FUNCTION public.set_owner_role_from_user();

-- Replace permissive SELECT policies with role-aware ones
DROP POLICY IF EXISTS "Authenticated users can view crm_tasks" ON public.crm_tasks;
CREATE POLICY "Tasks visible by role"
ON public.crm_tasks
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
  OR has_role(auth.uid(), 'superadmin'::app_role)
  OR owner_role IS NULL
  OR has_role(auth.uid(), owner_role)
  OR assigned_to = auth.uid()
);

DROP POLICY IF EXISTS "Authenticated users can view crm_appointments" ON public.crm_appointments;
CREATE POLICY "Appointments visible by role"
ON public.crm_appointments
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
  OR has_role(auth.uid(), 'superadmin'::app_role)
  OR owner_role IS NULL
  OR has_role(auth.uid(), owner_role)
);

-- Backfill: stamp owner_role from creator/assignee where possible
UPDATE public.crm_tasks t
SET owner_role = (
  SELECT role FROM public.user_roles ur
  WHERE ur.user_id = t.assigned_to
  ORDER BY CASE role
    WHEN 'superadmin' THEN 1 WHEN 'admin' THEN 2 WHEN 'gerente' THEN 3
    WHEN 'posvenda' THEN 4 WHEN 'crc' THEN 5 ELSE 99 END
  LIMIT 1
)
WHERE owner_role IS NULL AND assigned_to IS NOT NULL;

UPDATE public.crm_appointments a
SET owner_role = (
  SELECT role FROM public.user_roles ur
  JOIN public.crm_leads l ON l.id = a.lead_id
  WHERE ur.user_id = l.assigned_to
  ORDER BY CASE role
    WHEN 'superadmin' THEN 1 WHEN 'admin' THEN 2 WHEN 'gerente' THEN 3
    WHEN 'posvenda' THEN 4 WHEN 'crc' THEN 5 ELSE 99 END
  LIMIT 1
)
WHERE owner_role IS NULL;
