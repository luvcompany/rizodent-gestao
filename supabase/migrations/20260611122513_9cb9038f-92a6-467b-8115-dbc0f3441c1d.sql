
-- 1) Substituir a política de leitura de crm_pipelines por uma versão que
--    não dependa de subselect na própria tabela (que falha no INSERT RETURNING).
DROP POLICY IF EXISTS "Users can view allowed pipelines" ON public.crm_pipelines;

CREATE POLICY "Users can view allowed pipelines"
ON public.crm_pipelines
FOR SELECT
TO authenticated
USING (
  COALESCE(
    public.user_override(auth.uid(), 'pipeline', id::text),
    public.has_role(auth.uid(), 'superadmin'::public.app_role)
    OR (
      allowed_roles IS NULL
      AND (
        public.has_role(auth.uid(), 'crc'::public.app_role)
        OR public.has_role(auth.uid(), 'gerente'::public.app_role)
      )
    )
    OR (
      allowed_roles IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid()
          AND ur.role = ANY(allowed_roles)
      )
    )
  )
);

-- 2) Trigger BEFORE INSERT em crm_pipelines: preenche tenant_id automaticamente
--    quando o frontend não enviar, evitando violações da política tenant_isolation.
CREATE OR REPLACE FUNCTION public.set_pipeline_tenant_default()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := public.current_tenant_id();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_pipeline_tenant_default ON public.crm_pipelines;
CREATE TRIGGER trg_set_pipeline_tenant_default
BEFORE INSERT ON public.crm_pipelines
FOR EACH ROW EXECUTE FUNCTION public.set_pipeline_tenant_default();

-- 3) Garantir que crm_stages herde tenant_id do funil pai quando não enviado.
--    A função set_crm_tenant_id_from_context já existe; só anexamos o trigger se faltar.
DROP TRIGGER IF EXISTS trg_set_crm_stages_tenant ON public.crm_stages;
CREATE TRIGGER trg_set_crm_stages_tenant
BEFORE INSERT ON public.crm_stages
FOR EACH ROW EXECUTE FUNCTION public.set_crm_tenant_id_from_context();

-- 4) Corrigir etapas antigas sem tenant (herdam do funil).
UPDATE public.crm_stages s
   SET tenant_id = p.tenant_id
  FROM public.crm_pipelines p
 WHERE s.pipeline_id = p.id
   AND s.tenant_id IS NULL
   AND p.tenant_id IS NOT NULL;
