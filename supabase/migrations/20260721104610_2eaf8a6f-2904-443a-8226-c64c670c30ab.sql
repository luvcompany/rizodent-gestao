
CREATE OR REPLACE FUNCTION public.notify_dashboard_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  -- Restrito ao tenant Rizodent. Fire-and-forget: qualquer erro é engolido
  -- para NUNCA travar o INSERT de mensagem (pg_net já é assíncrono).
  BEGIN
    IF NEW.tenant_id = '00000000-0000-0000-0000-000000000010'::uuid THEN
      PERFORM public.notify_dashboard_event(
        'conversa',
        NULL,
        CASE WHEN NEW.direction = 'inbound' THEN 'in' ELSE 'out' END
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_dashboard_message ON public.messages;
CREATE TRIGGER trg_notify_dashboard_message
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.notify_dashboard_message();
