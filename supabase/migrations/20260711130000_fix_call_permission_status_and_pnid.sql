-- ============================================================================
-- Ajuste final do trigger de resposta de permissão de ligação
-- ============================================================================
-- A migração 20260711120000 (mergeada) parou a perda de mensagens (phone_number_id
-- nullable + EXCEPTION), mas o trigger AINDA não gravava a permissão por DOIS
-- motivos descobertos em produção:
--
--   1) STATUS INVÁLIDO: gravava status 'accepted'/'rejected', mas a coluna tem
--      CHECK constraint que só aceita ('pending','approved','revoked','expired',
--      'denied'). O INSERT falhava (violava o CHECK) e o EXCEPTION o engolia — por
--      isso whatsapp_call_permissions continuava vazia. Mapeamento correto:
--      accept -> 'approved', reject -> 'denied'.
--   2) phone_number_id não era preenchido. A Rizodent usa UM único número; o valor
--      real está nas chamadas já feitas (whatsapp_calls) — o trigger resolve daí.
--
-- Esta migração aplica a versão final e correta da função (idempotente:
-- CREATE OR REPLACE). Já reflete o que está rodando em produção.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_call_permission_reply()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_json  jsonb;
  v_reply jsonb;
  v_resp  text;
  v_perm  boolean;
  v_exp   bigint;
  v_phone text;
  v_pnid  text;
BEGIN
  IF NEW.content IS NULL OR left(btrim(NEW.content), 1) <> '{' THEN
    RETURN NEW;
  END IF;
  BEGIN
    v_json := NEW.content::jsonb;
  EXCEPTION WHEN others THEN
    RETURN NEW;
  END;
  IF v_json->>'type' <> 'call_permission_reply' THEN
    RETURN NEW;
  END IF;

  v_reply := v_json->'call_permission_reply';
  v_resp  := v_reply->>'response';
  IF v_resp NOT IN ('accept', 'reject') THEN
    RETURN NEW;
  END IF;
  v_perm := COALESCE((v_reply->>'is_permanent')::boolean, false);
  v_exp  := NULLIF(v_reply->>'expiration_timestamp', '')::bigint;

  SELECT regexp_replace(COALESCE(phone, ''), '\D', '', 'g') INTO v_phone
  FROM public.crm_leads WHERE id = NEW.lead_id;
  IF v_phone IS NULL OR v_phone = '' THEN
    RETURN NEW;
  END IF;

  -- phone_number_id do tenant (número único da Rizodent), resolvido das chamadas.
  SELECT phone_number_id INTO v_pnid
  FROM public.whatsapp_calls
  WHERE tenant_id = NEW.tenant_id AND phone_number_id IS NOT NULL
  ORDER BY created_at DESC
  LIMIT 1;

  -- Gravar a permissão é best-effort: NUNCA deixar quebrar o INSERT da mensagem.
  BEGIN
    INSERT INTO public.whatsapp_call_permissions
      (tenant_id, phone_number_id, whatsapp_number_id, consumer_phone, lead_id, status, approved_at, expires_at, raw_payload, updated_at)
    VALUES (
      NEW.tenant_id, v_pnid, NEW.whatsapp_number_id, v_phone, NEW.lead_id,
      CASE WHEN v_resp = 'accept' THEN 'approved' ELSE 'denied' END,
      CASE WHEN v_resp = 'accept' THEN now() ELSE NULL END,
      CASE WHEN v_resp = 'accept' AND NOT v_perm AND v_exp IS NOT NULL
           THEN to_timestamp(v_exp) ELSE NULL END,
      v_json, now()
    )
    ON CONFLICT (tenant_id, consumer_phone) DO UPDATE SET
      status             = EXCLUDED.status,
      approved_at        = EXCLUDED.approved_at,
      expires_at         = EXCLUDED.expires_at,
      phone_number_id    = COALESCE(EXCLUDED.phone_number_id, whatsapp_call_permissions.phone_number_id),
      whatsapp_number_id = COALESCE(EXCLUDED.whatsapp_number_id, whatsapp_call_permissions.whatsapp_number_id),
      lead_id            = COALESCE(EXCLUDED.lead_id, whatsapp_call_permissions.lead_id),
      raw_payload        = EXCLUDED.raw_payload,
      updated_at         = now();
  EXCEPTION WHEN others THEN
    RAISE WARNING 'record_call_permission_reply: falha ao gravar permissao (%). Mensagem preservada.', SQLERRM;
  END;

  RETURN NEW;
END;
$$;
