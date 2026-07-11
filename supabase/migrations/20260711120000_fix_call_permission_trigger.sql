-- ============================================================================
-- CORREÇÃO CRÍTICA: trigger de resposta de permissão estava perdendo mensagens
-- ============================================================================
-- O trigger record_call_permission_reply (migração 20260710120000) fazia um
-- INSERT em whatsapp_call_permissions SEM preencher phone_number_id, que é uma
-- coluna NOT NULL. Resultado: toda resposta de permissão de ligação recebida do
-- cliente (mensagem inbound com JSON call_permission_reply) falhava no INSERT do
-- trigger e, por ser AFTER INSERT, dava ROLLBACK na própria inserção da mensagem.
--
-- Sintomas observados em produção:
--   • whatsapp_call_permissions ficava com 0 linhas (nada era gravado).
--   • A resposta do cliente NÃO virava linha em `messages` (o thread não mostrava
--     o separador "Cliente autorizou receber ligações"), embora crm_leads.last_message
--     fosse atualizado à parte (por isso a lista mostrava o JSON cru).
--   • A notificação (toast) nunca disparava, pois dependia dessa tabela.
--
-- Correções:
--   1) phone_number_id passa a ser NULLABLE (rede de segurança). A Rizodent usa UM
--      ÚNICO número de WhatsApp para todas as unidades, então há um único
--      phone_number_id por tenant. As tabelas de config (tenant_meta_credentials,
--      whatsapp_numbers) estão vazias, mas o valor real existe nas chamadas já
--      feitas (whatsapp_calls) — o trigger resolve daí, best-effort. Se um dia não
--      houver nenhuma chamada ainda, grava NULL em vez de quebrar.
--   2) O INSERT do trigger é envolvido em BEGIN/EXCEPTION: gravar a permissão é
--      best-effort e JAMAIS pode quebrar o salvamento da mensagem.
-- ============================================================================

ALTER TABLE public.whatsapp_call_permissions
  ALTER COLUMN phone_number_id DROP NOT NULL;

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
  -- Atalho barato: só mensagens cujo content começa com '{' podem ser o JSON.
  IF NEW.content IS NULL OR left(btrim(NEW.content), 1) <> '{' THEN
    RETURN NEW;
  END IF;
  BEGIN
    v_json := NEW.content::jsonb;
  EXCEPTION WHEN others THEN
    RETURN NEW; -- não era JSON válido
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

  -- Telefone do consumidor = telefone do lead (só dígitos).
  SELECT regexp_replace(COALESCE(phone, ''), '\D', '', 'g') INTO v_phone
  FROM public.crm_leads WHERE id = NEW.lead_id;
  IF v_phone IS NULL OR v_phone = '' THEN
    RETURN NEW;
  END IF;

  -- phone_number_id do tenant (número único da Rizodent). Config tables estão
  -- vazias; a fonte confiável é o número já usado nas chamadas do próprio tenant.
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
      CASE WHEN v_resp = 'accept' THEN 'accepted' ELSE 'rejected' END,
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
    RAISE WARNING 'record_call_permission_reply: falha ao gravar permissão (%). Mensagem preservada.', SQLERRM;
  END;

  RETURN NEW;
END;
$$;
