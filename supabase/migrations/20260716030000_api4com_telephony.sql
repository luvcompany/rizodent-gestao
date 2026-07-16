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

-- Registro de ligações da Api4Com (recebidas via webhook channel-hangup).
CREATE TABLE IF NOT EXISTS public.api4com_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.crm_leads(id) ON DELETE SET NULL,
  call_id text,
  from_phone text,
  to_phone text,
  direction text,
  status text,
  hangup_cause text,
  duration_seconds integer,
  recording_url text,
  transcription text,
  started_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.api4com_calls ENABLE ROW LEVEL SECURITY;
-- Leitura por clínica (ou superadmin). Escrita só via service role (webhook).
DROP POLICY IF EXISTS api4com_calls_tenant_select ON public.api4com_calls;
CREATE POLICY api4com_calls_tenant_select ON public.api4com_calls
  FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() OR has_role(auth.uid(), 'superadmin'::app_role));
CREATE INDEX IF NOT EXISTS idx_api4com_calls_lead ON public.api4com_calls (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api4com_calls_tenant ON public.api4com_calls (tenant_id, created_at DESC);
