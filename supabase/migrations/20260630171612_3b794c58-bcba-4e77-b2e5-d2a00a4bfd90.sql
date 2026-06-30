
CREATE OR REPLACE FUNCTION public.crm_template_usage_counts(_tenant_id uuid)
RETURNS TABLE(template_name text, usage_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    trim(substring(content from '^📋 Template:\s*(.+)$')) AS template_name,
    count(*)::bigint AS usage_count
  FROM public.messages
  WHERE tenant_id = _tenant_id
    AND direction = 'outbound'
    AND content LIKE '📋 Template:%'
    AND deleted_at IS NULL
  GROUP BY 1
  HAVING trim(substring(content from '^📋 Template:\s*(.+)$')) IS NOT NULL
$$;

GRANT EXECUTE ON FUNCTION public.crm_template_usage_counts(uuid) TO authenticated, service_role;
