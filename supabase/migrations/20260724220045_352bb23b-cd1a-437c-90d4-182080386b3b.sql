CREATE TABLE IF NOT EXISTS public.kommo_contatos (
  phone_tail text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.kommo_contatos TO service_role;
ALTER TABLE public.kommo_contatos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kommo_contatos service only" ON public.kommo_contatos FOR ALL USING (false) WITH CHECK (false);