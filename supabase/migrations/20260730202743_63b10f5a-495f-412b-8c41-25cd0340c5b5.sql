REVOKE ALL ON FUNCTION public.crm_lead_revert_or_delete(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_cleanup_contratado_sem_pagamento(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_lead_revert_or_delete(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_cleanup_contratado_sem_pagamento(uuid) TO service_role;