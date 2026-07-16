-- ==========================================================================
-- Telefonia Api4Com (voz) — config por clínica + ramais SIP por usuário.
-- Complementar à ligação por WhatsApp (que continua intacta).
-- ==========================================================================

-- Config da conta Api4Com por tenant. Token é SEGREDO: lido só por edge functions.
CREATE TABLE IF NOT EXISTS public.api4com_config (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_email text,
  api_token text,
  gateway text,
  webhook_secret text,
  webhook_registered boolean NOT NULL DEFAULT false,
  connected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.api4com_config ENABLE ROW LEVEL SECURITY;
-- Sem policies de cliente: só service role (edge functions). Status via edge.

-- Ramais SIP por usuário (para o softphone WebRTC próprio, se usado).
CREATE TABLE IF NOT EXISTS public.api4com_extensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  ramal text NOT NULL,
  senha text NOT NULL,
  domain text NOT NULL,
  bina text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);
ALTER TABLE public.api4com_extensions ENABLE ROW LEVEL SECURITY;
CREATE POLICY api4com_ext_own_select ON public.api4com_extensions
  FOR SELECT TO authenticated USING (user_id = auth.uid());
