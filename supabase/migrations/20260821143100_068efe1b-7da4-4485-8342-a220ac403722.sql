-- 0) Bucket avatars: policy de admin restrita ao mesmo tenant
DROP POLICY IF EXISTS "Admins can manage all avatars" ON storage.objects;
CREATE POLICY "Admins can manage all avatars"
ON storage.objects
FOR ALL
TO authenticated
USING (
  bucket_id = 'avatars'
  AND (
    public.has_role(auth.uid(), 'superadmin'::public.app_role)
    OR (
      public.has_role(auth.uid(), 'crc'::public.app_role)
      AND public.current_tenant_id() IS NOT NULL
      AND (
        EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id::text IN (storage.objects.owner_id, (storage.foldername(storage.objects.name))[1])
            AND p.tenant_id = public.current_tenant_id()
        )
        OR (storage.foldername(storage.objects.name))[1] = public.current_tenant_id()::text
      )
    )
  )
)
WITH CHECK (
  bucket_id = 'avatars'
  AND (
    public.has_role(auth.uid(), 'superadmin'::public.app_role)
    OR (
      public.has_role(auth.uid(), 'crc'::public.app_role)
      AND public.current_tenant_id() IS NOT NULL
      AND (
        EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id::text IN (storage.objects.owner_id, (storage.foldername(storage.objects.name))[1])
            AND p.tenant_id = public.current_tenant_id()
        )
        OR (storage.foldername(storage.objects.name))[1] = public.current_tenant_id()::text
      )
    )
  )
);

-- 7c) Bloqueio no BANCO: usuário bloqueado ou tenant não-ativo => sem tenant => policies negam
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p.tenant_id
  FROM public.profiles p
  JOIN public.tenants t ON t.id = p.tenant_id
  WHERE p.id = auth.uid()
    AND COALESCE(p.is_blocked, false) = false
    AND t.status = 'active'
$function$;

-- 4) ai_reply_suggestions: herda/valida tenant_id a partir do lead
CREATE OR REPLACE FUNCTION public.enforce_suggestion_tenant_matches_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead_tenant uuid;
BEGIN
  IF NEW.lead_id IS NULL THEN
    RAISE EXCEPTION 'ai_reply_suggestions.lead_id é obrigatório para isolamento por cliente';
  END IF;

  SELECT tenant_id INTO v_lead_tenant FROM public.crm_leads WHERE id = NEW.lead_id;
  IF v_lead_tenant IS NULL THEN
    RAISE EXCEPTION 'Lead % não possui tenant_id; sugestão rejeitada', NEW.lead_id;
  END IF;

  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := v_lead_tenant;
  ELSIF NEW.tenant_id <> v_lead_tenant THEN
    RAISE EXCEPTION 'Sugestão do lead % (tenant %) com tenant_id divergente %',
      NEW.lead_id, v_lead_tenant, NEW.tenant_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_suggestion_tenant_from_lead ON public.ai_reply_suggestions;
CREATE TRIGGER trg_set_suggestion_tenant_from_lead
BEFORE INSERT OR UPDATE ON public.ai_reply_suggestions
FOR EACH ROW EXECUTE FUNCTION public.enforce_suggestion_tenant_matches_lead();

-- 14) crm_conversation_notes: herda/valida tenant_id a partir do lead
CREATE OR REPLACE FUNCTION public.enforce_note_tenant_matches_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead_tenant uuid;
BEGIN
  IF NEW.lead_id IS NULL THEN
    RAISE EXCEPTION 'crm_conversation_notes.lead_id é obrigatório para isolamento por cliente';
  END IF;

  SELECT tenant_id INTO v_lead_tenant FROM public.crm_leads WHERE id = NEW.lead_id;
  IF v_lead_tenant IS NULL THEN
    RAISE EXCEPTION 'Lead % não possui tenant_id; nota rejeitada', NEW.lead_id;
  END IF;

  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := v_lead_tenant;
  ELSIF NEW.tenant_id <> v_lead_tenant THEN
    RAISE EXCEPTION 'Nota do lead % (tenant %) com tenant_id divergente %',
      NEW.lead_id, v_lead_tenant, NEW.tenant_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_note_tenant_from_lead ON public.crm_conversation_notes;
CREATE TRIGGER trg_set_note_tenant_from_lead
BEFORE INSERT OR UPDATE ON public.crm_conversation_notes
FOR EACH ROW EXECUTE FUNCTION public.enforce_note_tenant_matches_lead();

-- 12) api4com_webhook_log: deny-all para usuários finais (RLS já ligada, sem policies)
REVOKE ALL ON public.api4com_webhook_log FROM anon, authenticated;
GRANT ALL ON public.api4com_webhook_log TO service_role;