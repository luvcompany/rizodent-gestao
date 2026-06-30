DROP FUNCTION IF EXISTS public.crm_template_usage_counts(uuid);
CREATE OR REPLACE FUNCTION public.crm_template_usage_counts(_tenant_id uuid)
 RETURNS TABLE(template_name text, usage_count bigint, last_used_at timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    trim(substring(content from '^📋 Template:\s*(.+)$')) AS template_name,
    count(*)::bigint AS usage_count,
    max(created_at) AS last_used_at
  FROM public.messages
  WHERE tenant_id = _tenant_id
    AND direction = 'outbound'
    AND content LIKE '📋 Template:%'
    AND deleted_at IS NULL
  GROUP BY 1
  HAVING trim(substring(content from '^📋 Template:\s*(.+)$')) IS NOT NULL
$function$;