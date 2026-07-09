
-- Fase 1: Ligações WhatsApp — tabela de registros de chamadas

CREATE TABLE public.whatsapp_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  whatsapp_number_id uuid REFERENCES public.whatsapp_numbers(id) ON DELETE SET NULL,
  phone_number_id text NOT NULL,
  wa_call_id text UNIQUE,
  lead_id uuid REFERENCES public.crm_leads(id) ON DELETE SET NULL,
  from_phone text,
  to_phone text,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  status text NOT NULL DEFAULT 'ringing' CHECK (status IN ('ringing','pre_accepted','accepted','in_progress','completed','missed','rejected','failed','canceled')),
  event text,
  started_at timestamptz,
  connected_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  initiated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  answered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sdp_offer text,
  sdp_answer text,
  ice_candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  session_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_payload jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_whatsapp_calls_tenant ON public.whatsapp_calls(tenant_id);
CREATE INDEX idx_whatsapp_calls_lead ON public.whatsapp_calls(lead_id);
CREATE INDEX idx_whatsapp_calls_phone_number_id ON public.whatsapp_calls(phone_number_id);
CREATE INDEX idx_whatsapp_calls_status ON public.whatsapp_calls(status);
CREATE INDEX idx_whatsapp_calls_created_at ON public.whatsapp_calls(created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_calls TO authenticated;
GRANT ALL ON public.whatsapp_calls TO service_role;

ALTER TABLE public.whatsapp_calls ENABLE ROW LEVEL SECURITY;

-- Tenant isolation: users see calls for their tenant
CREATE POLICY "Users can view calls in their tenant"
  ON public.whatsapp_calls FOR SELECT
  TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert calls in their tenant"
  ON public.whatsapp_calls FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update calls in their tenant"
  ON public.whatsapp_calls FOR UPDATE
  TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Service role full access on calls"
  ON public.whatsapp_calls FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER update_whatsapp_calls_updated_at
  BEFORE UPDATE ON public.whatsapp_calls
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_calls;
ALTER TABLE public.whatsapp_calls REPLICA IDENTITY FULL;

-- Permissões de chamadas concedidas por leads (business-initiated)
CREATE TABLE public.whatsapp_call_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  whatsapp_number_id uuid REFERENCES public.whatsapp_numbers(id) ON DELETE CASCADE,
  phone_number_id text NOT NULL,
  consumer_phone text NOT NULL,
  lead_id uuid REFERENCES public.crm_leads(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','revoked','expired','denied')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  expires_at timestamptz,
  calls_made_today integer NOT NULL DEFAULT 0,
  consecutive_unanswered integer NOT NULL DEFAULT 0,
  last_call_at timestamptz,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (phone_number_id, consumer_phone)
);

CREATE INDEX idx_whatsapp_call_permissions_tenant ON public.whatsapp_call_permissions(tenant_id);
CREATE INDEX idx_whatsapp_call_permissions_lead ON public.whatsapp_call_permissions(lead_id);
CREATE INDEX idx_whatsapp_call_permissions_status ON public.whatsapp_call_permissions(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_call_permissions TO authenticated;
GRANT ALL ON public.whatsapp_call_permissions TO service_role;

ALTER TABLE public.whatsapp_call_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view permissions in their tenant"
  ON public.whatsapp_call_permissions FOR SELECT
  TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert permissions in their tenant"
  ON public.whatsapp_call_permissions FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update permissions in their tenant"
  ON public.whatsapp_call_permissions FOR UPDATE
  TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Service role full access on permissions"
  ON public.whatsapp_call_permissions FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER update_whatsapp_call_permissions_updated_at
  BEFORE UPDATE ON public.whatsapp_call_permissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
