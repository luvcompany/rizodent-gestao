
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.notify_dashboard_event(
  p_tipo text,
  p_cidade text,
  p_source text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  BEGIN
    PERFORM net.http_post(
      url := 'https://rizodent-vision.lovable.app/api/public/ingest-crm-event',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-ingest-secret', 'c297c94d6feb3c75804eb5ca4254586c5a325880660a237f'
      ),
      body := jsonb_build_object(
        'tipo', p_tipo,
        'cidade', p_cidade,
        'source', p_source,
        'ts', now()
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_notify_dashboard_lead_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM public.notify_dashboard_event('lead', NEW.cidade, NEW.source);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_notify_dashboard_appointment_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM public.notify_dashboard_event('agendamento', NEW.lead_cidade, NULL);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_dashboard_lead ON public.crm_leads;
CREATE TRIGGER trg_notify_dashboard_lead
AFTER INSERT ON public.crm_leads
FOR EACH ROW
WHEN (
  NEW.tenant_id = '00000000-0000-0000-0000-000000000010'::uuid
  AND (NEW.source IS DISTINCT FROM 'Retroativo')
)
EXECUTE FUNCTION public.trg_notify_dashboard_lead_fn();

DROP TRIGGER IF EXISTS trg_notify_dashboard_appointment ON public.crm_appointments;
CREATE TRIGGER trg_notify_dashboard_appointment
AFTER INSERT ON public.crm_appointments
FOR EACH ROW
WHEN (NEW.tenant_id = '00000000-0000-0000-0000-000000000010'::uuid)
EXECUTE FUNCTION public.trg_notify_dashboard_appointment_fn();
