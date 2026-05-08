
CREATE TABLE public.ai_conversation_analysis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL,
  mode text NOT NULL,
  question text NOT NULL DEFAULT '',
  result text NOT NULL,
  message_count integer NOT NULL DEFAULT 0,
  last_message_at timestamptz,
  model text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ai_conversation_analysis_unique
  ON public.ai_conversation_analysis (lead_id, mode, question);

CREATE INDEX ai_conversation_analysis_lead_idx
  ON public.ai_conversation_analysis (lead_id);

ALTER TABLE public.ai_conversation_analysis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view ai_conversation_analysis"
  ON public.ai_conversation_analysis FOR SELECT TO authenticated USING (true);

CREATE POLICY "Staff can insert ai_conversation_analysis"
  ON public.ai_conversation_analysis FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Staff can update ai_conversation_analysis"
  ON public.ai_conversation_analysis FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Admins/managers can delete ai_conversation_analysis"
  ON public.ai_conversation_analysis FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'gerente'::app_role));
