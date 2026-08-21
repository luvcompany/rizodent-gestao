DROP POLICY IF EXISTS tenant_hard_isolation_crm_appointments_audit ON public.crm_appointments_audit;
CREATE POLICY tenant_hard_isolation_crm_appointments_audit ON public.crm_appointments_audit
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id()) OR (SELECT public.has_role(auth.uid(), 'superadmin'::app_role)))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()) OR (SELECT public.has_role(auth.uid(), 'superadmin'::app_role)));

CREATE INDEX IF NOT EXISTS idx_user_permission_overrides_user_id ON public.user_permission_overrides(user_id);
DROP POLICY IF EXISTS tenant_hard_isolation_user_permission_overrides ON public.user_permission_overrides;
CREATE POLICY tenant_hard_isolation_user_permission_overrides ON public.user_permission_overrides
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = user_permission_overrides.user_id
      AND (pr.tenant_id = (SELECT public.current_tenant_id()) OR (SELECT public.has_role(auth.uid(), 'superadmin'::app_role)))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = user_permission_overrides.user_id
      AND (pr.tenant_id = (SELECT public.current_tenant_id()) OR (SELECT public.has_role(auth.uid(), 'superadmin'::app_role)))));

CREATE INDEX IF NOT EXISTS idx_ai_conversation_analysis_lead_id ON public.ai_conversation_analysis(lead_id);
DROP POLICY IF EXISTS tenant_hard_isolation_ai_conversation_analysis ON public.ai_conversation_analysis;
CREATE POLICY tenant_hard_isolation_ai_conversation_analysis ON public.ai_conversation_analysis
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.id = ai_conversation_analysis.lead_id
      AND (l.tenant_id = (SELECT public.current_tenant_id()) OR (SELECT public.has_role(auth.uid(), 'superadmin'::app_role)))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.id = ai_conversation_analysis.lead_id
      AND (l.tenant_id = (SELECT public.current_tenant_id()) OR (SELECT public.has_role(auth.uid(), 'superadmin'::app_role)))));

CREATE OR REPLACE FUNCTION public.crm_template_usage_counts(_tenant_id uuid)
 RETURNS TABLE(template_name text, usage_count bigint, last_used_at timestamptz)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT trim(substring(content from '^📋 Template:\s*(.+)$')) AS template_name,
         count(*)::bigint AS usage_count, max(created_at) AS last_used_at
  FROM public.messages
  WHERE tenant_id = CASE WHEN public.has_role(auth.uid(), 'superadmin'::app_role) THEN _tenant_id ELSE public.current_tenant_id() END
    AND direction = 'outbound' AND content LIKE '📋 Template:%' AND deleted_at IS NULL
  GROUP BY 1
  HAVING trim(substring(content from '^📋 Template:\s*(.+)$')) IS NOT NULL
$function$;

ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS lead_webhook_secret text;
UPDATE public.tenants SET lead_webhook_secret = encode(gen_random_bytes(24),'hex') WHERE lead_webhook_secret IS NULL;

NOTIFY pgrst, 'reload schema';