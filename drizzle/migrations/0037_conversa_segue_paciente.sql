-- A conversa segue o paciente + "Responder por" (14/10/2026).
--
-- Decisão do dono (opção "b"): o paciente transferido da central para o closer
-- que volta a escrever no número da central cai na conversa do closer (sem
-- lead novo na central, sem rodízio), e quem atende escolhe por qual número
-- responde — o número da equipe dele ou, com a janela de 24h aberta, o número
-- em que o paciente escreveu.
--
--  - crm_leads.veio_da_equipe / transferido_de_equipe_em: carimbo da
--    transferência entre equipes (transfer-lead grava pela porta autorizada).
--  - lead_transferido_de_equipe: o webhook acha, para uma mensagem que chegou
--    num número da equipe X, o lead do mesmo telefone que saiu de X para outra
--    equipe.
--  - crm_leads.numero_resposta_id + definir_numero_resposta /
--    opcoes_numero_resposta: o "Responder por" da conversa. Vale número ativo
--    da equipe do lead (que a pessoa acessa) ou o número da janela aberta.
--  - numero_de_saida_do_lead (o "Vai sair por" da tela) espelha a regra de
--    _shared/numeroDeSaida.ts com as duas novidades.

ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS veio_da_equipe text;
ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS transferido_de_equipe_em timestamptz;
ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS numero_resposta_id uuid
  REFERENCES public.whatsapp_numbers(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.crm_leads.veio_da_equipe IS
  'Equipe (mundo) de onde o lead veio na última transferência entre equipes. Mensagem que chega num número dessa equipe vem para este lead.';
COMMENT ON COLUMN public.crm_leads.numero_resposta_id IS
  '"Responder por" escolhido na conversa. NULL = automático (janela aberta → número em que o paciente escreveu; senão o da equipe).';

-- Porta autorizada da transferência: aceita o carimbo de equipe e limpa o
-- "Responder por" quando o número do lead muda.
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
         numero_resposta_id = CASE WHEN p_payload ? 'whatsapp_number_id' THEN NULL ELSE numero_resposta_id END,
         veio_da_equipe     = CASE WHEN p_payload ? 'veio_da_equipe'     THEN NULLIF(p_payload->>'veio_da_equipe', '') ELSE veio_da_equipe END,
         transferido_de_equipe_em = CASE WHEN p_payload ? 'veio_da_equipe' THEN now() ELSE transferido_de_equipe_em END,
         updated_at         = now()
   WHERE id = p_lead_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $function$;
REVOKE ALL ON FUNCTION public.lead_transferir_autorizado(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_transferir_autorizado(uuid, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.lead_transferido_de_equipe(p_tenant uuid, p_phone text, p_mundo text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT l.id FROM public.crm_leads l
   WHERE l.tenant_id = p_tenant
     AND l.phone = public.telefone_canonico(p_phone)
     AND l.veio_da_equipe = public.normaliza_mundo(p_mundo)
     AND public.mundo_numero_whatsapp(l.tenant_id, l.whatsapp_number_id) <> public.normaliza_mundo(p_mundo)
   ORDER BY l.transferido_de_equipe_em DESC NULLS LAST
   LIMIT 1
$function$;
REVOKE ALL ON FUNCTION public.lead_transferido_de_equipe(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_transferido_de_equipe(uuid, text, text) TO service_role;

-- A pessoa logada enxerga este lead? (mesmas réguas das policies de crm_leads)
CREATE OR REPLACE FUNCTION public.posso_ver_lead(p_lead uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.crm_leads l
     WHERE l.id = p_lead
       AND (l.tenant_id = public.current_tenant_id() OR public.has_role(auth.uid(), 'superadmin'::app_role))
       AND public.can_access_whatsapp_number(l.whatsapp_number_id)
       AND public.closer_pode_ver_lead(l.id)
       AND public.recepcao_pode_ver_lead(l.id)
       AND (NOT public.has_role(auth.uid(), 'sdr'::app_role) OR public.sdr_pode_ver_lead(l.id))
  )
$function$;
REVOKE ALL ON FUNCTION public.posso_ver_lead(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.posso_ver_lead(uuid) TO authenticated, service_role;

-- Números por onde dá para responder este lead agora.
CREATE OR REPLACE FUNCTION public.opcoes_numero_resposta(p_lead uuid)
 RETURNS TABLE(numero_id uuid, display_name text, phone_e164 text, motivo text, janela_ate timestamptz, escolhido boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_lead record; v_mundo text; v_dono uuid; v_ult record;
BEGIN
  IF NOT public.posso_ver_lead(p_lead) THEN RETURN; END IF;
  SELECT l.id, l.tenant_id, l.whatsapp_number_id, l.numero_resposta_id INTO v_lead FROM public.crm_leads l WHERE l.id = p_lead;
  v_mundo := public.mundo_numero_whatsapp(v_lead.tenant_id, v_lead.whatsapp_number_id);
  SELECT w.dono_user_id INTO v_dono FROM public.whatsapp_numbers w WHERE w.id = v_lead.whatsapp_number_id;
  SELECT m.whatsapp_number_id, m.created_at INTO v_ult
    FROM public.messages m
   WHERE m.lead_id = p_lead AND m.direction = 'inbound' AND m.whatsapp_number_id IS NOT NULL
   ORDER BY m.created_at DESC LIMIT 1;

  RETURN QUERY
  SELECT w.id, w.display_name, w.phone_e164,
         CASE WHEN COALESCE(w.mundo, 'crc') = v_mundo THEN 'equipe' ELSE 'janela' END,
         CASE WHEN w.id = v_ult.whatsapp_number_id AND v_ult.created_at > now() - interval '24 hours'
              THEN v_ult.created_at + interval '24 hours' END,
         w.id = v_lead.numero_resposta_id
    FROM public.whatsapp_numbers w
   WHERE w.tenant_id = v_lead.tenant_id AND w.is_active
     AND (
       (COALESCE(w.mundo, 'crc') = v_mundo
         AND (v_mundo NOT IN ('closer', 'recepcao') OR v_dono IS NULL OR w.dono_user_id IS NULL OR w.dono_user_id = v_dono)
         AND public.can_access_whatsapp_number(w.id))
       OR (w.id = v_ult.whatsapp_number_id AND v_ult.created_at > now() - interval '24 hours')
     )
   ORDER BY 4, w.is_default DESC, w.created_at;
END $function$;
REVOKE ALL ON FUNCTION public.opcoes_numero_resposta(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.opcoes_numero_resposta(uuid) TO authenticated, service_role;

-- Grava o "Responder por" (NULL = automático).
CREATE OR REPLACE FUNCTION public.definir_numero_resposta(p_lead uuid, p_numero uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.posso_ver_lead(p_lead) THEN
    RAISE EXCEPTION 'Você não tem acesso a este lead.' USING ERRCODE = '42501';
  END IF;
  IF p_numero IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.opcoes_numero_resposta(p_lead) o WHERE o.numero_id = p_numero) THEN
    RAISE EXCEPTION 'Este número não pode responder este lead agora (a janela de 24h dele fechou ou ele é de outra equipe).' USING ERRCODE = '42501';
  END IF;
  UPDATE public.crm_leads SET numero_resposta_id = p_numero, updated_at = now() WHERE id = p_lead;
END $function$;
REVOKE ALL ON FUNCTION public.definir_numero_resposta(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.definir_numero_resposta(uuid, uuid) TO authenticated, service_role;

-- "Vai sair por" da tela, espelho de _shared/numeroDeSaida.ts (envio manual).
CREATE OR REPLACE FUNCTION public.numero_de_saida_do_lead(p_lead_id uuid)
 RETURNS TABLE(numero_id uuid, origem text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead  record;
  v_mundo text;
  v_dono  uuid;
  v_ult   record;
  v_janela boolean;
BEGIN
  SELECT l.id, l.tenant_id, l.whatsapp_number_id, l.pipeline_id, l.numero_resposta_id
    INTO v_lead
    FROM public.crm_leads l
   WHERE l.id = p_lead_id;
  IF v_lead.id IS NULL THEN RETURN; END IF;

  v_mundo := public.mundo_numero_whatsapp(v_lead.tenant_id, v_lead.whatsapp_number_id);
  SELECT w.dono_user_id INTO v_dono FROM public.whatsapp_numbers w WHERE w.id = v_lead.whatsapp_number_id;

  SELECT m.whatsapp_number_id, m.created_at
    INTO v_ult
    FROM public.messages m
   WHERE m.lead_id = p_lead_id
     AND m.direction = 'inbound'
     AND m.whatsapp_number_id IS NOT NULL
   ORDER BY m.created_at DESC
   LIMIT 1;
  v_janela := v_ult.created_at > now() - interval '24 hours';

  RETURN QUERY
  WITH cand(id, prio, origem) AS (
    SELECT v_lead.numero_resposta_id, 0, 'escolhido' WHERE v_lead.numero_resposta_id IS NOT NULL
    UNION ALL SELECT v_ult.whatsapp_number_id, 1, 'janela' WHERE v_janela
    UNION ALL SELECT v_lead.whatsapp_number_id, 2, 'lead'
    UNION ALL SELECT v_ult.whatsapp_number_id, 3, 'ultima_entrada'
    UNION ALL
    SELECT w.id, 4, 'padrao' FROM public.whatsapp_numbers w
     WHERE w.tenant_id = v_lead.tenant_id AND w.is_default
    UNION ALL
    SELECT w.id, 5, 'funil'
      FROM public.funnel_channels fc
      JOIN public.integrations i ON i.tenant_id = fc.tenant_id AND i.key = fc.channel_config->>'integration_key'
      JOIN public.whatsapp_numbers w ON w.tenant_id = i.tenant_id AND w.phone_number_id = i.config->>'phone_number_id'
     WHERE fc.tenant_id = v_lead.tenant_id AND fc.pipeline_id = v_lead.pipeline_id AND fc.channel_type = 'whatsapp'
    UNION ALL
    SELECT w.id, 6, 'principal'
      FROM public.integrations i
      JOIN public.whatsapp_numbers w ON w.tenant_id = i.tenant_id AND w.phone_number_id = i.config->>'phone_number_id'
     WHERE i.tenant_id = v_lead.tenant_id AND i.key = 'whatsapp_config'
    UNION ALL
    SELECT w.id, 7, 'equipe' FROM public.whatsapp_numbers w WHERE w.tenant_id = v_lead.tenant_id
  )
  SELECT c.id, c.origem
    FROM cand c
    JOIN public.whatsapp_numbers w ON w.id = c.id
   WHERE w.tenant_id = v_lead.tenant_id
     AND w.is_active
     AND (
       (COALESCE(w.mundo, 'crc') = v_mundo
         AND (v_mundo NOT IN ('closer', 'recepcao') OR v_dono IS NULL OR w.dono_user_id IS NULL OR w.dono_user_id = v_dono))
       -- Outra equipe só o número da janela aberta (onde o paciente escreveu).
       OR (c.prio IN (0, 1) AND v_janela AND w.id = v_ult.whatsapp_number_id)
     )
     AND COALESCE(w.phone_number_id, '') <> ''
     AND NOT EXISTS (SELECT 1 FROM public.integrations i
                      WHERE i.tenant_id = w.tenant_id AND i.key LIKE 'whatsapp%'
                        AND i.config->>'phone_number_id' = w.phone_number_id
                        AND i.status = 'disabled')
     AND (COALESCE(w.token, '') <> ''
          OR EXISTS (SELECT 1 FROM public.integrations i
                      WHERE i.tenant_id = w.tenant_id AND i.key LIKE 'whatsapp%'
                        AND i.config->>'phone_number_id' = w.phone_number_id
                        AND COALESCE(i.config->>'access_token', i.config->>'token', '') <> ''))
   ORDER BY c.prio, w.created_at
   LIMIT 1;
END;
$function$;

-- Selo "Vai sair por" do compositor: o número da janela aberta (ou o
-- escolhido em "Responder por") pode ser de outra equipe — quem vê o lead pode
-- responder por ele; antes a tela travava o envio como "sem acesso ao número".
CREATE OR REPLACE FUNCTION public.numero_de_envio_do_lead(p_lead_id uuid)
 RETURNS TABLE(numero_id uuid, tenant_id uuid, nome text, phone_e164 text, waba_id text, origem text, conectado boolean, pronto boolean, pausado boolean, acessivel boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_lead  record;
  v_saida record;
  v_super boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida. Entre de novo.' USING ERRCODE = '42501';
  END IF;
  v_super := public.has_role(v_uid, 'superadmin'::app_role);

  SELECT l.id, l.tenant_id, l.whatsapp_number_id INTO v_lead FROM public.crm_leads l WHERE l.id = p_lead_id;
  IF v_lead.id IS NULL OR (v_lead.tenant_id IS DISTINCT FROM public.current_tenant_id() AND NOT v_super) THEN
    RAISE EXCEPTION 'Lead não encontrado.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_access_whatsapp_number(v_lead.whatsapp_number_id) THEN
    RAISE EXCEPTION 'Você não tem acesso ao número de WhatsApp deste lead.' USING ERRCODE = '42501';
  END IF;
  IF public.has_role(v_uid, 'sdr'::app_role) AND NOT v_super AND NOT public.sdr_pode_ver_lead(p_lead_id) THEN
    RAISE EXCEPTION 'Lead não encontrado.' USING ERRCODE = '42501';
  END IF;

  SELECT s.numero_id, s.origem INTO v_saida FROM public.numero_de_saida_do_lead(p_lead_id) s;
  IF v_saida.numero_id IS NULL THEN
    RETURN;  -- nenhum número ativo da equipe do lead: "WhatsApp desconectado"
  END IF;

  IF NOT v_super AND v_saida.origem NOT IN ('janela', 'escolhido')
     AND NOT public.can_access_whatsapp_number(v_saida.numero_id) THEN
    RETURN QUERY SELECT NULL::uuid, v_lead.tenant_id, NULL::text, NULL::text, NULL::text,
                        CASE v_saida.origem WHEN 'funil' THEN 'funil' WHEN 'janela' THEN 'lead' WHEN 'lead' THEN 'lead'
                                            WHEN 'escolhido' THEN 'lead' WHEN 'ultima_entrada' THEN 'lead' ELSE 'padrao' END,
                        false, false, false, false;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT w.id,
         w.tenant_id,
         COALESCE(NULLIF(btrim(w.display_name), ''), w.phone_e164, 'WhatsApp'),
         w.phone_e164,
         NULLIF(btrim(w.waba_id), ''),
         CASE v_saida.origem WHEN 'funil' THEN 'funil' WHEN 'janela' THEN 'lead' WHEN 'lead' THEN 'lead'
                             WHEN 'escolhido' THEN 'lead' WHEN 'ultima_entrada' THEN 'lead' ELSE 'padrao' END,
         ok.ok,
         ok.ok,
         false,
         true
    FROM public.whatsapp_numbers w
    CROSS JOIN LATERAL (
      SELECT NOT EXISTS (SELECT 1 FROM public.integrations i
                          WHERE i.tenant_id = w.tenant_id AND i.key LIKE 'whatsapp%'
                            AND i.config->>'phone_number_id' = w.phone_number_id
                            AND i.health_status = 'error') AS ok
    ) ok
   WHERE w.id = v_saida.numero_id;
END;
$function$;
