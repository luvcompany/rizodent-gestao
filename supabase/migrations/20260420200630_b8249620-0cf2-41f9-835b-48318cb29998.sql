-- 1. Pipeline Instagram + etapas (mesma estrutura do Funil Principal)
DO $$
DECLARE
  v_pipeline_id uuid := 'c2d3e4f5-0001-4000-8000-000000000002';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.crm_pipelines WHERE id = v_pipeline_id) THEN
    INSERT INTO public.crm_pipelines (id, name, color, description)
    VALUES (v_pipeline_id, 'Instagram', '#E4405F', 'Funil de leads originados do Instagram');

    INSERT INTO public.crm_stages (pipeline_id, name, position, color) VALUES
      (v_pipeline_id, 'Novo Lead',      0, '#3b82f6'),
      (v_pipeline_id, 'Conversando',    1, '#f59e0b'),
      (v_pipeline_id, 'Relacionamento', 2, '#8b5cf6'),
      (v_pipeline_id, 'Follow - Up',    3, '#f59e0b'),
      (v_pipeline_id, 'Recuperado',     4, '#8b5cf6'),
      (v_pipeline_id, 'Pré - Agendado', 5, '#bff075'),
      (v_pipeline_id, 'Agendado',       6, '#c0ee1b'),
      (v_pipeline_id, 'Não compareceu', 7, '#eab308'),
      (v_pipeline_id, 'Reagendado',     8, '#6366f1'),
      (v_pipeline_id, 'Contratado',     9, '#84cc16'),
      (v_pipeline_id, 'Desqualificado', 10, '#ef4444');
  END IF;
END$$;

-- 2. Estende messages com canal e identificadores Instagram
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'whatsapp',
  ADD COLUMN IF NOT EXISTS instagram_message_id text,
  ADD COLUMN IF NOT EXISTS instagram_sender_id text;

CREATE INDEX IF NOT EXISTS idx_messages_channel ON public.messages(channel);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_instagram_msg_id
  ON public.messages(instagram_message_id) WHERE instagram_message_id IS NOT NULL;

-- 3. Estende crm_leads com identificadores Instagram
ALTER TABLE public.crm_leads
  ADD COLUMN IF NOT EXISTS instagram_user_id text,
  ADD COLUMN IF NOT EXISTS instagram_username text,
  ADD COLUMN IF NOT EXISTS instagram_profile_pic_url text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_leads_instagram_user_id
  ON public.crm_leads(instagram_user_id) WHERE instagram_user_id IS NOT NULL;

-- 4. Estende instagram_messages com cache de username/foto
ALTER TABLE public.instagram_messages
  ADD COLUMN IF NOT EXISTS sender_username text;