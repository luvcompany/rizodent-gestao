-- Junction table: lead can have multiple patients
CREATE TABLE IF NOT EXISTS public.crm_lead_pacientes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  paciente_id uuid NOT NULL REFERENCES public.pacientes(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(lead_id, paciente_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_lead_pacientes_lead ON public.crm_lead_pacientes(lead_id);
CREATE INDEX IF NOT EXISTS idx_crm_lead_pacientes_paciente ON public.crm_lead_pacientes(paciente_id);

ALTER TABLE public.crm_lead_pacientes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view crm_lead_pacientes" ON public.crm_lead_pacientes
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff can insert crm_lead_pacientes" ON public.crm_lead_pacientes
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Staff can update crm_lead_pacientes" ON public.crm_lead_pacientes
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Admins and managers can delete crm_lead_pacientes" ON public.crm_lead_pacientes
  FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'gerente'::app_role));

-- Backfill: every existing lead.paciente_id becomes a primary link
INSERT INTO public.crm_lead_pacientes (lead_id, paciente_id, is_primary)
SELECT id, paciente_id, true FROM public.crm_leads
WHERE paciente_id IS NOT NULL
ON CONFLICT (lead_id, paciente_id) DO NOTHING;

-- Trigger: keep crm_leads.paciente_id in sync with the primary link
CREATE OR REPLACE FUNCTION public.sync_lead_primary_paciente()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') AND NEW.is_primary THEN
    -- Ensure only one primary per lead
    UPDATE public.crm_lead_pacientes
       SET is_primary = false
     WHERE lead_id = NEW.lead_id AND id <> NEW.id AND is_primary = true;
    UPDATE public.crm_leads SET paciente_id = NEW.paciente_id WHERE id = NEW.lead_id;
  END IF;
  IF (TG_OP = 'DELETE' AND OLD.is_primary) THEN
    -- Promote another link to primary, or clear paciente_id
    UPDATE public.crm_lead_pacientes
       SET is_primary = true
     WHERE id = (SELECT id FROM public.crm_lead_pacientes WHERE lead_id = OLD.lead_id ORDER BY created_at ASC LIMIT 1);
    UPDATE public.crm_leads SET paciente_id = (
      SELECT paciente_id FROM public.crm_lead_pacientes WHERE lead_id = OLD.lead_id AND is_primary = true LIMIT 1
    ) WHERE id = OLD.lead_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS sync_lead_primary_paciente_trg ON public.crm_lead_pacientes;
CREATE TRIGGER sync_lead_primary_paciente_trg
AFTER INSERT OR UPDATE OR DELETE ON public.crm_lead_pacientes
FOR EACH ROW EXECUTE FUNCTION public.sync_lead_primary_paciente();