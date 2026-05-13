
CREATE TABLE public.ig_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000010'::uuid,
  ig_user_id text NOT NULL UNIQUE,
  username text,
  access_token text NOT NULL,
  token_expires_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ig_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant can view ig_accounts"
  ON public.ig_accounts FOR SELECT
  TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "tenant can insert ig_accounts"
  ON public.ig_accounts FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY "tenant can update ig_accounts"
  ON public.ig_accounts FOR UPDATE
  TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "tenant can delete ig_accounts"
  ON public.ig_accounts FOR DELETE
  TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE TRIGGER set_ig_accounts_tenant_id
  BEFORE INSERT ON public.ig_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_default();

CREATE TRIGGER update_ig_accounts_updated_at
  BEFORE UPDATE ON public.ig_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
