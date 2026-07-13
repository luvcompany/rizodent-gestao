DROP TRIGGER IF EXISTS trg_auto_unblock_lead_on_inbound ON public.messages;
DROP FUNCTION IF EXISTS public.auto_unblock_lead_on_inbound();