DROP POLICY IF EXISTS "Users can insert their own oauth state" ON public.whatsapp_oauth_states;
CREATE POLICY "Users can insert their own oauth state"
  ON public.whatsapp_oauth_states FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS "Users can insert their own oauth state" ON public.instagram_oauth_states;
CREATE POLICY "Users can insert their own oauth state"
  ON public.instagram_oauth_states FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND tenant_id = public.current_tenant_id());