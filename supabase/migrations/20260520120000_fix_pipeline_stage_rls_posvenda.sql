-- Fix: permitir que posvenda e crc também possam criar/editar/excluir funis e etapas.
-- Antes, apenas admin e gerente podiam. Isso bloqueava o usuário de pós-venda de criar
-- seus próprios funis para o fluxo pós-venda.

-- ─── crm_pipelines ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins and managers can insert crm_pipelines" ON public.crm_pipelines;
DROP POLICY IF EXISTS "Admins and managers can update crm_pipelines" ON public.crm_pipelines;
DROP POLICY IF EXISTS "Admins and managers can delete crm_pipelines" ON public.crm_pipelines;

CREATE POLICY "Staff can insert crm_pipelines"
ON public.crm_pipelines
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'superadmin'::app_role)
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'gerente'::app_role)
  OR public.has_role(auth.uid(), 'crc'::app_role)
  OR public.has_role(auth.uid(), 'posvenda'::app_role)
);

CREATE POLICY "Staff can update crm_pipelines"
ON public.crm_pipelines
FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'superadmin'::app_role)
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'gerente'::app_role)
  OR public.has_role(auth.uid(), 'crc'::app_role)
  OR public.has_role(auth.uid(), 'posvenda'::app_role)
)
WITH CHECK (
  public.has_role(auth.uid(), 'superadmin'::app_role)
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'gerente'::app_role)
  OR public.has_role(auth.uid(), 'crc'::app_role)
  OR public.has_role(auth.uid(), 'posvenda'::app_role)
);

CREATE POLICY "Staff can delete crm_pipelines"
ON public.crm_pipelines
FOR DELETE
TO authenticated
USING (
  public.has_role(auth.uid(), 'superadmin'::app_role)
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'gerente'::app_role)
  OR public.has_role(auth.uid(), 'crc'::app_role)
  OR public.has_role(auth.uid(), 'posvenda'::app_role)
);

-- ─── crm_stages ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins and managers can insert crm_stages" ON public.crm_stages;
DROP POLICY IF EXISTS "Admins and managers can update crm_stages" ON public.crm_stages;
DROP POLICY IF EXISTS "Admins and managers can delete crm_stages" ON public.crm_stages;

CREATE POLICY "Staff can insert crm_stages"
ON public.crm_stages
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'superadmin'::app_role)
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'gerente'::app_role)
  OR public.has_role(auth.uid(), 'crc'::app_role)
  OR public.has_role(auth.uid(), 'posvenda'::app_role)
);

CREATE POLICY "Staff can update crm_stages"
ON public.crm_stages
FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'superadmin'::app_role)
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'gerente'::app_role)
  OR public.has_role(auth.uid(), 'crc'::app_role)
  OR public.has_role(auth.uid(), 'posvenda'::app_role)
)
WITH CHECK (
  public.has_role(auth.uid(), 'superadmin'::app_role)
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'gerente'::app_role)
  OR public.has_role(auth.uid(), 'crc'::app_role)
  OR public.has_role(auth.uid(), 'posvenda'::app_role)
);

CREATE POLICY "Staff can delete crm_stages"
ON public.crm_stages
FOR DELETE
TO authenticated
USING (
  public.has_role(auth.uid(), 'superadmin'::app_role)
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'gerente'::app_role)
  OR public.has_role(auth.uid(), 'crc'::app_role)
  OR public.has_role(auth.uid(), 'posvenda'::app_role)
);
