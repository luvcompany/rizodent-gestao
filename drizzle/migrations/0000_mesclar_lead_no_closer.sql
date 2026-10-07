ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS historico_de_lead_id uuid;
CREATE INDEX IF NOT EXISTS messages_historico_idx ON public.messages(lead_id) WHERE historico_de_lead_id IS NOT NULL;
COMMENT ON COLUMN public.messages.historico_de_lead_id IS 'Lead de origem quando a mensagem veio de uma mesclagem (histórico anterior, só leitura).';

CREATE OR REPLACE FUNCTION public.mesclar_lead_no_closer(_origem uuid, _destino uuid, _por uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o crm_leads; d crm_leads; t text;
BEGIN
  SELECT * INTO o FROM crm_leads WHERE id=_origem;
  SELECT * INTO d FROM crm_leads WHERE id=_destino;
  IF o.id IS NULL OR d.id IS NULL OR o.id=d.id OR o.tenant_id<>d.tenant_id THEN
    RAISE EXCEPTION 'Leads inválidos para mesclar';
  END IF;

  INSERT INTO deleted_leads_backup(original_lead_id, tenant_id, lead_name, lead_phone, lead_snapshot, messages_snapshot, messages_count, deleted_by)
  SELECT o.id, o.tenant_id, o.name, o.phone, to_jsonb(o),
         coalesce((SELECT jsonb_agg(to_jsonb(m)) FROM messages m WHERE m.lead_id=o.id),'[]'::jsonb),
         (SELECT count(*) FROM messages m WHERE m.lead_id=o.id), _por;

  UPDATE messages SET historico_de_lead_id = coalesce(historico_de_lead_id, _origem), lead_id=_destino WHERE lead_id=_origem;

  FOREACH t IN ARRAY ARRAY['crm_conversation_notes','crm_lead_stage_history','crm_tasks','crm_appointments',
    'crm_lead_label_assignments','crm_lead_custom_values','crm_lead_pacientes','crm_lead_instagram_identities',
    'instagram_messages','api4com_calls','whatsapp_calls','whatsapp_call_permissions','crm_notifications',
    'crm_pesquisa_respostas','closer_pacientes','ai_reply_suggestions','ai_conversation_analysis','crm_lead_atribuicoes']
  LOOP
    BEGIN
      EXECUTE format('UPDATE public.%I SET lead_id=$1 WHERE lead_id=$2', t) USING _destino, _origem;
    EXCEPTION WHEN unique_violation THEN
      EXECUTE format('DELETE FROM public.%I WHERE lead_id=$1', t) USING _origem;
    END;
  END LOOP;

  DELETE FROM crm_leads WHERE id=_origem;
END $$;
REVOKE ALL ON FUNCTION public.mesclar_lead_no_closer(uuid,uuid,uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mesclar_lead_no_closer(uuid,uuid,uuid) TO service_role;