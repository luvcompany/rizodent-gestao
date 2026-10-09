-- Mundo de um papel: SDR/CRC (e gerência/legado) formam um só mundo.
CREATE OR REPLACE FUNCTION public.normaliza_mundo(p_role text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN coalesce(p_role,'') IN ('','crc','sdr','crc_legacy','superadmin','gerente') THEN 'crc' ELSE p_role END
$$;

-- Mundo de um número (whatsapp_numbers.id). NULL = número legado (whatsapp_config).
CREATE OR REPLACE FUNCTION public.mundo_numero_whatsapp(p_tenant uuid, p_number_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.normaliza_mundo(
    CASE WHEN p_number_id IS NULL THEN
      (SELECT i.owner_role FROM integrations i WHERE i.tenant_id = p_tenant AND i.key = 'whatsapp_config' LIMIT 1)
    ELSE
      (SELECT i.owner_role FROM whatsapp_numbers w
         JOIN integrations i ON i.tenant_id = w.tenant_id AND i.key LIKE 'whatsapp_%'
                            AND i.config->>'phone_number_id' = w.phone_number_id
        WHERE w.id = p_number_id
        ORDER BY (i.owner_role IS NULL) LIMIT 1)
    END)
$$;

-- Lead já existente do mesmo mundo (o mais antigo) para um telefone.
CREATE OR REPLACE FUNCTION public.lead_whatsapp_existente(p_tenant uuid, p_phone text, p_mundo text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.id FROM crm_leads l
   WHERE l.tenant_id = p_tenant AND l.phone = p_phone
     AND public.mundo_numero_whatsapp(l.tenant_id, l.whatsapp_number_id) = public.normaliza_mundo(p_mundo)
   ORDER BY l.created_at ASC LIMIT 1
$$;

-- Mundo de um lead para mescla: funil restrito (closer, pós-venda, recepção) define o mundo;
-- senão, o número do lead.
CREATE OR REPLACE FUNCTION public.mundo_do_lead(p_lead uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN p.allowed_roles IS NOT NULL AND cardinality(p.allowed_roles) > 0
         AND NOT (p.allowed_roles::text[] && ARRAY['crc','sdr']::text[]) THEN
      'funil:' || coalesce((SELECT r FROM unnest(p.allowed_roles::text[]) r WHERE r <> 'gerente' ORDER BY r LIMIT 1), 'gerente')
    ELSE public.mundo_numero_whatsapp(l.tenant_id, l.whatsapp_number_id)
  END
  FROM crm_leads l LEFT JOIN crm_pipelines p ON p.id = l.pipeline_id
  WHERE l.id = p_lead
$$;

-- Registro das mesclas automáticas.
CREATE TABLE IF NOT EXISTS public.crm_lead_mesclagens_auto (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  lead_mantido uuid NOT NULL,
  lead_removido uuid NOT NULL,
  phone text,
  nome_removido text,
  mundo text,
  mensagens_movidas integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.crm_lead_mesclagens_auto TO authenticated;
GRANT ALL ON public.crm_lead_mesclagens_auto TO service_role;
ALTER TABLE public.crm_lead_mesclagens_auto ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Gestão vê mesclas automáticas" ON public.crm_lead_mesclagens_auto
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin')
         OR (public.has_role(auth.uid(), 'gerente') AND tenant_id = public.current_tenant_id()));

-- Mescla um lead criado por mensagem recebida no lead mais antigo do MESMO mundo
-- (mesmo tenant + telefone). Retorna o id do lead mantido, ou NULL se nada mudou.
CREATE OR REPLACE FUNCTION public.mesclar_lead_duplicado_mesmo_mundo(p_lead uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c crm_leads; k crm_leads; v_mundo text; v_msgs integer; t text;
BEGIN
  SELECT * INTO c FROM crm_leads WHERE id = p_lead FOR UPDATE;
  IF c.id IS NULL OR coalesce(c.phone,'') = '' OR c.instagram_user_id IS NOT NULL THEN RETURN NULL; END IF;
  -- Só leads que nasceram de mensagem recebida (lead manual fica com o aviso "Lead já cadastrado").
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
    name = CASE WHEN k.name LIKE 'Lead WhatsApp %' AND c.name NOT LIKE 'Lead WhatsApp %' THEN c.name ELSE k.name END
  WHERE id = k.id;

  INSERT INTO crm_lead_mesclagens_auto(tenant_id, lead_mantido, lead_removido, phone, nome_removido, mundo, mensagens_movidas)
  VALUES (c.tenant_id, k.id, c.id, c.phone, c.name, v_mundo, v_msgs);

  -- O gatilho trg_snapshot_lead_before_delete guarda a cópia na lixeira (90 dias).
  DELETE FROM crm_leads WHERE id = c.id;
  RETURN k.id;
END $$;

-- Varredura: mescla duplicados recentes criados por mensagem recebida.
CREATE OR REPLACE FUNCTION public.mesclar_leads_duplicados_recentes()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; n integer := 0; v uuid;
BEGIN
  FOR r IN
    SELECT l.id FROM crm_leads l
     WHERE l.created_at > now() - interval '24 hours'
       AND coalesce(l.phone,'') <> '' AND l.instagram_user_id IS NULL
       AND EXISTS (SELECT 1 FROM crm_leads o WHERE o.tenant_id = l.tenant_id AND o.phone = l.phone
                     AND o.id <> l.id AND o.created_at < l.created_at)
     ORDER BY l.created_at DESC
  LOOP
    BEGIN
      v := public.mesclar_lead_duplicado_mesmo_mundo(r.id);
      IF v IS NOT NULL THEN n := n + 1; END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'mesclar_leads_duplicados_recentes: lead % — %', r.id, SQLERRM;
    END;
  END LOOP;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.mesclar_lead_duplicado_mesmo_mundo(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mesclar_leads_duplicados_recentes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mesclar_lead_duplicado_mesmo_mundo(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mesclar_leads_duplicados_recentes() TO service_role;
GRANT EXECUTE ON FUNCTION public.lead_whatsapp_existente(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.normaliza_mundo(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mundo_numero_whatsapp(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mundo_do_lead(uuid) TO authenticated, service_role;
