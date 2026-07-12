-- Link de localização por unidade (usado para montar o botão "Ver localização"
-- ao gerar o modelo de agendamento da unidade e enviá-lo à Meta para aprovação).
ALTER TABLE public.clinicas ADD COLUMN IF NOT EXISTS location_link text;

COMMENT ON COLUMN public.clinicas.location_link IS
  'Link de localização (ex.: Google Maps) da unidade. Vira o botão "Ver localização" no modelo de agendamento gerado para esta unidade.';
