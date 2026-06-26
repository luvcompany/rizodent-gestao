ALTER TABLE public.ai_assistant_config
  ADD COLUMN IF NOT EXISTS text_provider TEXT NOT NULL DEFAULT 'gemini',
  ADD COLUMN IF NOT EXISTS transcription_provider TEXT NOT NULL DEFAULT 'gemini',
  ADD COLUMN IF NOT EXISTS transcription_model TEXT NOT NULL DEFAULT 'google/gemini-2.5-flash';