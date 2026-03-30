
ALTER TABLE public.crm_leads 
  ADD COLUMN IF NOT EXISTS imagem_origem text,
  ADD COLUMN IF NOT EXISTS titulo_anuncio text,
  ADD COLUMN IF NOT EXISTS descricao_anuncio text,
  ADD COLUMN IF NOT EXISTS link_anuncio text,
  ADD COLUMN IF NOT EXISTS ad_id text;
