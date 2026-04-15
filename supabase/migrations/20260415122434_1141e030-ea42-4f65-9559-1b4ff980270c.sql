CREATE TABLE public.crm_conversation_notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  after_message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  author_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_conversation_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view crm_conversation_notes"
  ON public.crm_conversation_notes FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Staff can insert crm_conversation_notes"
  ON public.crm_conversation_notes FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Staff can update crm_conversation_notes"
  ON public.crm_conversation_notes FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Staff can delete crm_conversation_notes"
  ON public.crm_conversation_notes FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL);