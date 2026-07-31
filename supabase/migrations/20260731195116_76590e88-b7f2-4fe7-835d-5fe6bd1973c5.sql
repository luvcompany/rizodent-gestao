CREATE OR REPLACE FUNCTION public.can_access_whatsapp_number(_number_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT
    _number_id IS NULL
    OR has_role(auth.uid(), 'superadmin'::app_role)
    OR has_role(auth.uid(), 'crc'::app_role)
    OR has_role(auth.uid(), 'gerente'::app_role)
    OR has_role(auth.uid(), 'posvenda'::app_role)
    OR COALESCE(public.user_override(auth.uid(), 'whatsapp_number', _number_id::text), false);
$$;

CREATE OR REPLACE FUNCTION public.lead_whatsapp_number(_lead_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT whatsapp_number_id FROM public.crm_leads WHERE id = _lead_id;
$$;

DROP POLICY IF EXISTS recepcao_number_scope_leads ON public.crm_leads;
CREATE POLICY recepcao_number_scope_leads ON public.crm_leads
  AS RESTRICTIVE FOR SELECT
  USING (
    NOT has_role(auth.uid(), 'recepcao'::app_role)
    OR (whatsapp_number_id IS NOT NULL
        AND public.can_access_whatsapp_number(whatsapp_number_id))
  );

DROP POLICY IF EXISTS recepcao_number_scope_lead_update ON public.crm_leads;
CREATE POLICY recepcao_number_scope_lead_update ON public.crm_leads
  AS RESTRICTIVE FOR UPDATE
  USING (
    NOT has_role(auth.uid(), 'recepcao'::app_role)
    OR (whatsapp_number_id IS NOT NULL
        AND public.can_access_whatsapp_number(whatsapp_number_id))
  );

DROP POLICY IF EXISTS recepcao_no_lead_delete ON public.crm_leads;
CREATE POLICY recepcao_no_lead_delete ON public.crm_leads
  AS RESTRICTIVE FOR DELETE
  USING (NOT has_role(auth.uid(), 'recepcao'::app_role));

DROP POLICY IF EXISTS recepcao_number_scope_messages ON public.messages;
CREATE POLICY recepcao_number_scope_messages ON public.messages
  AS RESTRICTIVE FOR SELECT
  USING (
    NOT has_role(auth.uid(), 'recepcao'::app_role)
    OR (lead_id IS NOT NULL
        AND public.lead_whatsapp_number(lead_id) IS NOT NULL
        AND public.can_access_whatsapp_number(public.lead_whatsapp_number(lead_id)))
  );

REVOKE SELECT ON public.whatsapp_numbers FROM anon, authenticated;
GRANT SELECT (id, tenant_id, phone_number_id, display_name, phone_e164, waba_id, app_id, is_active, is_default, created_at, updated_at)
  ON public.whatsapp_numbers TO authenticated;

CREATE OR REPLACE FUNCTION public.stamp_message_whatsapp_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.whatsapp_number_id IS NULL AND NEW.lead_id IS NOT NULL THEN
    SELECT l.whatsapp_number_id INTO NEW.whatsapp_number_id
      FROM public.crm_leads l WHERE l.id = NEW.lead_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS messages_stamp_whatsapp_number ON public.messages;
CREATE TRIGGER messages_stamp_whatsapp_number
BEFORE INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.stamp_message_whatsapp_number();