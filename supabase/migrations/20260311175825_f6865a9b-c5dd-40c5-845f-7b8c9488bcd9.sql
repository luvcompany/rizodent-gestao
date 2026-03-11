
-- Allow authenticated users to delete pacientes
CREATE POLICY "Authenticated users can delete pacientes"
ON public.pacientes
FOR DELETE
TO authenticated
USING (true);

-- Allow authenticated users to delete tratamentos
CREATE POLICY "Authenticated users can delete tratamentos"
ON public.tratamentos
FOR DELETE
TO authenticated
USING (true);

-- Allow authenticated users to delete pagamentos
CREATE POLICY "Authenticated users can delete pagamentos"
ON public.pagamentos
FOR DELETE
TO authenticated
USING (true);

-- Allow authenticated users to update pagamentos
CREATE POLICY "Authenticated users can update pagamentos"
ON public.pagamentos
FOR UPDATE
TO authenticated
USING (true);

-- Allow authenticated users to update tratamentos (already exists, skip if error)
