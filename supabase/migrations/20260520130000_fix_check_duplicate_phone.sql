-- Melhora check_duplicate_phone:
-- 1. Compara os últimos 8 dígitos (ignora formatação: parênteses, hífens, espaços, +55)
-- 2. Retorna pipeline e etapa do lead duplicado para exibir no modal
CREATE OR REPLACE FUNCTION public.check_duplicate_phone(p_phone text)
RETURNS TABLE(
  lead_id       uuid,
  lead_name     text,
  assigned_to   uuid,
  pipeline_name text,
  stage_name    text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    l.id,
    l.name,
    l.assigned_to,
    COALESCE(p.name, '') AS pipeline_name,
    COALESCE(s.name, '') AS stage_name
  FROM public.crm_leads l
  LEFT JOIN public.crm_pipelines p ON p.id = l.pipeline_id
  LEFT JOIN public.crm_stages   s ON s.id = l.stage_id
  WHERE l.phone IS NOT NULL
    AND l.phone <> ''
    AND length(regexp_replace(p_phone, '[^0-9]', '', 'g')) >= 8
    AND right(regexp_replace(l.phone,   '[^0-9]', '', 'g'), 8)
      = right(regexp_replace(p_phone,   '[^0-9]', '', 'g'), 8)
  LIMIT 1;
$$;
