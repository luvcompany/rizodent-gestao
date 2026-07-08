
CREATE TABLE public.whatsapp_oauth_states (
  state uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_whatsapp_oauth_states_expires ON public.whatsapp_oauth_states (expires_at);

GRANT SELECT, INSERT, DELETE ON public.whatsapp_oauth_states TO authenticated;
GRANT ALL ON public.whatsapp_oauth_states TO service_role;

ALTER TABLE public.whatsapp_oauth_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own oauth state"
  ON public.whatsapp_oauth_states FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own oauth state"
  ON public.whatsapp_oauth_states FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own oauth state"
  ON public.whatsapp_oauth_states FOR DELETE TO authenticated
  USING (user_id = auth.uid());
