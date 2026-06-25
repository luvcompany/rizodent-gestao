
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS crm_leads_tenant_lastmsg_idx
  ON public.crm_leads (tenant_id, is_blocked, last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS messages_content_trgm_idx
  ON public.messages USING gin (content gin_trgm_ops);
CREATE INDEX IF NOT EXISTS messages_tenant_lead_created_idx
  ON public.messages (tenant_id, lead_id, created_at);
