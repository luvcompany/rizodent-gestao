
-- 1) Identidades de Instagram por lead (multi-conta)
CREATE TABLE IF NOT EXISTS public.crm_lead_instagram_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  ig_account_id TEXT NOT NULL,
  ig_scoped_user_id TEXT NOT NULL,
  username TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ig_account_id, ig_scoped_user_id)
);
CREATE INDEX IF NOT EXISTS idx_lead_ig_identities_lead ON public.crm_lead_instagram_identities(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_ig_identities_username ON public.crm_lead_instagram_identities(lower(username));

ALTER TABLE public.crm_lead_instagram_identities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ig_identities_all_authenticated" ON public.crm_lead_instagram_identities;
CREATE POLICY "ig_identities_all_authenticated" ON public.crm_lead_instagram_identities
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 2) Backfill de identidades a partir dos leads existentes + último ig_account das mensagens
INSERT INTO public.crm_lead_instagram_identities (lead_id, ig_account_id, ig_scoped_user_id, username)
SELECT DISTINCT ON (l.id, m.instagram_account_id)
  l.id, m.instagram_account_id, l.instagram_user_id, l.instagram_username
FROM public.crm_leads l
JOIN public.messages m ON m.lead_id = l.id
WHERE l.instagram_user_id IS NOT NULL
  AND m.instagram_account_id IS NOT NULL
ON CONFLICT (ig_account_id, ig_scoped_user_id) DO NOTHING;

-- Backfill via instagram_messages para casos sem mensagens em messages
INSERT INTO public.crm_lead_instagram_identities (lead_id, ig_account_id, ig_scoped_user_id, username)
SELECT DISTINCT ON (l.id, im.instagram_account_id)
  l.id, im.instagram_account_id, l.instagram_user_id, l.instagram_username
FROM public.crm_leads l
JOIN public.instagram_messages im ON im.lead_id = l.id
WHERE l.instagram_user_id IS NOT NULL
  AND im.instagram_account_id IS NOT NULL
ON CONFLICT (ig_account_id, ig_scoped_user_id) DO NOTHING;

-- 3) Mesclar leads duplicados que compartilham o mesmo instagram_username (case-insensitive)
DO $$
DECLARE
  rec RECORD;
  keep_id UUID;
  dup_ids UUID[];
BEGIN
  FOR rec IN
    SELECT lower(instagram_username) AS uname,
           array_agg(id ORDER BY created_at ASC) AS ids
    FROM public.crm_leads
    WHERE instagram_username IS NOT NULL AND instagram_username <> ''
    GROUP BY lower(instagram_username)
    HAVING COUNT(*) > 1
  LOOP
    keep_id := rec.ids[1];
    dup_ids := rec.ids[2:array_length(rec.ids,1)];

    -- repointar todas as tabelas dependentes
    UPDATE public.messages SET lead_id = keep_id WHERE lead_id = ANY(dup_ids);
    UPDATE public.instagram_messages SET lead_id = keep_id WHERE lead_id = ANY(dup_ids);
    UPDATE public.crm_appointments SET lead_id = keep_id WHERE lead_id = ANY(dup_ids);
    UPDATE public.crm_tasks SET lead_id = keep_id WHERE lead_id = ANY(dup_ids);
    UPDATE public.crm_conversation_notes SET lead_id = keep_id WHERE lead_id = ANY(dup_ids);
    UPDATE public.crm_lead_stage_history SET lead_id = keep_id WHERE lead_id = ANY(dup_ids);
    UPDATE public.crm_notifications SET lead_id = keep_id WHERE lead_id = ANY(dup_ids);
    UPDATE public.crm_followup_queue SET lead_id = keep_id WHERE lead_id = ANY(dup_ids);
    UPDATE public.crm_automation_queue SET lead_id = keep_id WHERE lead_id = ANY(dup_ids);
    UPDATE public.crm_automation_executions SET lead_id = keep_id WHERE lead_id = ANY(dup_ids);
    UPDATE public.crm_broadcast_recipients SET lead_id = keep_id WHERE lead_id = ANY(dup_ids);
    UPDATE public.bot_executions SET lead_id = keep_id WHERE lead_id = ANY(dup_ids);
    UPDATE public.ai_conversation_analysis SET lead_id = keep_id WHERE lead_id = ANY(dup_ids);
    UPDATE public.crm_lead_pacientes SET lead_id = keep_id WHERE lead_id = ANY(dup_ids);
    -- custom values: evitar conflito de UNIQUE(lead_id, field_id) se existir
    BEGIN
      UPDATE public.crm_lead_custom_values cv
      SET lead_id = keep_id
      WHERE lead_id = ANY(dup_ids)
        AND NOT EXISTS (
          SELECT 1 FROM public.crm_lead_custom_values cv2
          WHERE cv2.lead_id = keep_id AND cv2.field_id = cv.field_id
        );
      DELETE FROM public.crm_lead_custom_values WHERE lead_id = ANY(dup_ids);
    EXCEPTION WHEN OTHERS THEN
      DELETE FROM public.crm_lead_custom_values WHERE lead_id = ANY(dup_ids);
    END;

    -- mover identidades dos duplicados para o lead mantido
    UPDATE public.crm_lead_instagram_identities
      SET lead_id = keep_id
      WHERE lead_id = ANY(dup_ids);

    -- excluir leads duplicados
    DELETE FROM public.crm_leads WHERE id = ANY(dup_ids);
  END LOOP;
END $$;

-- 4) Atualizar last_message/last_message_at do lead mantido com base na mensagem mais recente
UPDATE public.crm_leads l
SET last_message = sub.content,
    last_message_at = sub.created_at
FROM (
  SELECT DISTINCT ON (lead_id) lead_id, content, created_at
  FROM public.messages
  ORDER BY lead_id, created_at DESC
) sub
WHERE sub.lead_id = l.id
  AND (l.last_message_at IS NULL OR l.last_message_at < sub.created_at);
