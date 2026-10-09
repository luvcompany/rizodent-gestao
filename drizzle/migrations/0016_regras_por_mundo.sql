-- Regras do banco por MUNDO, não por id de número (09/10/2026).
--
-- "Lead central" era escrito como `whatsapp_number_id IS NULL` (o número
-- principal legado). Desde que o número oficial passou a carimbar os leads
-- novos (09/10, 16:54), esses leads deixaram de: vincular paciente do Dontus
-- automaticamente, entrar no rodízio das SDRs e ser achados como duplicados ao
-- cadastrar. A regra agora é a mesma da 0014: o mundo do número
-- (mundo_numero_whatsapp) — o central inclui o legado e TODOS os números
-- centrais, e conectar um número novo não muda nada.

-- 1) Vínculo automático lead ↔ paciente do Dontus: só no mundo central.
CREATE OR REPLACE FUNCTION public.auto_link_lead_to_paciente()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_last8 text;
  v_pac_id uuid;
  v_count int;
BEGIN
  -- O vínculo automático vale só no mundo central (CRC/SDR). Lead do closer ou
  -- da recepção é vinculado À MÃO, na tela do próprio perfil — senão um
  -- paciente do Dontus grudaria num lead de outra equipe só por coincidência
  -- de telefone.
  IF public.mundo_numero_whatsapp(NEW.tenant_id, NEW.whatsapp_number_id) <> 'crc' THEN RETURN NEW; END IF;

  IF NEW.phone IS NULL OR NEW.paciente_id IS NOT NULL THEN RETURN NEW; END IF;
  v_last8 := right(regexp_replace(NEW.phone,'[^0-9]','','g'), 8);
  IF length(v_last8) < 8 THEN RETURN NEW; END IF;

  SELECT count(*) INTO v_count
    FROM public.pacientes p
   WHERE p.tenant_id = NEW.tenant_id
     AND right(regexp_replace(p.telefone,'[^0-9]','','g'), 8) = v_last8
     AND NOT EXISTS (SELECT 1 FROM public.crm_lead_pacientes lp WHERE lp.paciente_id = p.id);

  IF v_count = 1 THEN
    SELECT p.id INTO v_pac_id
      FROM public.pacientes p
     WHERE p.tenant_id = NEW.tenant_id
       AND right(regexp_replace(p.telefone,'[^0-9]','','g'), 8) = v_last8
       AND NOT EXISTS (SELECT 1 FROM public.crm_lead_pacientes lp WHERE lp.paciente_id = p.id)
     LIMIT 1;

    INSERT INTO public.crm_lead_pacientes (lead_id, paciente_id, is_primary)
    VALUES (NEW.id, v_pac_id, true)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.auto_link_paciente_to_lead()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_last8 text;
  v_lead_id uuid;
  v_count int;
BEGIN
  IF NEW.telefone IS NULL THEN RETURN NEW; END IF;
  v_last8 := right(regexp_replace(NEW.telefone,'[^0-9]','','g'), 8);
  IF length(v_last8) < 8 THEN RETURN NEW; END IF;

  IF EXISTS (SELECT 1 FROM public.crm_lead_pacientes WHERE paciente_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- Só leads do MUNDO CENTRAL: paciente que vem do Dontus pertence à operação
  -- do CRC e não pode grudar num lead do closer/recepção por coincidência de
  -- telefone (aqueles são vinculados à mão).
  SELECT count(*) INTO v_count
    FROM public.crm_leads l
   WHERE l.tenant_id = NEW.tenant_id
     AND public.mundo_numero_whatsapp(l.tenant_id, l.whatsapp_number_id) = 'crc'
     AND l.paciente_id IS NULL
     AND right(regexp_replace(l.phone,'[^0-9]','','g'), 8) = v_last8;

  IF v_count = 1 THEN
    SELECT l.id INTO v_lead_id
      FROM public.crm_leads l
     WHERE l.tenant_id = NEW.tenant_id
       AND public.mundo_numero_whatsapp(l.tenant_id, l.whatsapp_number_id) = 'crc'
       AND l.paciente_id IS NULL
       AND right(regexp_replace(l.phone,'[^0-9]','','g'), 8) = v_last8
     LIMIT 1;

    INSERT INTO public.crm_lead_pacientes (lead_id, paciente_id, is_primary)
    VALUES (v_lead_id, NEW.id, true)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.auto_link_paciente_to_lead_on_pagamento()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_paciente record; v_clinica_nome text; v_tail text; v_lead record;
  v_lead_count int; v_multi_note text; v_user record; v_title text; v_body text;
BEGIN
  IF NEW.recorrencia_orto IS TRUE THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.crm_lead_pacientes WHERE paciente_id = NEW.paciente_id) THEN
    RETURN NEW;
  END IF;
  SELECT id, nome, telefone, tenant_id INTO v_paciente FROM public.pacientes WHERE id = NEW.paciente_id;
  IF v_paciente.id IS NULL OR v_paciente.tenant_id IS NULL THEN RETURN NEW; END IF;
  v_tail := regexp_replace(coalesce(v_paciente.telefone,''), '[^0-9]', '', 'g');
  IF length(v_tail) < 8 THEN RETURN NEW; END IF;
  v_tail := right(v_tail, 8);
  SELECT count(*) INTO v_lead_count FROM public.crm_leads l
   WHERE l.tenant_id = v_paciente.tenant_id
     AND public.mundo_numero_whatsapp(l.tenant_id, l.whatsapp_number_id) = 'crc'
     AND right(regexp_replace(coalesce(l.phone,''), '[^0-9]', '', 'g'), 8) = v_tail;
  IF v_lead_count = 0 THEN RETURN NEW; END IF;
  SELECT l.id, l.name INTO v_lead FROM public.crm_leads l
   WHERE l.tenant_id = v_paciente.tenant_id
     AND public.mundo_numero_whatsapp(l.tenant_id, l.whatsapp_number_id) = 'crc'
     AND right(regexp_replace(coalesce(l.phone,''), '[^0-9]', '', 'g'), 8) = v_tail
   ORDER BY l.created_at DESC LIMIT 1;
  INSERT INTO public.crm_lead_pacientes (lead_id, paciente_id, is_primary)
  VALUES (v_lead.id, v_paciente.id, true) ON CONFLICT (lead_id, paciente_id) DO NOTHING;
  SELECT nome INTO v_clinica_nome FROM public.clinicas WHERE id = NEW.clinica_id;
  v_multi_note := CASE WHEN v_lead_count > 1
    THEN format(' (havia %s leads com este telefone — vinculado ao mais recente)', v_lead_count) ELSE '' END;
  v_title := 'Paciente pago sem origem Kommo — vinculado por telefone';
  v_body := format('Paciente: %s%s%s | Telefone: %s | Lead: %s (id %s) | Valor: R$ %s | Data: %s | Clínica: %s%s',
    v_paciente.nome, E'\n', '', v_paciente.telefone, coalesce(v_lead.name, '—'), v_lead.id,
    to_char(NEW.valor, 'FM999G999G990D00'), to_char(NEW.data_pagamento, 'DD/MM/YYYY'),
    coalesce(v_clinica_nome, '—'), v_multi_note);
  FOR v_user IN SELECT DISTINCT p.id FROM public.profiles p JOIN public.user_roles ur ON ur.user_id = p.id
     WHERE p.tenant_id = v_paciente.tenant_id AND ur.role IN ('crc','gerente','superadmin')
  LOOP
    INSERT INTO public.crm_notifications (user_id, type, title, body, lead_id, is_read)
    VALUES (v_user.id, 'warning', v_title, v_body, v_lead.id, false);
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END;
$function$;

-- 2) Telefone repetido ao cadastrar: dentro do MESMO MUNDO (não do mesmo id).
CREATE OR REPLACE FUNCTION public.check_duplicate_phone(p_phone text, _whatsapp_number_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(lead_id uuid, lead_name text, assigned_to uuid, pipeline_name text, stage_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH d AS (SELECT regexp_replace(coalesce(p_phone,''), '[^0-9]', '', 'g') v),
  n AS (SELECT CASE
     WHEN length(v) IN (12,13) AND left(v,2)='55' THEN '55'||substr(v,3,2)||right(v,8)
     WHEN length(v) IN (10,11) THEN '55'||left(v,2)||right(v,8)
     ELSE v END AS k FROM d)
  SELECT l.id,
         CASE WHEN m.oculta THEN NULL ELSE l.name END,
         CASE WHEN m.oculta THEN NULL ELSE l.assigned_to END,
         CASE WHEN m.oculta THEN NULL ELSE p.name END,
         CASE WHEN m.oculta THEN NULL ELSE s.name END
  FROM n, public.crm_leads l
  CROSS JOIN LATERAL (
    SELECT public.has_role(auth.uid(), 'sdr'::public.app_role)
           AND l.assigned_to IS DISTINCT FROM auth.uid() AS oculta
  ) m
  LEFT JOIN public.crm_pipelines p ON p.id = l.pipeline_id
  LEFT JOIN public.crm_stages s ON s.id = l.stage_id
  WHERE (l.phone = p_phone OR l.phone = n.k
         OR (length(l.phone)=13 AND '55'||substr(l.phone,3,2)||right(l.phone,8) = n.k))
    AND public.mundo_numero_whatsapp(l.tenant_id, l.whatsapp_number_id)
        = public.mundo_numero_whatsapp(l.tenant_id, _whatsapp_number_id)
    AND public.can_access_whatsapp_number(l.whatsapp_number_id)
    AND (l.tenant_id = public.current_tenant_id()
      OR public.has_role(auth.uid(), 'superadmin'::public.app_role))
  LIMIT 1;
$function$;

-- 3) Rodízio: o lead entra se é do mundo do rodízio (central, ou o mundo do
--    número configurado), com qualquer número desse mundo — não só o legado.
CREATE OR REPLACE FUNCTION public.rodizio_lead_na_fila(p_lead crm_leads, p_admin uuid, p_funil uuid, p_numero uuid, p_etapas uuid[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT (p_lead).id IS NOT NULL
     -- Multi-funil: o lead entra se o funil dele é um dos funis do rodízio.
     -- COALESCE externo porque "= ANY (ARRAY[NULL])" devolveria NULL, e quem
     -- chama faz "IF NOT rodizio_lead_na_fila(...)" — NULL ali distribuiria o
     -- lead em vez de barrá-lo.
     AND (p_lead).pipeline_id IS NOT NULL
     AND COALESCE((p_lead).pipeline_id = ANY (COALESCE(public.rodizio_funis((p_lead).tenant_id), ARRAY[p_funil])), false)
     AND p_etapas IS NOT NULL AND (p_lead).stage_id = ANY (p_etapas)
     AND NOT COALESCE((p_lead).is_blocked, false)
     AND (p_lead).conversa_fechada_em IS NULL
     AND (p_lead).distribuido_em IS NULL
     AND (p_lead).rodizio_reservado_para IS NULL
     AND ((p_lead).assigned_to IS NULL OR (p_admin IS NOT NULL AND (p_lead).assigned_to = p_admin))
     AND NOT public.rodizio_fonte_excluida((p_lead).source)
     AND (p_lead).ig_account_uuid IS NULL
     -- Mundo, não id: lead carimbado com o número oficial (ou qualquer outro
     -- número central) entra no rodízio como o lead do número legado.
     AND public.mundo_numero_whatsapp((p_lead).tenant_id, (p_lead).whatsapp_number_id)
         = CASE WHEN p_numero IS NULL THEN 'crc'
                ELSE public.mundo_numero_whatsapp((p_lead).tenant_id, p_numero) END
     -- Consulta marcada só segura o lead quando a entrada é restrita.
     AND (EXISTS (SELECT 1 FROM public.crm_rodizio_config c
                   WHERE c.tenant_id = (p_lead).tenant_id AND c.entrada_todas_etapas)
          OR NOT EXISTS (SELECT 1 FROM public.crm_appointments a
                          WHERE a.lead_id = (p_lead).id AND COALESCE(a.status, '') <> 'cancelled'))
     -- Ciclo encerrado é do administrador: etapa que a SDR não vê, comparecimento
     -- DOS ÚLTIMOS 30 DIAS, ou entrega ao administrador agendada. Comparecimento
     -- antigo não segura mais o lead: paciente que volta meses depois é lead de
     -- reativação e precisa de dona.
     AND NOT EXISTS (SELECT 1 FROM public.crm_stages s
                      WHERE s.id = (p_lead).stage_id AND NOT COALESCE(s.visivel_para_sdr, true))
     AND NOT EXISTS (SELECT 1 FROM public.crm_appointments a
                      WHERE a.lead_id = (p_lead).id
                        AND a.status IN ('contracted', 'not_contracted')
                        AND a.scheduled_date >= (now() AT TIME ZONE 'America/Bahia')::date - 30)
     AND NOT EXISTS (SELECT 1 FROM public.crm_entregas_gestor e WHERE e.lead_id = (p_lead).id);
$function$;
