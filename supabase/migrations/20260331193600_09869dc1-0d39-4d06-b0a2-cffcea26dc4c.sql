
-- Restrict integrations table: only admins can insert/update/delete (contains API tokens)
DROP POLICY IF EXISTS "Authenticated users can delete integrations" ON public.integrations;
DROP POLICY IF EXISTS "Authenticated users can insert integrations" ON public.integrations;
DROP POLICY IF EXISTS "Authenticated users can update integrations" ON public.integrations;

CREATE POLICY "Admins can manage integrations"
  ON public.integrations FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
