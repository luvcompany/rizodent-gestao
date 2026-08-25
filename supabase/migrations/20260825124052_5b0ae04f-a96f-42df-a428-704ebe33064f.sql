-- Etapa 17 FASE 1 — isolamento por número ("cada número é um mundo").

-- 3) Policies com escopo: closer/recepcao só mexem em funis do PRÓPRIO papel.
CREATE OR REPLACE FUNCTION public.funil_do_papel_do_usuario(_pipeline_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.crm_pipelines p
    WHERE p.id = _pipeline_id
      AND p.allowed_roles::text[] && ARRAY(
        SELECT ur.role::text FROM public.user_roles ur
        WHERE ur.user_id = auth.uid() AND ur.role IN ('closer','recepcao')
      )
  );
$$;
REVOKE ALL ON FUNCTION public.funil_do_papel_do_usuario(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.funil_do_papel_do_usuario(uuid) TO authenticated, service_role;

-- crm_automations se liga à ETAPA; o funil vem por crm_stages.
CREATE OR REPLACE FUNCTION public.funil_do_papel_do_usuario_por_etapa(_stage_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.crm_stages s
    WHERE s.id = _stage_id AND public.funil_do_papel_do_usuario(s.pipeline_id)
  );
$$;
REVOKE ALL ON FUNCTION public.funil_do_papel_do_usuario_por_etapa(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.funil_do_papel_do_usuario_por_etapa(uuid) TO authenticated, service_role;

-- crm_pipelines: o funil precisa permitir o papel do usuário.
DROP POLICY IF EXISTS recepcao_closer_ins_crm_pipelines ON public.crm_pipelines;
DROP POLICY IF EXISTS recepcao_closer_upd_crm_pipelines ON public.crm_pipelines;
DROP POLICY IF EXISTS recepcao_closer_del_crm_pipelines ON public.crm_pipelines;

CREATE POLICY recepcao_closer_ins_crm_pipelines ON public.crm_pipelines
  FOR INSERT TO authenticated
  WITH CHECK (
    (has_role(auth.uid(),'recepcao'::app_role) OR has_role(auth.uid(),'closer'::app_role))
    AND allowed_roles::text[] && ARRAY(
      SELECT ur.role::text FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role IN ('closer','recepcao')
    )
  );

CREATE POLICY recepcao_closer_upd_crm_pipelines ON public.crm_pipelines
  FOR UPDATE TO authenticated
  USING (
    (has_role(auth.uid(),'recepcao'::app_role) OR has_role(auth.uid(),'closer'::app_role))
    AND allowed_roles::text[] && ARRAY(
      SELECT ur.role::text FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role IN ('closer','recepcao')
    )
  )
  WITH CHECK (
    (has_role(auth.uid(),'recepcao'::app_role) OR has_role(auth.uid(),'closer'::app_role))
    AND allowed_roles::text[] && ARRAY(
      SELECT ur.role::text FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role IN ('closer','recepcao')
    )
  );

CREATE POLICY recepcao_closer_del_crm_pipelines ON public.crm_pipelines
  FOR DELETE TO authenticated
  USING (
    (has_role(auth.uid(),'recepcao'::app_role) OR has_role(auth.uid(),'closer'::app_role))
    AND allowed_roles::text[] && ARRAY(
      SELECT ur.role::text FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role IN ('closer','recepcao')
    )
  );

-- crm_stages / crm_automations / funnel_channels: mesmo teste via pipeline_id.
DROP POLICY IF EXISTS recepcao_closer_ins_crm_stages ON public.crm_stages;
DROP POLICY IF EXISTS recepcao_closer_upd_crm_stages ON public.crm_stages;
DROP POLICY IF EXISTS recepcao_closer_del_crm_stages ON public.crm_stages;

CREATE POLICY recepcao_closer_ins_crm_stages ON public.crm_stages
  FOR INSERT TO authenticated
  WITH CHECK ((has_role(auth.uid(),'recepcao'::app_role) OR has_role(auth.uid(),'closer'::app_role))
    AND public.funil_do_papel_do_usuario(pipeline_id));
CREATE POLICY recepcao_closer_upd_crm_stages ON public.crm_stages
  FOR UPDATE TO authenticated
  USING ((has_role(auth.uid(),'recepcao'::app_role) OR has_role(auth.uid(),'closer'::app_role))
    AND public.funil_do_papel_do_usuario(pipeline_id))
  WITH CHECK ((has_role(auth.uid(),'recepcao'::app_role) OR has_role(auth.uid(),'closer'::app_role))
    AND public.funil_do_papel_do_usuario(pipeline_id));
CREATE POLICY recepcao_closer_del_crm_stages ON public.crm_stages
  FOR DELETE TO authenticated
  USING ((has_role(auth.uid(),'recepcao'::app_role) OR has_role(auth.uid(),'closer'::app_role))
    AND public.funil_do_papel_do_usuario(pipeline_id));

DROP POLICY IF EXISTS recepcao_closer_ins_crm_automations ON public.crm_automations;
DROP POLICY IF EXISTS recepcao_closer_upd_crm_automations ON public.crm_automations;
DROP POLICY IF EXISTS recepcao_closer_del_crm_automations ON public.crm_automations;

CREATE POLICY recepcao_closer_ins_crm_automations ON public.crm_automations
  FOR INSERT TO authenticated
  WITH CHECK ((has_role(auth.uid(),'recepcao'::app_role) OR has_role(auth.uid(),'closer'::app_role))
    AND public.funil_do_papel_do_usuario_por_etapa(stage_id));
CREATE POLICY recepcao_closer_upd_crm_automations ON public.crm_automations
  FOR UPDATE TO authenticated
  USING ((has_role(auth.uid(),'recepcao'::app_role) OR has_role(auth.uid(),'closer'::app_role))
    AND public.funil_do_papel_do_usuario_por_etapa(stage_id))
  WITH CHECK ((has_role(auth.uid(),'recepcao'::app_role) OR has_role(auth.uid(),'closer'::app_role))
    AND public.funil_do_papel_do_usuario_por_etapa(stage_id));
CREATE POLICY recepcao_closer_del_crm_automations ON public.crm_automations
  FOR DELETE TO authenticated
  USING ((has_role(auth.uid(),'recepcao'::app_role) OR has_role(auth.uid(),'closer'::app_role))
    AND public.funil_do_papel_do_usuario_por_etapa(stage_id));

DROP POLICY IF EXISTS recepcao_closer_ins_funnel_channels ON public.funnel_channels;
DROP POLICY IF EXISTS recepcao_closer_upd_funnel_channels ON public.funnel_channels;
DROP POLICY IF EXISTS recepcao_closer_del_funnel_channels ON public.funnel_channels;

CREATE POLICY recepcao_closer_ins_funnel_channels ON public.funnel_channels
  FOR INSERT TO authenticated
  WITH CHECK ((has_role(auth.uid(),'recepcao'::app_role) OR has_role(auth.uid(),'closer'::app_role))
    AND public.funil_do_papel_do_usuario(pipeline_id));
CREATE POLICY recepcao_closer_upd_funnel_channels ON public.funnel_channels
  FOR UPDATE TO authenticated
  USING ((has_role(auth.uid(),'recepcao'::app_role) OR has_role(auth.uid(),'closer'::app_role))
    AND public.funil_do_papel_do_usuario(pipeline_id))
  WITH CHECK ((has_role(auth.uid(),'recepcao'::app_role) OR has_role(auth.uid(),'closer'::app_role))
    AND public.funil_do_papel_do_usuario(pipeline_id));
CREATE POLICY recepcao_closer_del_funnel_channels ON public.funnel_channels
  FOR DELETE TO authenticated
  USING ((has_role(auth.uid(),'recepcao'::app_role) OR has_role(auth.uid(),'closer'::app_role))
    AND public.funil_do_papel_do_usuario(pipeline_id));

-- crm_automation_queue: escrita só via service_role (workers ignoram RLS).
DROP POLICY IF EXISTS "Staff can insert crm_automation_queue" ON public.crm_automation_queue;
DROP POLICY IF EXISTS "Staff can update crm_automation_queue" ON public.crm_automation_queue;
DROP POLICY IF EXISTS "Staff can delete crm_automation_queue" ON public.crm_automation_queue;

CREATE POLICY crm_aq_closer_number_scope ON public.crm_automation_queue
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.closer_pode_ver_lead(lead_id));
CREATE POLICY crm_aq_recepcao_number_scope ON public.crm_automation_queue
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.recepcao_pode_ver_lead(lead_id));

-- 5) Canal de funil de WhatsApp determinístico: uma linha por integration_key.
DELETE FROM public.funnel_channels fc
USING public.funnel_channels keep
WHERE fc.channel_type = 'whatsapp' AND keep.channel_type = 'whatsapp'
  AND fc.tenant_id IS NOT DISTINCT FROM keep.tenant_id
  AND (fc.channel_config->>'integration_key') = (keep.channel_config->>'integration_key')
  AND (fc.channel_config->>'integration_key') IS NOT NULL
  AND (keep.created_at, keep.id) > (fc.created_at, fc.id);

CREATE UNIQUE INDEX IF NOT EXISTS funnel_channels_whatsapp_key_uniq
  ON public.funnel_channels (tenant_id, channel_type, (channel_config->>'integration_key'))
  WHERE channel_type = 'whatsapp';

-- 6) get_conversation_leads: closer/recepcao nunca veem o mundo legado (NULL).
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
  -- Espelho das policies closer/recepcao_number_scope_leads: para esses papéis o
  -- lead PRECISA ter carimbo de número concedido (mundo legado NULL é invisível).
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
      l.ad_account_name, l.is_blocked
    FROM crm_leads l
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