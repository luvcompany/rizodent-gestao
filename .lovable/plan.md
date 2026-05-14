## Causa raiz

A LUV Agency está vendo leads da Rizodent (e vice-versa) porque o RLS de várias tabelas tem **duas políticas permissivas** que são combinadas com OR:

1. `tenant_isolation` — exige `tenant_id = current_tenant_id()` ✅
2. `Users can view assigned or own leads` (e similares) — permite admin/gerente ver tudo, **sem checar tenant** ❌

Como políticas permissivas são unidas por OR no Postgres, um admin da LUV passa pela segunda política e enxerga leads de qualquer tenant. Por isso o lead `Vitor Santos | Tecladista` (Instagram da LUV) aparece também no CRM da Rizodent, e leads da Rizodent aparecem na LUV inclusive na aba WhatsApp.

Isso afeta `crm_leads`, mas provavelmente também `messages`, `crm_appointments`, `crm_tasks`, `crm_stages`, `crm_pipelines`, `pacientes`, `bots`, etc. — qualquer tabela com uma política "admin pode tudo" sem cláusula de tenant.

## Plano

### 1. Auditoria das políticas RLS por tenant
Listar todas as tabelas com `tenant_id` que tenham políticas permissivas concedendo acesso por role (admin/gerente) sem filtrar `tenant_id`. Critério: a política passa quando `has_role(...)` é true, sem `AND tenant_id = current_tenant_id()`.

### 2. Tornar `tenant_isolation` RESTRICTIVE
Em vez de reescrever dezenas de políticas, converter a política `tenant_isolation` de PERMISSIVE para RESTRICTIVE em todas as tabelas multi-tenant. Políticas RESTRICTIVE são combinadas com AND, então a tenant_id se torna obrigatória independentemente das outras políticas.

Migração:
```sql
DROP POLICY "tenant_isolation" ON public.crm_leads;
CREATE POLICY "tenant_isolation" ON public.crm_leads
  AS RESTRICTIVE FOR ALL
  USING (tenant_id = current_tenant_id() OR has_role(auth.uid(), 'superadmin'))
  WITH CHECK (tenant_id = current_tenant_id() OR has_role(auth.uid(), 'superadmin'));
```

Aplicar o mesmo pattern em: `messages`, `instagram_messages`, `crm_appointments`, `crm_tasks`, `crm_stages`, `crm_pipelines`, `crm_conversation_notes`, `crm_followup_configs`, `crm_followup_queue`, `crm_automations`, `crm_automation_queue`, `crm_automation_executions`, `crm_broadcasts`, `crm_broadcast_recipients`, `crm_custom_fields`, `crm_lead_custom_values`, `crm_lead_pacientes`, `crm_lead_stage_history`, `crm_quick_replies`, `crm_whatsapp_templates`, `pacientes`, `clinicas`, `bots`, `bot_versions`, `bot_executions`, `bot_stage_triggers`, `tipos_procedimento`, `ai_assistant_config`, `dashboard_holidays`, `funnel_channels`, `ad_id_mapping`, `integrations`, `instagram_accounts`, `ig_accounts`, `tenant_meta_credentials`, `access_logs`, `user_roles`, `profiles`.

### 3. Limpar lead da Rizodent que foi atribuído incorretamente
O lead `Jorge` (`f2caaa1d…`, telefone 557193779350) está no tenant Rizodent porque é o único com `whatsapp_config` no `phone_number_id 846998725169815` — isso está correto e não precisa mudar.

Mas se o usuário criou algum lead manualmente na LUV que vazou para a Rizodent, eu posso identificar e corrigir após confirmar.

### 4. Validar
Após o RLS estar restrictive, abrir o CRM da LUV como admin e confirmar que:
- Aba WhatsApp só mostra leads da LUV
- Aba Instagram só mostra leads IG da LUV
- O lead `Vitor Santos | Tecladista` não aparece mais na Rizodent

## Detalhes técnicos

- Não removeremos as políticas `Users can view assigned or own leads` etc. — elas continuam controlando acesso por role dentro do tenant.
- `superadmin` mantém acesso global (necessário pro AdminPanel).
- Edge functions usando service role key não são afetadas (bypassa RLS).

## Fora de escopo

- Não alterar lógica de webhook (Instagram e WhatsApp já estão atribuindo corretamente por `phone_number_id` / `ig_user_id`).
- Não alterar UI da página `Conversas` (o filtro frontend está correto; o problema é puramente RLS no backend).