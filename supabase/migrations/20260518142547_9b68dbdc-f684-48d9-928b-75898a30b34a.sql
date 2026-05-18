
-- 1) Add owner_role column to the three tables
ALTER TABLE public.bots ADD COLUMN IF NOT EXISTS owner_role app_role;
ALTER TABLE public.crm_broadcasts ADD COLUMN IF NOT EXISTS owner_role app_role;
ALTER TABLE public.crm_quick_replies ADD COLUMN IF NOT EXISTS owner_role app_role;

-- 2) Trigger function: auto-set owner_role to the creator's primary role on INSERT
CREATE OR REPLACE FUNCTION public.set_owner_role_from_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.owner_role IS NULL AND auth.uid() IS NOT NULL THEN
    NEW.owner_role := public.get_user_primary_role(auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_owner_role_bots ON public.bots;
CREATE TRIGGER trg_set_owner_role_bots
BEFORE INSERT ON public.bots
FOR EACH ROW EXECUTE FUNCTION public.set_owner_role_from_user();

DROP TRIGGER IF EXISTS trg_set_owner_role_broadcasts ON public.crm_broadcasts;
CREATE TRIGGER trg_set_owner_role_broadcasts
BEFORE INSERT ON public.crm_broadcasts
FOR EACH ROW EXECUTE FUNCTION public.set_owner_role_from_user();

DROP TRIGGER IF EXISTS trg_set_owner_role_quick_replies ON public.crm_quick_replies;
CREATE TRIGGER trg_set_owner_role_quick_replies
BEFORE INSERT ON public.crm_quick_replies
FOR EACH ROW EXECUTE FUNCTION public.set_owner_role_from_user();

-- 3) Replace SELECT policies with role-restricted ones

-- bots
DROP POLICY IF EXISTS "Authenticated users can view bots" ON public.bots;
CREATE POLICY "Bots visible by role"
ON public.bots
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
  OR has_role(auth.uid(), 'superadmin'::app_role)
  OR owner_role IS NULL
  OR has_role(auth.uid(), owner_role)
);

-- crm_broadcasts
DROP POLICY IF EXISTS "Authenticated can view crm_broadcasts" ON public.crm_broadcasts;
CREATE POLICY "Broadcasts visible by role"
ON public.crm_broadcasts
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
  OR has_role(auth.uid(), 'superadmin'::app_role)
  OR owner_role IS NULL
  OR has_role(auth.uid(), owner_role)
);

-- crm_quick_replies
DROP POLICY IF EXISTS "Authenticated can view crm_quick_replies" ON public.crm_quick_replies;
CREATE POLICY "Quick replies visible by role"
ON public.crm_quick_replies
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
  OR has_role(auth.uid(), 'superadmin'::app_role)
  OR owner_role IS NULL
  OR has_role(auth.uid(), owner_role)
);
