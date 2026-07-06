
CREATE TABLE public.instagram_oauth_states (
  state uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, DELETE ON public.instagram_oauth_states TO authenticated;
GRANT ALL ON public.instagram_oauth_states TO service_role;

ALTER TABLE public.instagram_oauth_states ENABLE ROW LEVEL SECURITY;

-- Users can create their own OAuth state (initiation)
CREATE POLICY "Users can insert their own oauth state"
ON public.instagram_oauth_states
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Users can read their own states (rarely needed; callback runs as service_role)
CREATE POLICY "Users can read their own oauth state"
ON public.instagram_oauth_states
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Users can delete their own states
CREATE POLICY "Users can delete their own oauth state"
ON public.instagram_oauth_states
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

CREATE INDEX idx_instagram_oauth_states_expires ON public.instagram_oauth_states(expires_at);
