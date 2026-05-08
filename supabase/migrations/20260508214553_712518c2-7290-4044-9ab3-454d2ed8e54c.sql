-- Add is_blocked to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_blocked boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS blocked_at timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS blocked_by uuid;

-- Access logs table
CREATE TABLE IF NOT EXISTS public.access_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  email text,
  tenant_id uuid,
  context text NOT NULL DEFAULT 'client', -- 'admin' | 'client'
  event text NOT NULL DEFAULT 'login',    -- 'login' | 'logout' | 'login_blocked' | 'login_failed'
  ip text,
  user_agent text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_access_logs_created ON public.access_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_logs_tenant ON public.access_logs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_logs_user ON public.access_logs(user_id, created_at DESC);

ALTER TABLE public.access_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can insert own access log"
  ON public.access_logs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Superadmin sees all access logs"
  ON public.access_logs FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'superadmin'::app_role));

CREATE POLICY "Tenant admins see their tenant logs"
  ON public.access_logs FOR SELECT TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'gerente'::app_role))
  );

CREATE POLICY "Users see own access logs"
  ON public.access_logs FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Superadmin can delete access logs"
  ON public.access_logs FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'superadmin'::app_role));