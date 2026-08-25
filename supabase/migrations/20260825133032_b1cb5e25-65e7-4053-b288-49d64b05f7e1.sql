CREATE OR REPLACE FUNCTION public.transfer_lead_to_whatsapp(p_lead_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead    record;
  v_phone   text;
  v_dup_id  uuid;
  v_caller_tenant uuid;
BEGIN
  SELECT id, tenant_id, phone, whatsapp_number_id INTO v_lead FROM public.crm_leads WHERE id = p_lead_id;
  IF v_lead.id IS NULL THEN
    RETURN jsonb_build_object('error', 'lead_not_found');
  END IF;

  SELECT tenant_id INTO v_caller_tenant FROM public.profiles WHERE id = auth.uid();
  IF v_caller_tenant IS NULL OR v_caller_tenant <> v_lead.tenant_id THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  v_phone := regexp_replace(COALESCE(v_lead.phone, ''), '\D', '', 'g');
  IF v_phone = '' THEN
    RETURN jsonb_build_object('error', 'no_phone');
  END IF;

  -- Cada número é um mundo: só mescla duplicado do MESMO mundo
  -- (NULL = mundo legado / número principal).
  SELECT dup.id INTO v_dup_id
  FROM public.crm_leads dup
  WHERE dup.tenant_id = v_lead.tenant_id
    AND dup.id <> p_lead_id
    AND COALESCE(dup.is_blocked, false) = false
    AND regexp_replace(COALESCE(dup.phone, ''), '\D', '', 'g') = v_phone
    AND COALESCE(dup.whatsapp_number_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = COALESCE(v_lead.whatsapp_number_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ORDER BY dup.created_at ASC
  LIMIT 1;

  IF v_dup_id IS NOT NULL THEN
    UPDATE public.messages   SET lead_id = p_lead_id WHERE lead_id = v_dup_id;
    UPDATE public.crm_tasks  SET lead_id = p_lead_id WHERE lead_id = v_dup_id;
    UPDATE public.crm_leads
       SET is_blocked = true, blocked_at = now(), updated_at = now()
     WHERE id = v_dup_id;
  END IF;

  UPDATE public.crm_leads
     SET active_channel = 'whatsapp', updated_at = now()
   WHERE id = p_lead_id;

  RETURN jsonb_build_object('ok', true, 'merged', v_dup_id IS NOT NULL, 'merged_lead_id', v_dup_id);
END;
$function$;