
-- 1) Backup table
CREATE TABLE IF NOT EXISTS public.deleted_leads_backup (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_lead_id uuid NOT NULL,
  tenant_id uuid,
  lead_name text,
  lead_phone text,
  lead_snapshot jsonb NOT NULL,
  messages_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  instagram_messages_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  messages_count integer NOT NULL DEFAULT 0,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  deleted_by uuid,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  restored_at timestamptz,
  restored_by uuid
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.deleted_leads_backup TO authenticated;
GRANT ALL ON public.deleted_leads_backup TO service_role;

ALTER TABLE public.deleted_leads_backup ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_select_backup" ON public.deleted_leads_backup
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    OR public.has_role(auth.uid(), 'superadmin'::app_role)
  );

CREATE POLICY "tenant_update_backup" ON public.deleted_leads_backup
  FOR UPDATE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    OR public.has_role(auth.uid(), 'superadmin'::app_role)
  );

CREATE POLICY "tenant_delete_backup" ON public.deleted_leads_backup
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'superadmin'::app_role)
    OR public.has_role(auth.uid(), 'gerente'::app_role)
  );

CREATE INDEX IF NOT EXISTS idx_deleted_leads_backup_tenant ON public.deleted_leads_backup(tenant_id);
CREATE INDEX IF NOT EXISTS idx_deleted_leads_backup_expires ON public.deleted_leads_backup(expires_at);
CREATE INDEX IF NOT EXISTS idx_deleted_leads_backup_deleted_at ON public.deleted_leads_backup(deleted_at DESC);

-- 2) Snapshot trigger before deleting a lead
CREATE OR REPLACE FUNCTION public.snapshot_lead_before_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_msgs jsonb;
  v_ig jsonb;
  v_count integer;
BEGIN
  SELECT COALESCE(jsonb_agg(to_jsonb(m.*) ORDER BY m.created_at), '[]'::jsonb), COUNT(*)
    INTO v_msgs, v_count
    FROM public.messages m
   WHERE m.lead_id = OLD.id;

  SELECT COALESCE(jsonb_agg(to_jsonb(im.*) ORDER BY im.created_at), '[]'::jsonb)
    INTO v_ig
    FROM public.instagram_messages im
   WHERE im.lead_id = OLD.id;

  INSERT INTO public.deleted_leads_backup
    (original_lead_id, tenant_id, lead_name, lead_phone, lead_snapshot,
     messages_snapshot, instagram_messages_snapshot, messages_count, deleted_by)
  VALUES
    (OLD.id, OLD.tenant_id, OLD.name, OLD.phone, to_jsonb(OLD),
     v_msgs, v_ig, v_count, auth.uid());

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_snapshot_lead_before_delete ON public.crm_leads;
CREATE TRIGGER trg_snapshot_lead_before_delete
BEFORE DELETE ON public.crm_leads
FOR EACH ROW EXECUTE FUNCTION public.snapshot_lead_before_delete();

-- 3) Restore function
CREATE OR REPLACE FUNCTION public.restore_deleted_lead(_backup_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bk public.deleted_leads_backup;
  v_lead jsonb;
  v_new_id uuid;
  v_msg jsonb;
  v_ig jsonb;
BEGIN
  SELECT * INTO v_bk FROM public.deleted_leads_backup WHERE id = _backup_id;
  IF v_bk.id IS NULL THEN RAISE EXCEPTION 'Backup não encontrado'; END IF;

  IF v_bk.tenant_id IS DISTINCT FROM public.current_tenant_id()
     AND NOT public.has_role(auth.uid(), 'superadmin'::app_role) THEN
    RAISE EXCEPTION 'Sem permissão para restaurar este lead';
  END IF;

  IF v_bk.restored_at IS NOT NULL THEN
    RAISE EXCEPTION 'Este backup já foi restaurado';
  END IF;

  v_lead := v_bk.lead_snapshot;

  -- Reuse original id if free, otherwise generate new
  IF EXISTS (SELECT 1 FROM public.crm_leads WHERE id = v_bk.original_lead_id) THEN
    v_new_id := gen_random_uuid();
  ELSE
    v_new_id := v_bk.original_lead_id;
  END IF;

  INSERT INTO public.crm_leads (
    id, tenant_id, name, phone, source, tags, notes, value, ad_id,
    imagem_origem, nome_anuncio, descricao_anuncio, link_anuncio,
    ad_account_id, ad_account_name, pipeline_id, stage_id, assigned_to,
    cidade, servico_interesse, paciente_id, instagram_user_id, score,
    is_blocked, blocked_at, blocked_by, last_inbound_at, last_outbound_at,
    last_message_at, created_at, updated_at
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
    NULLIF(v_lead->>'pipeline_id','')::uuid,
    -- Only restore stage if it still exists
    (SELECT id FROM public.crm_stages WHERE id = NULLIF(v_lead->>'stage_id','')::uuid),
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
    now();

  -- Restore messages
  FOR v_msg IN SELECT * FROM jsonb_array_elements(v_bk.messages_snapshot) LOOP
    BEGIN
      INSERT INTO public.messages (
        id, lead_id, tenant_id, direction, type, content, media_url, status,
        created_at, whatsapp_message_id, channel, transcription, sender_id,
        ad_headline, ad_body, ad_image_url, ad_source_url, ad_source_id,
        ad_account_id, ad_account_name, error_reason, instagram_message_id,
        instagram_sender_id, whatsapp_number_id
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
        NULLIF(v_msg->>'whatsapp_number_id','')::uuid
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
     SET restored_at = now(), restored_by = auth.uid()
   WHERE id = _backup_id;

  RETURN v_new_id;
END;
$$;

-- 4) Cleanup expired backups
CREATE OR REPLACE FUNCTION public.cleanup_expired_lead_backups()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  DELETE FROM public.deleted_leads_backup
   WHERE expires_at < now()
     AND restored_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
