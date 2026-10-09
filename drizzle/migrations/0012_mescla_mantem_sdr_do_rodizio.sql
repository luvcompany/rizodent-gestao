CREATE OR REPLACE FUNCTION public.mesclar_lead_duplicado_mesmo_mundo(p_lead uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c crm_leads; k crm_leads; v_mundo text; v_msgs integer; t text;
BEGIN
  SELECT * INTO c FROM crm_leads WHERE id = p_lead FOR UPDATE;
  IF c.id IS NULL OR coalesce(c.phone,'') = '' OR c.instagram_user_id IS NOT NULL THEN RETURN NULL; END IF;
  IF c.last_inbound_at IS NULL AND c.first_inbound_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.lead_id = c.id AND m.direction = 'inbound') THEN
    RETURN NULL;
  END IF;

  v_mundo := public.mundo_do_lead(c.id);
  SELECT l.* INTO k FROM crm_leads l
   WHERE l.tenant_id = c.tenant_id AND l.phone = c.phone AND l.id <> c.id
     AND l.created_at < c.created_at
     AND public.mundo_do_lead(l.id) = v_mundo
   ORDER BY l.created_at ASC LIMIT 1
   FOR UPDATE;
  IF k.id IS NULL THEN RETURN NULL; END IF;

  UPDATE messages SET lead_id = k.id WHERE lead_id = c.id;
  GET DIAGNOSTICS v_msgs = ROW_COUNT;

  FOREACH t IN ARRAY ARRAY['crm_conversation_notes','crm_tasks','crm_appointments',
    'crm_lead_label_assignments','crm_lead_custom_values','crm_lead_pacientes','crm_lead_instagram_identities',
    'instagram_messages','api4com_calls','whatsapp_calls','whatsapp_call_permissions','crm_notifications',
    'crm_pesquisa_respostas','closer_pacientes','ai_reply_suggestions','ai_conversation_analysis',
    'crm_contratado_pendente','crm_entregas_gestor','crm_fechamentos_agendados']
  LOOP
    BEGIN
      EXECUTE format('UPDATE public.%I SET lead_id=$1 WHERE lead_id=$2', t) USING k.id, c.id;
    EXCEPTION WHEN unique_violation THEN
      EXECUTE format('DELETE FROM public.%I WHERE lead_id=$1', t) USING c.id;
    WHEN undefined_table OR undefined_column THEN NULL;
    END;
  END LOOP;

  UPDATE crm_leads SET
    last_inbound_at = GREATEST(k.last_inbound_at, c.last_inbound_at),
    first_inbound_at = coalesce(LEAST(k.first_inbound_at, c.first_inbound_at), k.first_inbound_at, c.first_inbound_at),
    last_message_at = GREATEST(k.last_message_at, c.last_message_at),
    last_message = CASE WHEN c.last_message_at IS NOT NULL AND (k.last_message_at IS NULL OR c.last_message_at > k.last_message_at)
                        THEN c.last_message ELSE k.last_message END,
    last_outbound_at = GREATEST(k.last_outbound_at, c.last_outbound_at),
    conversa_fechada_em = CASE WHEN c.last_inbound_at IS NOT NULL AND (k.conversa_fechada_em IS NULL OR c.last_inbound_at > k.conversa_fechada_em)
                               THEN NULL ELSE k.conversa_fechada_em END,
    conversa_fechada_por = CASE WHEN c.last_inbound_at IS NOT NULL AND (k.conversa_fechada_em IS NULL OR c.last_inbound_at > k.conversa_fechada_em)
                                THEN NULL ELSE k.conversa_fechada_por END,
    name = CASE WHEN k.name LIKE 'Lead WhatsApp %' AND c.name NOT LIKE 'Lead WhatsApp %' THEN c.name ELSE k.name END,
    -- Se a cópia está com uma SDR e o original não, a SDR que já atende continua com o lead.
    assigned_to = CASE WHEN c.assigned_to IS NOT NULL AND public.has_role(c.assigned_to, 'sdr')
                            AND (k.assigned_to IS NULL OR NOT public.has_role(k.assigned_to, 'sdr'))
                       THEN c.assigned_to ELSE k.assigned_to END,
    distribuido_em = CASE WHEN c.assigned_to IS NOT NULL AND public.has_role(c.assigned_to, 'sdr')
                            AND (k.assigned_to IS NULL OR NOT public.has_role(k.assigned_to, 'sdr'))
                       THEN coalesce(c.distribuido_em, k.distribuido_em) ELSE k.distribuido_em END
  WHERE id = k.id;

  INSERT INTO crm_lead_mesclagens_auto(tenant_id, lead_mantido, lead_removido, phone, nome_removido, mundo, mensagens_movidas)
  VALUES (c.tenant_id, k.id, c.id, c.phone, c.name, v_mundo, v_msgs);

  DELETE FROM crm_leads WHERE id = c.id;
  RETURN k.id;
END $$;
REVOKE ALL ON FUNCTION public.mesclar_lead_duplicado_mesmo_mundo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mesclar_lead_duplicado_mesmo_mundo(uuid) TO service_role;