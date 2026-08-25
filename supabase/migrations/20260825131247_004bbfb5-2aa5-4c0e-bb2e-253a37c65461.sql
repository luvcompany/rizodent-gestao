CREATE TABLE IF NOT EXISTS public.dontus_credenciais (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  client_id text,
  team_token text,
  access_token text,
  token_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.dontus_credenciais TO service_role;

ALTER TABLE public.dontus_credenciais ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dontus_credenciais_deny_all" ON public.dontus_credenciais;
CREATE POLICY "dontus_credenciais_deny_all"
ON public.dontus_credenciais
FOR ALL
TO authenticated, anon
USING (false)
WITH CHECK (false);

DROP TRIGGER IF EXISTS trg_dontus_credenciais_updated_at ON public.dontus_credenciais;
CREATE TRIGGER trg_dontus_credenciais_updated_at
BEFORE UPDATE ON public.dontus_credenciais
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();