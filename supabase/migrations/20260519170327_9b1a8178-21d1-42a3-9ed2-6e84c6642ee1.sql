
ALTER TABLE public.bots ADD COLUMN IF NOT EXISTS shared_roles public.app_role[] NOT NULL DEFAULT '{}';
ALTER TABLE public.crm_broadcasts ADD COLUMN IF NOT EXISTS shared_roles public.app_role[] NOT NULL DEFAULT '{}';
ALTER TABLE public.crm_quick_replies ADD COLUMN IF NOT EXISTS shared_roles public.app_role[] NOT NULL DEFAULT '{}';
ALTER TABLE public.crm_whatsapp_templates ADD COLUMN IF NOT EXISTS shared_roles public.app_role[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION public.user_has_any_role(_user_id uuid, _roles public.app_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = ANY(_roles)
  );
$$;

DROP POLICY IF EXISTS "Bots visible by role" ON public.bots;
CREATE POLICY "Bots visible by role" ON public.bots FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'superadmin'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
  OR owner_role IS NULL
  OR has_role(auth.uid(), owner_role)
  OR public.user_has_any_role(auth.uid(), shared_roles)
);

DROP POLICY IF EXISTS "Broadcasts visible by role" ON public.crm_broadcasts;
CREATE POLICY "Broadcasts visible by role" ON public.crm_broadcasts FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'superadmin'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
  OR owner_role IS NULL
  OR has_role(auth.uid(), owner_role)
  OR public.user_has_any_role(auth.uid(), shared_roles)
);

DROP POLICY IF EXISTS "Quick replies visible by role" ON public.crm_quick_replies;
CREATE POLICY "Quick replies visible by role" ON public.crm_quick_replies FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'superadmin'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
  OR owner_role IS NULL
  OR has_role(auth.uid(), owner_role)
  OR public.user_has_any_role(auth.uid(), shared_roles)
);

DROP POLICY IF EXISTS "Templates visible by role" ON public.crm_whatsapp_templates;
CREATE POLICY "Templates visible by role" ON public.crm_whatsapp_templates FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'superadmin'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
  OR owner_role IS NULL
  OR has_role(auth.uid(), owner_role)
  OR public.user_has_any_role(auth.uid(), shared_roles)
);
