-- As RPCs que as telas chamam e não existiam no banco (09/10/2026).
--
-- O redesign de 01/10 trouxe telas do v2 que chamam funções criadas só nas
-- migrations do v2 (nunca aplicadas aqui). Cada chamada falhava e a tela caía
-- num caminho antigo:
--   - modelos_do_lead: o chat listava os modelos de TODAS as contas (WABAs) do
--     cliente — escolher o de outra conta dava "Template não existe";
--   - numero_de_envio_do_lead: o chat não sabia por qual número ia sair nem se
--     ele estava desconectado (só descobria no erro do envio);
--   - agenda_quantas_unidades: a agenda adivinhava se separa por cidade.
-- Aqui elas existem no esquema do CRClin e seguem a MESMA regra do servidor
-- (supabase/functions/_shared/numeroDeSaida.ts).

-- 1) Número de saída (núcleo, interno): mesma ordem do numeroDeSaida.ts.
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
BEGIN
  SELECT l.id, l.tenant_id, l.whatsapp_number_id, l.pipeline_id
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

  RETURN QUERY
  WITH cand(id, prio, origem) AS (
    SELECT v_ult.whatsapp_number_id, 1, 'janela' WHERE v_ult.created_at > now() - interval '24 hours'
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
     AND COALESCE(w.mundo, 'crc') = v_mundo
     AND (v_mundo NOT IN ('closer', 'recepcao') OR v_dono IS NULL OR w.dono_user_id IS NULL OR w.dono_user_id = v_dono)
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
COMMENT ON FUNCTION public.numero_de_saida_do_lead(uuid) IS
  'Número de WhatsApp pelo qual o servidor fala com o lead — mesma ordem de _shared/numeroDeSaida.ts (janela de 24h do número em que o paciente escreveu → número do lead → último número usado → padrão → canal do funil → principal → qualquer ativo da equipe). Interna: só service_role e as RPCs abaixo.';
REVOKE ALL ON FUNCTION public.numero_de_saida_do_lead(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.numero_de_saida_do_lead(uuid) TO service_role;

-- 2) Número de envio do lead para a tela (selo e trava do compositor).
DROP FUNCTION IF EXISTS public.numero_de_envio_do_lead(uuid);
CREATE OR REPLACE FUNCTION public.numero_de_envio_do_lead(p_lead_id uuid)
 RETURNS TABLE(numero_id uuid, tenant_id uuid, nome text, phone_e164 text, waba_id text, origem text,
               conectado boolean, pronto boolean, pausado boolean, acessivel boolean)
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

  IF NOT v_super AND NOT public.can_access_whatsapp_number(v_saida.numero_id) THEN
    RETURN QUERY SELECT NULL::uuid, v_lead.tenant_id, NULL::text, NULL::text, NULL::text,
                        CASE v_saida.origem WHEN 'funil' THEN 'funil' WHEN 'janela' THEN 'lead' WHEN 'lead' THEN 'lead'
                                            WHEN 'ultima_entrada' THEN 'lead' ELSE 'padrao' END,
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
                             WHEN 'ultima_entrada' THEN 'lead' ELSE 'padrao' END,
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
COMMENT ON FUNCTION public.numero_de_envio_do_lead(uuid) IS
  'Por qual número o servidor vai falar com o lead (numero_de_saida_do_lead) e se dá para enviar agora (conectado/pronto). Confere quem chama: sessão, cliente, número do lead, SDR. 0 linha = equipe sem número ativo; acessivel=false = quem chama não envia por ele.';
REVOKE ALL ON FUNCTION public.numero_de_envio_do_lead(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.numero_de_envio_do_lead(uuid) TO authenticated, service_role;

-- 3) Modelos do lead: só os da conta (WABA) do número de envio.
CREATE OR REPLACE FUNCTION public.modelos_do_lead(p_lead_id uuid)
 RETURNS TABLE(id uuid, name text, language text, category text, status text, body_text text,
               header_type text, header_content text, footer_text text, buttons jsonb,
               waba_id text, whatsapp_number_id uuid, owner_role app_role,
               created_at timestamptz, updated_at timestamptz, numero_de_envio_id uuid)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v record;
BEGIN
  SELECT e.numero_id, e.tenant_id, e.waba_id INTO v FROM public.numero_de_envio_do_lead(p_lead_id) e LIMIT 1;
  IF v.numero_id IS NULL THEN RETURN; END IF;

  -- SECURITY INVOKER: a RLS de crm_whatsapp_templates recorta por papel.
  RETURN QUERY
  SELECT t.id, t.name, t.language, t.category, t.status, t.body_text,
         t.header_type, t.header_content, t.footer_text, t.buttons,
         t.waba_id, t.whatsapp_number_id, t.owner_role,
         t.created_at, t.updated_at, v.numero_id
    FROM public.crm_whatsapp_templates t
   WHERE t.tenant_id = v.tenant_id
     AND t.status = 'APPROVED'
     AND (CASE WHEN v.waba_id IS NOT NULL THEN t.waba_id = v.waba_id
               ELSE t.whatsapp_number_id = v.numero_id END)
   ORDER BY t.updated_at DESC, t.created_at DESC;
END;
$function$;
COMMENT ON FUNCTION public.modelos_do_lead(uuid) IS
  'Modelos APPROVED da conta (WABA) do número de envio do lead, sob a RLS de quem chama. A tela deduplica dentro da WABA.';
REVOKE ALL ON FUNCTION public.modelos_do_lead(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.modelos_do_lead(uuid) TO authenticated, service_role;

-- 4) Quantas unidades ativas o cliente tem (a agenda separa por cidade com 2+).
CREATE OR REPLACE FUNCTION public.agenda_quantas_unidades()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT count(*)::integer
    FROM public.clinicas c
   WHERE c.tenant_id = public.current_tenant_id()
     AND c.ativa
     AND auth.uid() IS NOT NULL;
$function$;
REVOKE ALL ON FUNCTION public.agenda_quantas_unidades() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agenda_quantas_unidades() TO authenticated, service_role;
