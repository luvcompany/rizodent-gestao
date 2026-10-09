-- Lixeira de leads (09/10/2026).
--
-- 1) A CRC via a Lixeira vazia (havia 109 itens): só superadmin e gerente
--    liam deleted_leads_backup. Passam a ver também: quem excluiu, e CRC /
--    pós-venda os leads que enxergariam (funil e número acessíveis). Closer e
--    recepção seguem presos aos números deles (políticas restritivas que já
--    existem).
-- 2) restore_deleted_lead:
--    - confere quem restaura com a MESMA régua da leitura (antes, qualquer
--      usuário do cliente restaurava qualquer backup pelo id);
--    - devolve o número de WhatsApp, a conta do Instagram e o canal do lead
--      (antes o lead do closer voltava como lead da central);
--    - funil apagado → funil padrão; etapa apagada → 1ª etapa do funil (com a
--      FK RESTRICT da 0020, o funil inexistente fazia a restauração falhar);
--    - telefone já usado por outro lead do mesmo número → mensagem clara.

DROP POLICY IF EXISTS tenant_select_backup ON public.deleted_leads_backup;
CREATE POLICY tenant_select_backup ON public.deleted_leads_backup
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'superadmin'::app_role)
    OR (tenant_id = current_tenant_id()
        AND (has_role(auth.uid(), 'gerente'::app_role)
             OR deleted_by = auth.uid()
             OR ((has_role(auth.uid(), 'crc'::app_role) OR has_role(auth.uid(), 'crc_legacy'::app_role)
                  OR has_role(auth.uid(), 'posvenda'::app_role))
                 AND can_access_pipeline(CASE WHEN (lead_snapshot->>'pipeline_id') ~* '^[0-9a-f-]{36}$'
                                              THEN (lead_snapshot->>'pipeline_id')::uuid END)
                 AND can_access_whatsapp_number(CASE WHEN (lead_snapshot->>'whatsapp_number_id') ~* '^[0-9a-f-]{36}$'
                                                     THEN (lead_snapshot->>'whatsapp_number_id')::uuid END))))
  );

CREATE OR REPLACE FUNCTION public.restore_deleted_lead(_backup_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bk public.deleted_leads_backup;
  v_lead jsonb;
  v_new_id uuid;
  v_msg jsonb;
  v_ig jsonb;
  v_uid uuid := auth.uid();
  v_pipeline uuid;
  v_stage uuid;
  v_numero uuid;
  v_ig_conta uuid;
  v_txt text;
BEGIN
  SELECT * INTO v_bk FROM public.deleted_leads_backup WHERE id = _backup_id;
  IF v_bk.id IS NULL THEN RAISE EXCEPTION 'Backup não encontrado'; END IF;
  v_lead := v_bk.lead_snapshot;

  v_txt := v_lead->>'pipeline_id';
  v_pipeline := CASE WHEN v_txt ~* '^[0-9a-f-]{36}$' THEN v_txt::uuid END;
  v_txt := v_lead->>'whatsapp_number_id';
  v_numero := CASE WHEN v_txt ~* '^[0-9a-f-]{36}$' THEN v_txt::uuid END;
  v_txt := v_lead->>'ig_account_uuid';
  v_ig_conta := CASE WHEN v_txt ~* '^[0-9a-f-]{36}$' THEN v_txt::uuid END;

  -- Mesma régua da leitura da Lixeira (policy tenant_select_backup).
  IF NOT (public.has_role(v_uid, 'superadmin'::app_role)
          OR (v_bk.tenant_id = public.current_tenant_id()
              AND (public.has_role(v_uid, 'gerente'::app_role)
                   OR v_bk.deleted_by = v_uid
                   OR ((public.has_role(v_uid, 'crc'::app_role) OR public.has_role(v_uid, 'crc_legacy'::app_role)
                        OR public.has_role(v_uid, 'posvenda'::app_role))
                       AND public.can_access_pipeline(v_pipeline)
                       AND public.can_access_whatsapp_number(v_numero))))) THEN
    RAISE EXCEPTION 'Sem permissão para restaurar este lead';
  END IF;

  IF v_bk.restored_at IS NOT NULL THEN
    RAISE EXCEPTION 'Este backup já foi restaurado';
  END IF;

  -- Funil e etapa que ainda existem; senão o funil padrão e a 1ª etapa.
  IF v_pipeline IS NULL OR NOT EXISTS (SELECT 1 FROM public.crm_pipelines p
                                         WHERE p.id = v_pipeline AND p.tenant_id = v_bk.tenant_id) THEN
    SELECT p.id INTO v_pipeline FROM public.crm_pipelines p
     WHERE p.tenant_id = v_bk.tenant_id
     ORDER BY p.is_default DESC, p.created_at
     LIMIT 1;
  END IF;
  v_txt := v_lead->>'stage_id';
  SELECT s.id INTO v_stage FROM public.crm_stages s
   WHERE s.pipeline_id = v_pipeline AND s.id = CASE WHEN v_txt ~* '^[0-9a-f-]{36}$' THEN v_txt::uuid END;
  IF v_stage IS NULL THEN
    SELECT s.id INTO v_stage FROM public.crm_stages s WHERE s.pipeline_id = v_pipeline ORDER BY s.position LIMIT 1;
  END IF;

  -- Número e conta do Instagram só se ainda forem deste cliente.
  IF v_numero IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.whatsapp_numbers w
                                            WHERE w.id = v_numero AND w.tenant_id = v_bk.tenant_id) THEN
    v_numero := NULL;
  END IF;
  IF v_ig_conta IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.ig_accounts a WHERE a.id = v_ig_conta) THEN
    v_ig_conta := NULL;
  END IF;

  -- Reuse original id if free, otherwise generate new
  IF EXISTS (SELECT 1 FROM public.crm_leads WHERE id = v_bk.original_lead_id) THEN
    v_new_id := gen_random_uuid();
  ELSE
    v_new_id := v_bk.original_lead_id;
  END IF;

  BEGIN
    INSERT INTO public.crm_leads (
      id, tenant_id, name, phone, source, tags, notes, value, ad_id,
      imagem_origem, nome_anuncio, descricao_anuncio, link_anuncio,
      ad_account_id, ad_account_name, pipeline_id, stage_id, assigned_to,
      cidade, servico_interesse, paciente_id, instagram_user_id, score,
      is_blocked, blocked_at, blocked_by, last_inbound_at, last_outbound_at,
      last_message_at, created_at, updated_at,
      whatsapp_number_id, ig_account_uuid, active_channel
    )
    SELECT
      v_new_id, v_bk.tenant_id,
      v_lead->>'name', v_lead->>'phone', v_lead->>'source',
      CASE WHEN v_lead ? 'tags' AND jsonb_typeof(v_lead->'tags')='array'
           THEN ARRAY(SELECT jsonb_array_elements_text(v_lead->'tags')) END,
      v_lead->>'notes',
      NULLIF(v_lead->>'value','')::numeric,
      v_lead->>'ad_id', v_lead->>'imagem_origem', v_lead->>'nome_anuncio',
      v_lead->>'descricao_anuncio', v_lead->>'link_anuncio',
      v_lead->>'ad_account_id', v_lead->>'ad_account_name',
      v_pipeline,
      v_stage,
      NULLIF(v_lead->>'assigned_to','')::uuid,
      v_lead->>'cidade', v_lead->>'servico_interesse',
      NULLIF(v_lead->>'paciente_id','')::uuid,
      v_lead->>'instagram_user_id',
      COALESCE(NULLIF(v_lead->>'score','')::int, 0),
      COALESCE((v_lead->>'is_blocked')::boolean, false),
      NULLIF(v_lead->>'blocked_at','')::timestamptz,
      NULLIF(v_lead->>'blocked_by','')::uuid,
      NULLIF(v_lead->>'last_inbound_at','')::timestamptz,
      NULLIF(v_lead->>'last_outbound_at','')::timestamptz,
      NULLIF(v_lead->>'last_message_at','')::timestamptz,
      COALESCE(NULLIF(v_lead->>'created_at','')::timestamptz, now()),
      now(),
      v_numero, v_ig_conta, NULLIF(v_lead->>'active_channel','');
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Já existe outro lead com este telefone (ou este perfil do Instagram) neste número. Abra o lead existente em vez de restaurar.'
      USING ERRCODE = '23505';
  END;

  -- Restore messages
  FOR v_msg IN SELECT * FROM jsonb_array_elements(v_bk.messages_snapshot) LOOP
    BEGIN
      INSERT INTO public.messages (
        id, lead_id, tenant_id, direction, type, content, media_url, status,
        created_at, whatsapp_message_id, channel, transcription, sender_id,
        ad_headline, ad_body, ad_image_url, ad_source_url, ad_source_id,
        ad_account_id, ad_account_name, error_reason, instagram_message_id,
        instagram_sender_id, whatsapp_number_id, template_snapshot
      ) VALUES (
        COALESCE(NULLIF(v_msg->>'id','')::uuid, gen_random_uuid()),
        v_new_id, v_bk.tenant_id,
        v_msg->>'direction', v_msg->>'type', v_msg->>'content', v_msg->>'media_url', v_msg->>'status',
        COALESCE(NULLIF(v_msg->>'created_at','')::timestamptz, now()),
        v_msg->>'whatsapp_message_id', v_msg->>'channel', v_msg->>'transcription',
        NULLIF(v_msg->>'sender_id','')::uuid,
        v_msg->>'ad_headline', v_msg->>'ad_body', v_msg->>'ad_image_url',
        v_msg->>'ad_source_url', v_msg->>'ad_source_id',
        v_msg->>'ad_account_id', v_msg->>'ad_account_name', v_msg->>'error_reason',
        v_msg->>'instagram_message_id', v_msg->>'instagram_sender_id',
        NULLIF(v_msg->>'whatsapp_number_id','')::uuid,
        CASE WHEN jsonb_typeof(v_msg->'template_snapshot') = 'object' THEN v_msg->'template_snapshot' END
      );
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END LOOP;

  -- Restore instagram messages
  FOR v_ig IN SELECT * FROM jsonb_array_elements(v_bk.instagram_messages_snapshot) LOOP
    BEGIN
      INSERT INTO public.instagram_messages
        SELECT * FROM jsonb_populate_record(NULL::public.instagram_messages, v_ig || jsonb_build_object('lead_id', v_new_id, 'tenant_id', v_bk.tenant_id));
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;

  UPDATE public.deleted_leads_backup
     SET restored_at = now(), restored_by = v_uid
   WHERE id = _backup_id;

  RETURN v_new_id;
END;
$function$;
