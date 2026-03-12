CREATE POLICY "Authenticated users can delete leads_diarios"
ON public.leads_diarios
FOR DELETE
TO authenticated
USING (true);