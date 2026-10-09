-- "Transferir para o WhatsApp" voltou a funcionar (09/10/2026).
--
-- A tela (LeadEditPanel) chama transfer_lead_to_whatsapp(p_lead_id, p_phone)
-- desde o redesign de 01/10; o banco só tinha a versão de um parâmetro, e a
-- chamada falhava sempre ("function not found"). Esta versão:
--   - aceita o telefone digitado na hora (p_phone) e grava no lead;
--   - acha o card duplicado pelo telefone como o banco grava
--     (telefone_canonico — com ou sem o 9) e pela EQUIPE do número
--     (mundo_numero_whatsapp), não pelo id do número;
--   - confere quem chama como a leitura do lead (conversa_lead_visivel).
-- Códigos de recusa: os mesmos que a tela traduz (motivoDaTransferencia).

DROP FUNCTION IF EXISTS public.transfer_lead_to_whatsapp(uuid);

CREATE OR REPLACE FUNCTION public.transfer_lead_to_whatsapp(p_lead_id uuid, p_phone text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead   public.crm_leads;
  v_fone   text;
  v_chave  text;
  v_mundo  text;
  v_dup    record;
  v_final  text;
  v_caller_tenant uuid;
  v_sdr    boolean := public.has_role(auth.uid(), 'sdr'::app_role);
BEGIN
  SELECT l.* INTO v_lead FROM public.crm_leads l WHERE l.id = p_lead_id;
  IF v_lead.id IS NULL THEN
    RETURN jsonb_build_object('error', 'lead_not_found');
  END IF;

  IF NOT public.can_access_whatsapp_number(v_lead.whatsapp_number_id) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT tenant_id INTO v_caller_tenant FROM public.profiles WHERE id = auth.uid();
  IF v_caller_tenant IS NULL OR v_caller_tenant <> v_lead.tenant_id THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  IF NOT (public.closer_pode_ver_lead(p_lead_id) AND public.recepcao_pode_ver_lead(p_lead_id)) THEN
    RETURN jsonb_build_object('error', 'forbidden_number_scope');
  END IF;

  IF v_sdr AND NOT public.sdr_pode_ver_lead(p_lead_id) THEN
    RETURN jsonb_build_object('error', 'forbidden_number_scope');
  END IF;

  -- Função SECURITY DEFINER que grava no lead: só no lead que quem chama vê.
  IF public.conversa_lead_visivel(v_lead) IS NOT TRUE THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  IF p_phone IS NOT NULL AND btrim(p_phone) <> '' THEN
    v_fone := regexp_replace(p_phone, '[^0-9]', '', 'g');
    IF length(v_fone) < 8 OR length(v_fone) > 15 THEN
      RETURN jsonb_build_object('error', 'invalid_phone');
    END IF;
  END IF;
  v_chave := public.telefone_canonico(COALESCE(v_fone, v_lead.phone));
  IF v_chave IS NULL OR v_chave = '' THEN
    RETURN jsonb_build_object('error', 'no_phone');
  END IF;

  -- Um telefone = um lead por EQUIPE: o duplicado é do mesmo mundo do lead.
  v_mundo := public.mundo_numero_whatsapp(v_lead.tenant_id, v_lead.whatsapp_number_id);
  SELECT dup.id, dup.phone, dup.whatsapp_number_id, dup.assigned_to INTO v_dup
    FROM public.crm_leads dup
   WHERE dup.tenant_id = v_lead.tenant_id
     AND dup.id <> p_lead_id
     AND COALESCE(dup.is_blocked, false) = false
     AND dup.phone = v_chave
     AND public.mundo_numero_whatsapp(dup.tenant_id, dup.whatsapp_number_id) = v_mundo
     AND (NOT v_sdr OR dup.assigned_to = auth.uid())
   ORDER BY dup.created_at ASC
   LIMIT 1;

  -- A SDR não junta card de outra dona nem converte em silêncio.
  IF v_sdr AND v_dup.id IS NULL AND EXISTS (
       SELECT 1 FROM public.crm_leads dup
        WHERE dup.tenant_id = v_lead.tenant_id
          AND dup.id <> p_lead_id
          AND COALESCE(dup.is_blocked, false) = false
          AND dup.phone = v_chave
          AND public.mundo_numero_whatsapp(dup.tenant_id, dup.whatsapp_number_id) = v_mundo) THEN
    RETURN jsonb_build_object('error', 'duplicado_de_outra_dona');
  END IF;

  -- Junta e grava num bloco só: telefone já usado por outro card que não foi
  -- juntado (bloqueado, por exemplo) desfaz tudo.
  BEGIN
    IF v_dup.id IS NOT NULL THEN
      UPDATE public.messages  SET lead_id = p_lead_id WHERE lead_id = v_dup.id;
      UPDATE public.crm_tasks SET lead_id = p_lead_id WHERE lead_id = v_dup.id;
      -- O card juntado fica bloqueado e SEM telefone, senão a próxima
      -- mensagem do paciente poderia cair nele.
      UPDATE public.crm_leads
         SET is_blocked = true, blocked_at = now(), phone = NULL, updated_at = now()
       WHERE id = v_dup.id;
    END IF;

    UPDATE public.crm_leads
       SET active_channel = 'whatsapp',
           phone = COALESCE(v_fone, phone),
           updated_at = now()
     WHERE id = p_lead_id
     RETURNING phone INTO v_final;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('error', 'telefone_em_uso');
  END;

  IF v_dup.id IS NOT NULL THEN
    INSERT INTO public.access_logs (user_id, tenant_id, context, event, metadata)
    VALUES (auth.uid(), v_lead.tenant_id, 'tenant', 'lead_mesclado_na_transferencia',
            jsonb_build_object('lead_mantido', p_lead_id, 'lead_juntado', v_dup.id, 'telefone', v_dup.phone,
                               'whatsapp_number_id', v_dup.whatsapp_number_id, 'assigned_to', v_dup.assigned_to));
  END IF;

  RETURN jsonb_build_object('ok', true, 'merged', v_dup.id IS NOT NULL, 'merged_lead_id', v_dup.id,
                            'phone', v_final);
END;
$function$;

REVOKE ALL ON FUNCTION public.transfer_lead_to_whatsapp(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_lead_to_whatsapp(uuid, text) TO authenticated, service_role;
