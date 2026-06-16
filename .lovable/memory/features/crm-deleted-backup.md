---
name: Deleted Leads Backup (Lixeira)
description: 30-day soft retention for deleted leads + messages, with restore. Trigger on crm_leads BEFORE DELETE snapshots everything into deleted_leads_backup.
type: feature
---
- Trigger `snapshot_lead_before_delete` em `crm_leads` BEFORE DELETE salva snapshot completo (lead + messages + instagram_messages) na tabela `deleted_leads_backup`.
- Retenção: 30 dias. Cron diário `cleanup-expired-lead-backups` (03:00 UTC) chama `cleanup_expired_lead_backups()`.
- Restauração via RPC `restore_deleted_lead(_backup_id)` — recria o lead (reusa ID se livre) e reinsere mensagens; pula stage se a etapa não existir mais.
- UI: aba **Lixeira** em `CrmConfiguracoes` (`/crm/configuracoes`). Restaurar, visualizar mensagens, ou apagar definitivamente (apenas gerente/superadmin).
- Tenant-scoped via RLS; superadmin vê tudo.
