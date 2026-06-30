ALTER TABLE public.ai_good_examples
  ADD COLUMN IF NOT EXISTS rejected_reply text,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'approved_reply',
  ADD COLUMN IF NOT EXISTS source_suggestion_id uuid REFERENCES public.ai_reply_suggestions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS embedding_model text,
  ADD COLUMN IF NOT EXISTS embedding_error text,
  ADD COLUMN IF NOT EXISTS embedded_at timestamptz;

CREATE INDEX IF NOT EXISTS ai_good_examples_source_suggestion_idx
  ON public.ai_good_examples (source_suggestion_id)
  WHERE source_suggestion_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ai_good_examples_embedding_missing_idx
  ON public.ai_good_examples (tenant_id, created_at)
  WHERE embedding IS NULL;