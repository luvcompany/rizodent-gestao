-- ============================================================================
-- Permissão de ligação WhatsApp: rastreamento da resposta do cliente
-- ============================================================================
-- O edge whatsapp-call-signaling (action=request_permission) envia o pedido
-- nativo (mensagem interativa call_permission_request) e grava a solicitação em
-- whatsapp_call_permissions (status='requested'). A RESPOSTA do cliente chega
-- como uma MENSAGEM inbound cujo content é o JSON call_permission_reply. Este
-- trigger detecta essa mensagem e atualiza a permissão (accepted/rejected +
-- validade), sem precisar editar o webhook gigante.
--
-- Regras da Meta: permissão temporária vale 7 dias (168h); permanente não expira;
-- 4 chamadas seguidas não atendidas revogam automaticamente.
-- ============================================================================

-- Uma permissão por (tenant, telefone do consumidor) — permite upsert de estado.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_call_permissions_tenant_consumer_uidx
  ON public.whatsapp_call_permissions (tenant_id, consumer_phone);

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

  -- Telefone do consumidor = telefone do lead (só dígitos), para casar com o
  -- consumer_phone gravado pelo edge no envio do pedido.
  SELECT regexp_replace(COALESCE(phone, ''), '\D', '', 'g') INTO v_phone
  FROM public.crm_leads WHERE id = NEW.lead_id;
  IF v_phone IS NULL OR v_phone = '' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.whatsapp_call_permissions
    (tenant_id, consumer_phone, lead_id, status, approved_at, expires_at, raw_payload, updated_at)
  VALUES (
    NEW.tenant_id, v_phone, NEW.lead_id,
    CASE WHEN v_resp = 'accept' THEN 'accepted' ELSE 'rejected' END,
    CASE WHEN v_resp = 'accept' THEN now() ELSE NULL END,
    -- permanente (is_permanent) → sem expiração; temporária → expiration_timestamp
    CASE WHEN v_resp = 'accept' AND NOT v_perm AND v_exp IS NOT NULL
         THEN to_timestamp(v_exp) ELSE NULL END,
    v_json, now()
  )
  ON CONFLICT (tenant_id, consumer_phone) DO UPDATE SET
    status      = EXCLUDED.status,
    approved_at = EXCLUDED.approved_at,
    expires_at  = EXCLUDED.expires_at,
    lead_id     = COALESCE(EXCLUDED.lead_id, whatsapp_call_permissions.lead_id),
    raw_payload = EXCLUDED.raw_payload,
    updated_at  = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_record_call_permission_reply ON public.messages;
CREATE TRIGGER trg_record_call_permission_reply
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.record_call_permission_reply();
