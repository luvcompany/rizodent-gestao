-- ============================================================================
-- Transferir atendimento de um lead do Instagram para o WhatsApp
-- ============================================================================
-- "Vira a chave" do canal de atendimento (active_channel='whatsapp') mantendo o
-- MESMO card/conversa (as mensagens já são carregadas por lead_id, sem filtrar
-- canal). Se já existir OUTRO card de WhatsApp com o mesmo telefone, MESCLA: move
-- as mensagens e tarefas para este lead e bloqueia o duplicado (decisão do dono).
--
-- SECURITY DEFINER + checagem de tenant (o lead precisa ser do tenant do usuário).
-- O telefone já vem normalizado pelo trigger normalize_lead_phone do crm_leads.
-- O disparo do template de abertura é feito pelo cliente (send-whatsapp-message).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.transfer_lead_to_whatsapp(p_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_lead    record;
  v_phone   text;
  v_dup_id  uuid;
  v_caller_tenant uuid;
BEGIN
  SELECT id, tenant_id, phone INTO v_lead FROM public.crm_leads WHERE id = p_lead_id;
  IF v_lead.id IS NULL THEN
    RETURN jsonb_build_object('error', 'lead_not_found');
  END IF;

  -- Isolamento: o lead tem que ser do tenant de quem chamou.
  SELECT tenant_id INTO v_caller_tenant FROM public.profiles WHERE id = auth.uid();
  IF v_caller_tenant IS NULL OR v_caller_tenant <> v_lead.tenant_id THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  v_phone := regexp_replace(COALESCE(v_lead.phone, ''), '\D', '', 'g');
  IF v_phone = '' THEN
    RETURN jsonb_build_object('error', 'no_phone');
  END IF;

  -- Duplicado: outro card (não bloqueado) com o mesmo telefone → mescla neste.
  SELECT id INTO v_dup_id
  FROM public.crm_leads
  WHERE tenant_id = v_lead.tenant_id
    AND id <> p_lead_id
    AND COALESCE(is_blocked, false) = false
    AND regexp_replace(COALESCE(phone, ''), '\D', '', 'g') = v_phone
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_dup_id IS NOT NULL THEN
    UPDATE public.messages   SET lead_id = p_lead_id WHERE lead_id = v_dup_id;
    UPDATE public.crm_tasks  SET lead_id = p_lead_id WHERE lead_id = v_dup_id;
    UPDATE public.crm_leads
       SET is_blocked = true, blocked_at = now(), updated_at = now()
     WHERE id = v_dup_id;
  END IF;

  -- Vira o canal de atendimento (mantém instagram_user_id — é identidade/histórico).
  UPDATE public.crm_leads
     SET active_channel = 'whatsapp', updated_at = now()
   WHERE id = p_lead_id;

  RETURN jsonb_build_object('ok', true, 'merged', v_dup_id IS NOT NULL, 'merged_lead_id', v_dup_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.transfer_lead_to_whatsapp(uuid) TO authenticated;
