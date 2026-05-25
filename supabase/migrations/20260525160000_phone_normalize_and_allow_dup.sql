-- ============================================================
-- 1) NORMALIZAÇÃO DE TELEFONE — trigger no banco
-- ============================================================
-- Regra (BR-only):
--   - Remove tudo que não é dígito
--   - Se começa com 55 e tem >=12 dígitos, remove o 55 (vamos re-add)
--   - Se sobrar 11 dígitos (DDD + 9 + número de 8): remove o 9 inicial após DDD
--     (formato aceito pela WhatsApp API)
--   - Re-adiciona 55 no início
--   - Resultado canônico: "55<DDD><número de 8 dígitos>" = 12 dígitos
--
-- Exemplos:
--   "77988639272"     → "557788639272"
--   "(77) 98863-9272" → "557788639272"
--   "+5577988639272"  → "557788639272"
--   "5577988639272"   → "557788639272"
--   "7788639272"      → "557788639272"

CREATE OR REPLACE FUNCTION public.normalize_lead_phone()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_digits text;
  v_ddd text;
  v_rest text;
BEGIN
  IF NEW.phone IS NULL OR NEW.phone = '' THEN
    NEW.phone := NULL;
    RETURN NEW;
  END IF;

  v_digits := regexp_replace(NEW.phone, '[^0-9]', '', 'g');

  IF v_digits = '' THEN
    NEW.phone := NULL;
    RETURN NEW;
  END IF;

  -- Remove country code 55 se presente e número longo o suficiente
  IF length(v_digits) >= 12 AND substring(v_digits FROM 1 FOR 2) = '55' THEN
    v_digits := substring(v_digits FROM 3);
  END IF;

  -- Se sobrou 11 dígitos = DDD(2) + 9 + número(8), remove o 9
  IF length(v_digits) = 11 THEN
    v_ddd  := substring(v_digits FROM 1 FOR 2);
    v_rest := substring(v_digits FROM 3);
    IF substring(v_rest FROM 1 FOR 1) = '9' THEN
      v_digits := v_ddd || substring(v_rest FROM 2);
    END IF;
  END IF;

  NEW.phone := '55' || v_digits;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_lead_phone ON public.crm_leads;
CREATE TRIGGER trg_normalize_lead_phone
BEFORE INSERT OR UPDATE OF phone ON public.crm_leads
FOR EACH ROW EXECUTE FUNCTION public.normalize_lead_phone();

-- ============================================================
-- 2) DROP UNIQUE CONSTRAINT — permitir duplicação intencional
-- ============================================================
-- A partir de agora, a deduplicação é responsabilidade da aplicação:
--   - Frontend (NewLeadDialog) sempre chama check_duplicate_phone antes
--     do INSERT e mostra pop-up com opções para o usuário.
--   - Webhooks (generic-lead-webhook) fazem pre-check explícito.
--   - Usuário pode optar por "Duplicar mesmo assim" se realmente quiser.

DROP INDEX IF EXISTS public.crm_leads_tenant_phone_uniq;

-- ============================================================
-- 3) BACKFILL — normalizar telefones existentes
-- ============================================================
-- Re-update do phone dispara o trigger acima, normalizando todos os
-- registros antigos para o formato canônico.
UPDATE public.crm_leads
SET phone = phone
WHERE phone IS NOT NULL AND phone <> '';
