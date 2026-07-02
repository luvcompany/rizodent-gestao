DROP POLICY IF EXISTS "Admins/managers can delete ai_reply_suggestions" ON public.ai_reply_suggestions;
CREATE POLICY "Staff can delete ai_reply_suggestions"
  ON public.ai_reply_suggestions FOR DELETE
  USING (auth.uid() IS NOT NULL);