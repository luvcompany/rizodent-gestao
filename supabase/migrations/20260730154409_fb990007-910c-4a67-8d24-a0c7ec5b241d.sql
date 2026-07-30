CREATE POLICY "ai_reply_suggestions_tenant_isolation"
ON public.ai_reply_suggestions
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (tenant_id = public.current_tenant_id() OR public.has_role(auth.uid(), 'superadmin'))
WITH CHECK (tenant_id = public.current_tenant_id() OR public.has_role(auth.uid(), 'superadmin'));