-- Agendamento para outra pessoa do mesmo contato (13/10/2026).
--
-- Um telefone = um lead por equipe (regra do banco). Quando a mãe do lead quer
-- consultar também, as SDRs tentavam criar um segundo lead com o mesmo número
-- (o banco recusa) ou sem número (proibido desde 07/10). O jeito certo é o do
-- Kommo: o mesmo contato pode ter mais de uma consulta. A consulta guarda o
-- nome de quem vai ser atendido; os relatórios contam consulta por consulta,
-- então "casal/familiar conta 2" continua valendo.

ALTER TABLE public.crm_appointments ADD COLUMN IF NOT EXISTS paciente_nome text;
COMMENT ON COLUMN public.crm_appointments.paciente_nome IS
  'Quem será atendido, quando não é o próprio lead (familiar com o mesmo telefone). NULL = o lead.';

CREATE OR REPLACE FUNCTION public.populate_appointment_lead_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_name text;
  v_cidade text;
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    SELECT name, cidade INTO v_name, v_cidade
    FROM public.crm_leads
    WHERE id = NEW.lead_id;
    -- Consulta de outra pessoa do mesmo contato: agenda e relatórios mostram
    -- o nome de quem vai ser atendido.
    NEW.lead_name := coalesce(nullif(btrim(NEW.paciente_nome), ''), v_name);
    NEW.lead_cidade := v_cidade;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS populate_appt_lead_snapshot ON public.crm_appointments;
CREATE TRIGGER populate_appt_lead_snapshot
  BEFORE INSERT OR UPDATE OF lead_id, paciente_nome ON public.crm_appointments
  FOR EACH ROW EXECUTE FUNCTION public.populate_appointment_lead_snapshot();
