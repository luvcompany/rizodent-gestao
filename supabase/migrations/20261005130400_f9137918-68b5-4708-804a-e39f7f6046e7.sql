CREATE OR REPLACE FUNCTION public.check_duplicate_phone(p_phone text, _whatsapp_number_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(lead_id uuid, lead_name text, assigned_to uuid, pipeline_name text, stage_name text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH d AS (SELECT regexp_replace(coalesce(p_phone,''), '[^0-9]', '', 'g') v),
  n AS (SELECT CASE
     WHEN length(v) IN (12,13) AND left(v,2)='55' THEN '55'||substr(v,3,2)||right(v,8)
     WHEN length(v) IN (10,11) THEN '55'||left(v,2)||right(v,8)
     ELSE v END AS k FROM d)
  SELECT l.id,
         CASE WHEN m.oculta THEN NULL ELSE l.name END,
         CASE WHEN m.oculta THEN NULL ELSE l.assigned_to END,
         CASE WHEN m.oculta THEN NULL ELSE p.name END,
         CASE WHEN m.oculta THEN NULL ELSE s.name END
  FROM n, public.crm_leads l
  CROSS JOIN LATERAL (
    SELECT public.has_role(auth.uid(), 'sdr'::public.app_role)
           AND l.assigned_to IS DISTINCT FROM auth.uid() AS oculta
  ) m
  LEFT JOIN public.crm_pipelines p ON p.id = l.pipeline_id
  LEFT JOIN public.crm_stages s ON s.id = l.stage_id
  WHERE (l.phone = p_phone OR l.phone = n.k
         OR (length(l.phone)=13 AND '55'||substr(l.phone,3,2)||right(l.phone,8) = n.k))
    AND COALESCE(l.whatsapp_number_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = COALESCE(_whatsapp_number_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND public.can_access_whatsapp_number(l.whatsapp_number_id)
    AND (l.tenant_id = public.current_tenant_id()
      OR public.has_role(auth.uid(), 'superadmin'::public.app_role))
  LIMIT 1;
$function$;