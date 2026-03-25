
-- Create messages table
CREATE TABLE public.messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id uuid NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  direction text NOT NULL DEFAULT 'outbound',
  type text NOT NULL DEFAULT 'text',
  content text,
  media_url text,
  status text NOT NULL DEFAULT 'sent',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view messages" ON public.messages FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert messages" ON public.messages FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update messages" ON public.messages FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete messages" ON public.messages FOR DELETE TO authenticated USING (true);

-- Create integrations table
CREATE TABLE public.integrations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key text NOT NULL UNIQUE,
  config jsonb DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'disconnected',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view integrations" ON public.integrations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert integrations" ON public.integrations FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update integrations" ON public.integrations FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete integrations" ON public.integrations FOR DELETE TO authenticated USING (true);

-- Add last_message fields to crm_leads
ALTER TABLE public.crm_leads ADD COLUMN last_message text;
ALTER TABLE public.crm_leads ADD COLUMN last_message_at timestamp with time zone;

-- Enable realtime for messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
