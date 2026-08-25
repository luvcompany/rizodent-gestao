-- 1) Isolamento por número nas LIGAÇÕES do WhatsApp
DROP POLICY IF EXISTS numero_escopo_whatsapp_calls ON public.whatsapp_calls;
CREATE POLICY numero_escopo_whatsapp_calls
ON public.whatsapp_calls
AS RESTRICTIVE
FOR SELECT
USING (
  -- resolve o número da chamada: coluna direta ou, na falta, via phone_number_id
  public.can_access_whatsapp_number(
    COALESCE(
      whatsapp_calls.whatsapp_number_id,
      (SELECT w.id FROM public.whatsapp_numbers w
        WHERE w.tenant_id = whatsapp_calls.tenant_id
          AND w.phone_number_id = whatsapp_calls.phone_number_id
        LIMIT 1)
    )
  )
);

-- 2) check_duplicate_phone com escopo de número (sobrecarga; assinatura antiga preservada)
CREATE OR REPLACE FUNCTION public.check_duplicate_phone(p_phone text, _whatsapp_number_id uuid DEFAULT NULL)
RETURNS TABLE(lead_id uuid, lead_name text, assigned_to uuid, pipeline_name text, stage_name text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT l.id, l.name, l.assigned_to,
         p.name AS pipeline_name,
         s.name AS stage_name
  FROM public.crm_leads l
  LEFT JOIN public.crm_pipelines p ON p.id = l.pipeline_id
  LEFT JOIN public.crm_stages s ON s.id = l.stage_id
  WHERE l.phone = p_phone
    AND COALESCE(l.whatsapp_number_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = COALESCE(_whatsapp_number_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND public.can_access_whatsapp_number(l.whatsapp_number_id)
    AND (
      l.tenant_id = public.current_tenant_id()
      OR public.has_role(auth.uid(), 'superadmin'::public.app_role)
    )
  LIMIT 1;
$function$;

-- 3) contador de não lidas: tenant explícito + escopo de número
CREATE OR REPLACE FUNCTION public.get_crm_unread_leads_count()
RETURNS integer
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT count(*)::integer
  FROM public.crm_leads l
  WHERE l.is_blocked = false
    AND l.tenant_id = public.current_tenant_id()
    AND public.can_access_whatsapp_number(l.whatsapp_number_id)
    AND l.last_inbound_at IS NOT NULL
    AND l.last_inbound_at >= now() - interval '60 days'
    AND (l.last_outbound_at IS NULL OR l.last_inbound_at > l.last_outbound_at);
$function$;

-- 4) lista de conversas expõe o mundo (número) do lead
CREATE OR REPLACE FUNCTION public.get_conversation_leads(p_tenant_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20000)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_super boolean; v_crc boolean; v_gerente boolean; v_posvenda boolean; v_priv boolean;
  v_escopo_numero boolean;
  v_pipes uuid[];
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN '[]'::jsonb; END IF;
  v_super := has_role(v_uid, 'superadmin'::app_role);
  v_tenant := current_tenant_id();
  IF v_super AND p_tenant_id IS NOT NULL THEN v_tenant := p_tenant_id; END IF;
  IF v_tenant IS NULL THEN RETURN '[]'::jsonb; END IF;
  v_crc := has_role(v_uid, 'crc'::app_role);
  v_gerente := has_role(v_uid, 'gerente'::app_role);
  v_posvenda := has_role(v_uid, 'posvenda'::app_role);
  v_priv := v_super OR v_crc OR v_gerente;
  v_escopo_numero := has_role(v_uid, 'closer'::app_role) OR has_role(v_uid, 'recepcao'::app_role);

  SELECT COALESCE(array_agg(p.id), ARRAY[]::uuid[]) INTO v_pipes
  FROM crm_pipelines p
  WHERE p.tenant_id = v_tenant
    AND COALESCE(
      user_override(v_uid, 'pipeline', p.id::text),
      v_super OR (p.allowed_roles IS NULL AND (v_crc OR v_gerente))
      OR EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = v_uid AND ur.role = ANY(p.allowed_roles))
    )
    AND ( v_posvenda OR v_super OR NOT COALESCE(p.is_posvenda, false) );

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.last_message_at DESC NULLS LAST), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT l.id, l.name, l.phone, l.instagram_user_id, l.active_channel,
      l.instagram_username, l.instagram_profile_pic_url, l.last_message,
      l.last_message_at, l.last_inbound_at, l.last_outbound_at, l.tags, l.source,
      l.stage_id, l.pipeline_id, l.created_at, l.updated_at, l.assigned_to,
      l.paciente_id, l.cidade, l.servico_interesse, l.imagem_origem, l.titulo_anuncio,
      l.descricao_anuncio, l.link_anuncio, l.ad_id, l.nome_anuncio, l.ad_account_id,
      l.ad_account_name, l.is_blocked,
      l.whatsapp_number_id,
      wn.display_name AS whatsapp_number_name
    FROM crm_leads l
    LEFT JOIN whatsapp_numbers wn ON wn.id = l.whatsapp_number_id
    WHERE l.tenant_id = v_tenant
      AND l.is_blocked = false
      AND ( v_super OR l.pipeline_id = ANY(v_pipes) )
      AND (
        CASE WHEN v_escopo_numero
          THEN l.whatsapp_number_id IS NOT NULL AND can_access_whatsapp_number(l.whatsapp_number_id)
          ELSE can_access_whatsapp_number(l.whatsapp_number_id)
        END
      )
      AND ( v_priv OR can_access_instagram_account(l.ig_account_uuid) )
    ORDER BY l.last_message_at DESC NULLS LAST
    LIMIT p_limit
  ) t;

  RETURN v_result;
END;
$function$;