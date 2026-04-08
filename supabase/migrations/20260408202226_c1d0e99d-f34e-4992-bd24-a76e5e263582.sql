
DROP POLICY "Authenticated can insert notifications" ON public.crm_notifications;
CREATE POLICY "Authenticated can insert notifications"
  ON public.crm_notifications FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
