-- Tabela de log da limpeza/reversões do funil
CREATE TABLE IF NOT EXISTS public.crm_funil_cleanup_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  lead_id uuid,
  lead_name text,
  stage_from uuid,
  stage_to uuid,
  resultado text NOT NULL,
  detalhe text,
  origem text NOT NULL DEFAULT 'retro',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.crm_funil_cleanup_log TO authenticated;
GRANT ALL ON public.crm_funil_cleanup_log TO service_role;
ALTER TABLE public.crm_funil_cleanup_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "superadmin le log de limpeza do funil"
  ON public.crm_funil_cleanup_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'));

-- Regra canônica: reverter para etapa anterior, ou apagar, ou manter o lead.
CREATE OR REPLACE FUNCTION public.crm_lead_revert_or_delete(p_lead_id uuid, p_origem text DEFAULT 'paciente_delete')
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_lead record;
  v_prev uuid;
  v_has_conv boolean;
  v_res text;
  v_notify uuid;
BEGIN
  SELECT id, name, tenant_id, stage_id, assigned_to INTO v_lead
  FROM public.crm_leads WHERE id = p_lead_id;
  IF v_lead.id IS NULL THEN RETURN 'nao_encontrado'; END IF;

  -- etapa anterior: última etapa do histórico diferente da atual
  SELECT h.stage_id INTO v_prev
  FROM public.crm_lead_stage_history h
  WHERE h.lead_id = p_lead_id
    AND h.stage_id IS DISTINCT FROM v_lead.stage_id
  ORDER BY h.entered_at DESC
  LIMIT 1;

  IF v_prev IS NULL THEN
    SELECT h.from_stage_id INTO v_prev
    FROM public.crm_lead_stage_history h
    WHERE h.lead_id = p_lead_id
      AND h.from_stage_id IS NOT NULL
      AND h.from_stage_id IS DISTINCT FROM v_lead.stage_id
    ORDER BY h.entered_at DESC
    LIMIT 1;
  END IF;

  IF v_prev IS NOT NULL THEN
    UPDATE public.crm_leads SET stage_id = v_prev WHERE id = p_lead_id;
    v_res := 'movido';
    INSERT INTO public.crm_funil_cleanup_log (tenant_id, lead_id, lead_name, stage_from, stage_to, resultado, detalhe, origem)
    VALUES (v_lead.tenant_id, p_lead_id, v_lead.name, v_lead.stage_id, v_prev, v_res,
            (SELECT name FROM public.crm_stages WHERE id = v_prev), p_origem);
    RETURN v_res;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.lead_id = p_lead_id
      AND m.deleted_at IS NULL
      AND COALESCE(m.type, '') <> 'system'
      AND m.instagram_comment_id IS NULL
  ) INTO v_has_conv;

  IF v_has_conv THEN
    SELECT COALESCE(v_lead.assigned_to,
      (SELECT id FROM public.profiles WHERE tenant_id = v_lead.tenant_id ORDER BY created_at LIMIT 1))
    INTO v_notify;
    IF v_notify IS NOT NULL THEN
      INSERT INTO public.crm_notifications (user_id, lead_id, title, body, type, dedupe_key)
      VALUES (v_notify, p_lead_id, 'Conferir etapa do lead',
              'Paciente apagado; lead mantido por ter conversa — conferir etapa',
              'funil_integridade', 'funil_keep:' || p_lead_id::text)
      ON CONFLICT DO NOTHING;
    END IF;
    v_res := 'mantido';
    INSERT INTO public.crm_funil_cleanup_log (tenant_id, lead_id, lead_name, stage_from, stage_to, resultado, detalhe, origem)
    VALUES (v_lead.tenant_id, p_lead_id, v_lead.name, v_lead.stage_id, v_lead.stage_id, v_res, 'tem conversa real', p_origem);
    RETURN v_res;
  END IF;

  DELETE FROM public.crm_lead_pacientes WHERE lead_id = p_lead_id;
  DELETE FROM public.crm_lead_stage_history WHERE lead_id = p_lead_id;
  DELETE FROM public.crm_notifications WHERE lead_id = p_lead_id;
  DELETE FROM public.crm_tasks WHERE lead_id = p_lead_id;
  DELETE FROM public.crm_leads WHERE id = p_lead_id;
  v_res := 'apagado';
  INSERT INTO public.crm_funil_cleanup_log (tenant_id, lead_id, lead_name, stage_from, stage_to, resultado, detalhe, origem)
  VALUES (v_lead.tenant_id, p_lead_id, v_lead.name, v_lead.stage_id, NULL, v_res, 'sem etapa anterior e sem conversa', p_origem);
  RETURN v_res;
END;
$$;

-- Trigger BEFORE DELETE em pacientes — NUNCA pode bloquear o delete
CREATE OR REPLACE FUNCTION public.trg_paciente_delete_funil()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE r record;
BEGIN
  BEGIN
    FOR r IN
      SELECT lp.lead_id
      FROM public.crm_lead_pacientes lp
      JOIN public.crm_leads l ON l.id = lp.lead_id
      WHERE lp.paciente_id = OLD.id
        AND l.tenant_id = OLD.tenant_id
        AND NOT EXISTS (
          SELECT 1 FROM public.crm_lead_pacientes lp2
          WHERE lp2.lead_id = lp.lead_id AND lp2.paciente_id <> OLD.id
        )
    LOOP
      PERFORM public.crm_lead_revert_or_delete(r.lead_id, 'paciente_delete');
    END LOOP;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_paciente_delete_funil ON public.pacientes;
CREATE TRIGGER trg_paciente_delete_funil
BEFORE DELETE ON public.pacientes
FOR EACH ROW EXECUTE FUNCTION public.trg_paciente_delete_funil();

-- Limpeza retroativa: leads em "Contratado (ganho)" sem NENHUM pagamento atrás
CREATE OR REPLACE FUNCTION public.crm_cleanup_contratado_sem_pagamento(p_tenant_id uuid)
RETURNS TABLE(resultado text, qtd bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE r record; v text;
BEGIN
  FOR r IN
    SELECT l.id
    FROM public.crm_leads l
    JOIN public.crm_stages s ON s.id = l.stage_id
    WHERE l.tenant_id = p_tenant_id
      AND lower(translate(s.name, 'ãáâàéêíóôõúüç', 'aaaaeeiooouuc')) LIKE '%contratado%'
      AND lower(translate(s.name, 'ãáâàéêíóôõúüç', 'aaaaeeiooouuc')) NOT LIKE '%nao%'
      AND NOT EXISTS (
        SELECT 1 FROM public.crm_lead_pacientes lp
        JOIN public.pagamentos pg ON pg.paciente_id = lp.paciente_id
        WHERE lp.lead_id = l.id
      )
  LOOP
    BEGIN
      v := public.crm_lead_revert_or_delete(r.id, 'retro_contratado_sem_pagamento');
    EXCEPTION WHEN OTHERS THEN v := 'erro';
    END;
  END LOOP;

  RETURN QUERY
    SELECT c.resultado, count(*)::bigint
    FROM public.crm_funil_cleanup_log c
    WHERE c.origem = 'retro_contratado_sem_pagamento'
    GROUP BY c.resultado;
END;
$$;