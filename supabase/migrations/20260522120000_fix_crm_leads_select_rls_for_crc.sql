-- Fix: CRC/gerente/superadmin users were unable to read leads that moved to
-- the Pós-Venda pipeline, because can_access_pipeline() returned false for
-- pipelines with allowed_roles = ['posvenda']. This caused crm_appointments
-- joins to return null for lead name and cidade, making appointments appear
-- as "Sem cidade" and breaking the link to open the conversation.
--
-- Solution: privileged roles (crc, gerente, superadmin) bypass pipeline and
-- channel restrictions and can read ALL leads within their tenant.
-- The Kanban still filters by pipeline on the frontend — the RLS just needs
-- to allow reading.

DROP POLICY IF EXISTS "Users can view assigned or own leads in allowed pipelines" ON public.crm_leads;

CREATE POLICY "Users can view assigned or own leads in allowed pipelines"
ON public.crm_leads FOR SELECT TO authenticated
USING (
  tenant_id = current_tenant_id()
  AND (
    -- Privileged roles see all leads in the tenant regardless of pipeline/channel
    has_role(auth.uid(), 'crc'::app_role)
    OR has_role(auth.uid(), 'gerente'::app_role)
    OR has_role(auth.uid(), 'superadmin'::app_role)
    -- Everyone else: must match accessible pipeline and channels
    OR (
      public.can_access_pipeline(pipeline_id)
      AND public.can_access_whatsapp_number(whatsapp_number_id)
      AND public.can_access_instagram_account(ig_account_uuid)
    )
  )
);
