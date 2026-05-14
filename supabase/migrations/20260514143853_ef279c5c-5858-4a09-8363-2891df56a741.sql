CREATE OR REPLACE FUNCTION public.ensure_instagram_pipeline(_tenant_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pipeline_id uuid;
  v_stage_names text[] := ARRAY['Novo Lead', 'Em conversa', 'Agendado', 'Contratado'];
  v_name text;
  v_pos int := 0;
BEGIN
  SELECT id INTO v_pipeline_id
    FROM public.crm_pipelines
   WHERE tenant_id = _tenant_id
     AND name ILIKE '%instagram%'
   ORDER BY created_at ASC
   LIMIT 1;

  IF v_pipeline_id IS NOT NULL THEN
    RETURN v_pipeline_id;
  END IF;

  INSERT INTO public.crm_pipelines (name, tenant_id)
  VALUES ('Instagram', _tenant_id)
  RETURNING id INTO v_pipeline_id;

  FOREACH v_name IN ARRAY v_stage_names LOOP
    INSERT INTO public.crm_stages (name, pipeline_id, position, tenant_id)
    VALUES (v_name, v_pipeline_id, v_pos, _tenant_id);
    v_pos := v_pos + 1;
  END LOOP;

  RETURN v_pipeline_id;
END;
$$;