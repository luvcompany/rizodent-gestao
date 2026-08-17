-- 1. Colunas
ALTER TABLE public.crm_appointments
  ADD COLUMN IF NOT EXISTS rescheduled_from_id uuid,
  ADD COLUMN IF NOT EXISTS outcome_by uuid,
  ADD COLUMN IF NOT EXISTS outcome_at timestamptz,
  ADD COLUMN IF NOT EXISTS outcome_source text,
  ADD COLUMN IF NOT EXISTS cancelled_reason text;

-- 2. Auditoria
CREATE TABLE IF NOT EXISTS public.crm_appointments_audit (
  id bigserial PRIMARY KEY,
  appointment_id uuid NOT NULL,
  tenant_id uuid,
  action text NOT NULL,
  old_row jsonb,
  new_row jsonb,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_appointments_audit_appt_idx ON public.crm_appointments_audit(appointment_id);
CREATE INDEX IF NOT EXISTS crm_appointments_audit_changed_at_idx ON public.crm_appointments_audit(changed_at);

GRANT SELECT ON public.crm_appointments_audit TO authenticated;
GRANT ALL ON public.crm_appointments_audit TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.crm_appointments_audit_id_seq TO service_role;
ALTER TABLE public.crm_appointments_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Managers can read appointment audit" ON public.crm_appointments_audit;
CREATE POLICY "Managers can read appointment audit"
  ON public.crm_appointments_audit FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'gerente'::app_role) OR has_role(auth.uid(), 'superadmin'::app_role));

CREATE OR REPLACE FUNCTION public.audit_crm_appointments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  INSERT INTO public.crm_appointments_audit (appointment_id, tenant_id, action, old_row, new_row, changed_by)
  VALUES (
    COALESCE(NEW.id, OLD.id),
    COALESCE(NEW.tenant_id, OLD.tenant_id),
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
    auth.uid()
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_crm_appointments ON public.crm_appointments;
CREATE TRIGGER trg_audit_crm_appointments
AFTER INSERT OR UPDATE OR DELETE ON public.crm_appointments
FOR EACH ROW EXECUTE FUNCTION public.audit_crm_appointments();

-- 3. BEFORE INSERT
CREATE OR REPLACE FUNCTION public.stamp_appointment_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_lead uuid;
BEGIN
  NEW.is_rescheduled := (NEW.rescheduled_from_id IS NOT NULL);

  IF NEW.rescheduled_from_id IS NOT NULL THEN
    SELECT lead_id INTO v_lead FROM public.crm_appointments WHERE id = NEW.rescheduled_from_id;
    IF v_lead IS NULL OR v_lead IS DISTINCT FROM NEW.lead_id THEN
      RAISE EXCEPTION 'Agendamento de origem inválido para remarcação';
    END IF;
  END IF;

  IF auth.uid() IS NOT NULL THEN
    NEW.confirmed_by := auth.uid();
    NEW.created_at := now();
    NEW.confirmed_at := COALESCE(NEW.confirmed_at, now());
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_appointment_insert ON public.crm_appointments;
CREATE TRIGGER trg_stamp_appointment_insert
BEFORE INSERT ON public.crm_appointments
FOR EACH ROW EXECUTE FUNCTION public.stamp_appointment_insert();

-- 4. BEFORE UPDATE
CREATE OR REPLACE FUNCTION public.stamp_appointment_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  terminais text[] := ARRAY['contracted','not_contracted','no_show','rescheduled','cancelled'];
  is_service boolean := (auth.uid() IS NULL);
  is_manager boolean := (auth.uid() IS NOT NULL AND (has_role(auth.uid(),'gerente'::app_role) OR has_role(auth.uid(),'superadmin'::app_role)));
BEGIN
  -- (a) carimbo do desfecho
  IF OLD.status IN ('confirmed','pending') AND NEW.status = ANY(terminais) THEN
    NEW.outcome_at := now();
    IF NOT is_service THEN
      NEW.outcome_by := auth.uid();
      IF pg_trigger_depth() > 1 AND NEW.outcome_source = 'auto_stage_contratado' THEN
        NULL;
      ELSE
        NEW.outcome_source := 'ui';
      END IF;
    ELSE
      NEW.outcome_by := NULL;
      NEW.outcome_source := COALESCE(NEW.outcome_source, 'service');
    END IF;
  END IF;

  -- (b) reabrir bloqueado
  IF OLD.status = ANY(terminais) AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (is_service OR is_manager) THEN
      RAISE EXCEPTION 'Desfecho já registrado — reabertura é ação de gerente';
    END IF;
    IF NEW.status = 'confirmed' THEN
      NEW.outcome_by := NULL;
      NEW.outcome_at := NULL;
      NEW.outcome_source := NULL;
    END IF;
  END IF;

  -- (c) imutabilidade
  IF NOT is_service THEN
    IF NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by THEN
      RAISE EXCEPTION 'confirmed_by é imutável';
    END IF;
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'created_at é imutável';
    END IF;
    IF OLD.confirmed_at IS NOT NULL AND NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN
      RAISE EXCEPTION 'confirmed_at é imutável';
    END IF;
    IF OLD.rescheduled_from_id IS NOT NULL AND NEW.rescheduled_from_id IS DISTINCT FROM OLD.rescheduled_from_id THEN
      RAISE EXCEPTION 'rescheduled_from_id é imutável';
    END IF;
  END IF;

  NEW.is_rescheduled := (NEW.rescheduled_from_id IS NOT NULL);

  IF OLD.status = ANY(terminais)
     AND (NEW.scheduled_date IS DISTINCT FROM OLD.scheduled_date
          OR NEW.scheduled_time IS DISTINCT FROM OLD.scheduled_time)
     AND NOT (is_service OR is_manager) THEN
    RAISE EXCEPTION 'Data/hora não podem ser alteradas após o desfecho';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_appointment_update ON public.crm_appointments;
CREATE TRIGGER trg_stamp_appointment_update
BEFORE UPDATE ON public.crm_appointments
FOR EACH ROW EXECUTE FUNCTION public.stamp_appointment_update();

-- 5. auto_confirm_appointments_on_contracted
CREATE OR REPLACE FUNCTION public.auto_confirm_appointments_on_contracted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_stage_name text;
  v_normalized text;
  v_is_contracted boolean := false;
  v_appt_id uuid;
BEGIN
  IF NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
    RETURN NEW;
  END IF;

  SELECT name INTO v_stage_name FROM public.crm_stages WHERE id = NEW.stage_id;
  IF v_stage_name IS NULL THEN
    RETURN NEW;
  END IF;

  v_normalized := lower(translate(v_stage_name,
    'ÁÀÃÂÄáàãâäÉÈÊËéèêëÍÌÎÏíìîïÓÒÕÔÖóòõôöÚÙÛÜúùûüÇç',
    'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc'));

  IF (v_normalized = 'contratado' OR v_normalized = 'contratados'
      OR (v_normalized LIKE '%contrat%' AND v_normalized NOT LIKE '%nao contrat%'))
  THEN
    v_is_contracted := true;
  END IF;

  IF NOT v_is_contracted THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_appt_id
    FROM public.crm_appointments
   WHERE lead_id = NEW.id
     AND status = 'confirmed'
     AND scheduled_date <= (now() AT TIME ZONE 'America/Bahia')::date
   ORDER BY scheduled_date DESC, scheduled_time DESC NULLS LAST
   LIMIT 1;

  IF v_appt_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.crm_appointments
     SET status = 'contracted',
         outcome_source = 'auto_stage_contratado',
         updated_at = now()
   WHERE id = v_appt_id;

  RETURN NEW;
END;
$$;

-- 6. auto_confirm_appointments_on_stage_change
CREATE OR REPLACE FUNCTION public.auto_confirm_appointments_on_stage_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF OLD.stage_id IS NOT DISTINCT FROM NEW.stage_id THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.crm_automations
    WHERE stage_id = NEW.stage_id
      AND trigger_type = 'before_scheduled'
      AND is_active = true
  )
  AND lower(coalesce((SELECT name FROM public.crm_stages WHERE id = NEW.stage_id),'')) NOT LIKE '%reagend%'
  THEN
    UPDATE public.crm_appointments
    SET status = 'confirmed'
    WHERE lead_id = NEW.id
      AND status = 'pending';
  END IF;

  RETURN NEW;
END;
$$;

-- 7. Histórico de etapas
DROP POLICY IF EXISTS "Staff can update crm_lead_stage_history" ON public.crm_lead_stage_history;
DROP POLICY IF EXISTS "Admins can delete crm_lead_stage_history" ON public.crm_lead_stage_history;
CREATE POLICY "Managers can delete crm_lead_stage_history"
  ON public.crm_lead_stage_history FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'gerente'::app_role) OR has_role(auth.uid(), 'superadmin'::app_role));