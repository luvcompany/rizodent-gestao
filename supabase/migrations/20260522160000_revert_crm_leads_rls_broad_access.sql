-- Reverte a política RLS de SELECT em crm_leads que permitia CRC/gerente
-- lerem TODOS os leads do tenant (incluindo Pós-Venda).
--
-- Por que reverter:
-- A política ampla fazia leads do Pós-Venda aparecerem nas listas de
-- Conversas e no Kanban do CRC. Isso polui a operação do CRC com leads
-- que já não são responsabilidade dele.
--
-- Como mantemos o calendário funcionando sem essa política ampla:
--   1. crm_appointments tem colunas denormalizadas lead_name/lead_cidade
--      (populadas por trigger) — não dependem de RLS em crm_leads
--   2. RPC get_leads_for_calendar(uuid[]) com SECURITY DEFINER permite
--      o calendário buscar nome/cidade de qualquer lead do tenant
--   3. RPC get_lead_for_conversation(uuid) com SECURITY DEFINER permite
--      abrir a conversa de um lead contratado pelo calendário

DROP POLICY IF EXISTS "Users can view assigned or own leads in allowed pipelines" ON public.crm_leads;

CREATE POLICY "Users can view assigned or own leads in allowed pipelines"
ON public.crm_leads FOR SELECT TO authenticated
USING (
  tenant_id = current_tenant_id()
  AND public.can_access_pipeline(pipeline_id)
  AND public.can_access_whatsapp_number(whatsapp_number_id)
  AND public.can_access_instagram_account(ig_account_uuid)
);
