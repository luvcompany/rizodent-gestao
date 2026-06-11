
DO $$
DECLARE
  v_zigo_pipeline uuid := '13809677-5b6d-4283-8511-fbe4ff61fd5e';
  v_tenant uuid := '00000000-0000-0000-0000-000000000010';
  v_moved int;
BEGIN
  -- 1) Ajusta cor do "Novo Lead" existente
  UPDATE public.crm_stages
     SET color = '#3b82f6'
   WHERE pipeline_id = v_zigo_pipeline AND name = 'Novo Lead';

  -- 2) Cria estágios espelho (idempotente por nome+pipeline)
  INSERT INTO public.crm_stages (name, pipeline_id, position, color, tenant_id)
  SELECT s.name, v_zigo_pipeline, s.position, s.color, v_tenant
    FROM (VALUES
      ('Conversando',     1, '#f59e0b'),
      ('Relacionamento',  2, '#8b5cf6'),
      ('Follow - Up',     3, '#f59e0b'),
      ('Recuperado',      4, '#8b5cf6'),
      ('Pré - Agendado',  5, '#bff075'),
      ('Agendado',        6, '#c0ee1b'),
      ('Não compareceu',  7, '#eab308'),
      ('Reagendado',      8, '#6366f1'),
      ('Contratado',      9, '#84cc16'),
      ('Desqualificado', 10, '#ef4444')
    ) AS s(name, position, color)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.crm_stages x
      WHERE x.pipeline_id = v_zigo_pipeline AND x.name = s.name
   );

  -- 3) Move os leads elegíveis preservando o nome do estágio
  WITH zigo_stages AS (
    SELECT id, name FROM public.crm_stages WHERE pipeline_id = v_zigo_pipeline
  ),
  eligible AS (
    SELECT l.id, zs.id AS new_stage_id
      FROM public.crm_leads l
      JOIN public.crm_stages cs ON cs.id = l.stage_id
      JOIN zigo_stages zs ON zs.name = cs.name
     WHERE l.tenant_id = v_tenant
       AND l.pipeline_id <> v_zigo_pipeline
       AND cs.name IN ('Novo Lead','Conversando','Relacionamento','Follow - Up','Recuperado','Não compareceu')
       AND (
         l.nome_anuncio      ILIKE '%zigom%'
         OR l.titulo_anuncio    ILIKE '%zigom%'
         OR l.descricao_anuncio ILIKE '%zigom%'
         OR l.servico_interesse ILIKE '%zigom%'
       )
  )
  UPDATE public.crm_leads l
     SET pipeline_id = v_zigo_pipeline,
         stage_id    = e.new_stage_id,
         updated_at  = now()
    FROM eligible e
   WHERE l.id = e.id;

  GET DIAGNOSTICS v_moved = ROW_COUNT;
  RAISE NOTICE 'Leads movidos para o funil Zigomático: %', v_moved;
END $$;
