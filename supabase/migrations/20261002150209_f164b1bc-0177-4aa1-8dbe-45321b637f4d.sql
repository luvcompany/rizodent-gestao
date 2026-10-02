ALTER FUNCTION public.relatorio_agendamentos(date, date) SECURITY DEFINER;
REVOKE EXECUTE ON FUNCTION public.relatorio_agendamentos(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.relatorio_agendamentos(date, date) TO authenticated;
CREATE INDEX IF NOT EXISTS crm_appointments_tenant_lead_date_idx ON public.crm_appointments(tenant_id, lead_id, scheduled_date);