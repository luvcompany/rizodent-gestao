-- Transferência de lead entre equipes (14/10/2026).
--
-- Trocar só o responsável deixava o lead na equipe de origem: atribuído ao
-- closer e invisível para ele (cada pessoa só vê os leads do número da sua
-- equipe). A transfer-lead agora muda o lead de equipe — número, funil e
-- etapa — pela porta autorizada lead_transferir_autorizado, que passa a
-- aceitar whatsapp_number_id (o gatilho valida_troca_numero_do_lead só vale
-- para usuário logado; a function já conferiu tudo antes).
--
-- O histórico vai junto: as mensagens antigas continuam gravadas com o
-- número por onde passaram (é o que a Meta registrou), e quem enxerga o LEAD
-- passa a ler a conversa inteira dele. Antes a leitura de mensagem exigia
-- acesso ao número da própria mensagem — o closer receberia o lead sem o
-- histórico da central.

CREATE OR REPLACE FUNCTION public.lead_transferir_autorizado(p_lead_id uuid, p_payload jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_n integer;
BEGIN
  IF p_lead_id IS NULL OR p_payload IS NULL THEN RETURN 0; END IF;
  PERFORM set_config('rodizio.autorizado', 'sim', true);
  UPDATE public.crm_leads
     SET assigned_to        = CASE WHEN p_payload ? 'assigned_to'        THEN NULLIF(p_payload->>'assigned_to', '')::uuid ELSE assigned_to END,
         distribuido_em     = CASE WHEN p_payload ? 'distribuido_em'     THEN (p_payload->>'distribuido_em')::timestamptz ELSE distribuido_em END,
         pipeline_id        = CASE WHEN p_payload ? 'pipeline_id'        THEN (p_payload->>'pipeline_id')::uuid ELSE pipeline_id END,
         stage_id           = CASE WHEN p_payload ? 'stage_id'           THEN (p_payload->>'stage_id')::uuid ELSE stage_id END,
         whatsapp_number_id = CASE WHEN p_payload ? 'whatsapp_number_id' THEN NULLIF(p_payload->>'whatsapp_number_id', '')::uuid ELSE whatsapp_number_id END,
         updated_at         = now()
   WHERE id = p_lead_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $function$;
REVOKE ALL ON FUNCTION public.lead_transferir_autorizado(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_transferir_autorizado(uuid, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.lead_da_minha_equipe(_lead_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.crm_leads l
     WHERE l.id = _lead_id
       AND l.whatsapp_number_id IS NOT NULL
       AND public.can_access_whatsapp_number(l.whatsapp_number_id)
  );
$function$;
REVOKE ALL ON FUNCTION public.lead_da_minha_equipe(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_da_minha_equipe(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS mensagens_do_lead_da_equipe ON public.messages;
CREATE POLICY mensagens_do_lead_da_equipe ON public.messages
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND lead_id IS NOT NULL
    AND public.lead_da_minha_equipe(lead_id)
  );
