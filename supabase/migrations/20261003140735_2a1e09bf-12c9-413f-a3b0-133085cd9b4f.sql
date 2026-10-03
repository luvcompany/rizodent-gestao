ALTER TABLE public.crm_leads
  ADD COLUMN IF NOT EXISTS last_instagram_interaction_type text
  CHECK (last_instagram_interaction_type IN ('comment', 'dm'));

CREATE INDEX IF NOT EXISTS idx_crm_leads_tenant_instagram_interaction
  ON public.crm_leads (tenant_id, last_instagram_interaction_type, last_message_at DESC)
  WHERE active_channel = 'instagram';

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
  v_dona boolean;
  v_pipes uuid[];
  v_pipes_ig uuid[];
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
  v_dona := has_role(v_uid, 'sdr'::app_role);

  SELECT COALESCE(array_agg(p.id), ARRAY[]::uuid[]) INTO v_pipes
  FROM crm_pipelines p
  WHERE p.tenant_id = v_tenant
    AND COALESCE(
      user_override(v_uid, 'pipeline', p.id::text),
      v_super OR (p.allowed_roles IS NULL AND (v_crc OR v_gerente))
      OR EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = v_uid AND ur.role = ANY(p.allowed_roles))
    )
    AND (v_posvenda OR v_super OR NOT COALESCE(p.is_posvenda, false));

  SELECT COALESCE(array_agg(p.id), ARRAY[]::uuid[]) INTO v_pipes_ig
  FROM crm_pipelines p
  WHERE p.tenant_id = v_tenant AND COALESCE(p.is_instagram, false);

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.last_message_at DESC NULLS LAST), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT l.id, l.name, l.phone, l.instagram_user_id, l.active_channel,
      l.instagram_username, l.instagram_profile_pic_url, l.last_message,
      l.last_message_at, l.last_inbound_at, l.last_outbound_at, l.tags, l.source,
      l.stage_id, l.pipeline_id, l.created_at, l.updated_at, l.assigned_to,
      l.paciente_id, l.cidade, l.servico_interesse, l.imagem_origem, l.titulo_anuncio,
      l.descricao_anuncio, l.link_anuncio, l.ad_id, l.nome_anuncio, l.ad_account_id,
      l.ad_account_name, l.is_blocked, l.last_instagram_interaction_type,
      l.whatsapp_number_id, l.conversa_fechada_em, l.conversa_fechada_auto,
      wn.display_name AS whatsapp_number_name
    FROM crm_leads l
    LEFT JOIN whatsapp_numbers wn ON wn.id = l.whatsapp_number_id
    WHERE l.tenant_id = v_tenant
      AND l.is_blocked = false
      AND (v_super OR l.pipeline_id = ANY(v_pipes))
      AND (
        CASE WHEN v_escopo_numero
          THEN l.whatsapp_number_id IS NOT NULL AND can_access_whatsapp_number(l.whatsapp_number_id)
          ELSE can_access_whatsapp_number(l.whatsapp_number_id)
        END
      )
      AND (v_priv OR can_access_instagram_account(l.ig_account_uuid))
      AND (
        NOT v_dona
        OR l.assigned_to = v_uid
        OR (l.assigned_to IS NULL AND l.pipeline_id = ANY(v_pipes_ig))
      )
    ORDER BY l.last_message_at DESC NULLS LAST
    LIMIT p_limit
  ) t;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_conversation_leads(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_conversation_leads(uuid, integer) TO authenticated, service_role;