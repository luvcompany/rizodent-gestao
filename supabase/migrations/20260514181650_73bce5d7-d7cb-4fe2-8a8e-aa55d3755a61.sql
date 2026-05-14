DROP POLICY IF EXISTS pagamentos_tenant_isolation ON public.pagamentos;
CREATE POLICY pagamentos_tenant_isolation ON public.pagamentos
AS RESTRICTIVE FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.clinicas c
    WHERE c.id = pagamentos.clinica_id
      AND c.tenant_id = public.current_tenant_id()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.clinicas c
    WHERE c.id = pagamentos.clinica_id
      AND c.tenant_id = public.current_tenant_id()
  )
);

DROP POLICY IF EXISTS tratamentos_tenant_isolation ON public.tratamentos;
CREATE POLICY tratamentos_tenant_isolation ON public.tratamentos
AS RESTRICTIVE FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.clinicas c
    WHERE c.id = tratamentos.clinica_id
      AND c.tenant_id = public.current_tenant_id()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.clinicas c
    WHERE c.id = tratamentos.clinica_id
      AND c.tenant_id = public.current_tenant_id()
  )
);

DROP POLICY IF EXISTS leads_diarios_tenant_isolation ON public.leads_diarios;
CREATE POLICY leads_diarios_tenant_isolation ON public.leads_diarios
AS RESTRICTIVE FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.clinicas c
    WHERE c.id = leads_diarios.clinica_id
      AND c.tenant_id = public.current_tenant_id()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.clinicas c
    WHERE c.id = leads_diarios.clinica_id
      AND c.tenant_id = public.current_tenant_id()
  )
);