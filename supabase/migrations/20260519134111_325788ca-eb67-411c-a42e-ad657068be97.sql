create index if not exists idx_crm_leads_pipeline_blocked_position
on public.crm_leads (pipeline_id, is_blocked, position);

create index if not exists idx_crm_leads_tenant_blocked_last_message
on public.crm_leads (tenant_id, is_blocked, last_message_at desc nulls last);

create index if not exists idx_crm_leads_tenant_blocked_inbound
on public.crm_leads (tenant_id, is_blocked, last_inbound_at desc nulls last);

create index if not exists idx_messages_lead_created
on public.messages (lead_id, created_at);

create index if not exists idx_crm_tasks_status_due_date
on public.crm_tasks (status, due_date);

create index if not exists idx_followup_queue_status_lead
on public.crm_followup_queue (status, lead_id);

create index if not exists idx_crm_lead_pacientes_paciente_primary_lead
on public.crm_lead_pacientes (paciente_id, is_primary, lead_id);

create index if not exists idx_pagamentos_data_paciente_valor
on public.pagamentos (data_pagamento, paciente_id) include (valor);