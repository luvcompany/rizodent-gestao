
-- Desbloqueia o lead Nenê 😎 (caso reportado)
UPDATE public.crm_leads
SET is_blocked = false, blocked_at = NULL, blocked_by = NULL
WHERE id = 'd86b915f-66aa-41f3-bf3a-3e8ac5f55cf4';

-- Trigger: quando um lead bloqueado recebe uma nova mensagem inbound (real, não do sistema),
-- desbloqueia automaticamente para não sumir da caixa de entrada.
CREATE OR REPLACE FUNCTION public.auto_unblock_lead_on_inbound()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.direction = 'inbound' AND COALESCE(NEW.status, '') <> 'system' AND NEW.lead_id IS NOT NULL THEN
    UPDATE public.crm_leads
    SET is_blocked = false,
        blocked_at = NULL,
        blocked_by = NULL
    WHERE id = NEW.lead_id AND is_blocked = true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_unblock_lead_on_inbound ON public.messages;
CREATE TRIGGER trg_auto_unblock_lead_on_inbound
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.auto_unblock_lead_on_inbound();
