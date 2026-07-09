## Diagnóstico

O bloqueio anterior removeu as políticas permissivas `"Authenticated users can view <tabela>"` de 26 tabelas, mas deixou a política `tenant_isolation` como **RESTRICTIVE**. No Postgres, uma RESTRICTIVE só restringe — ela precisa ser combinada (AND) com pelo menos uma PERMISSIVE que dê acesso. Sem nenhuma PERMISSIVE SELECT, o efeito líquido é "0 linhas visíveis".

Reproduzido como Rizodent (`d9b27aa3…`, tenant `00000000-…-000010`):
- `profiles`: OK — mostra tenant correto
- RPC `current_tenant_id()`: retorna `00000000-…-000010` corretamente
- `GET /rest/v1/pacientes` → 200, corpo `[]`, `Content-Range: */0` mesmo com 520 linhas no banco

Tabelas afetadas (só RESTRICTIVE, sem PERMISSIVE SELECT):

```
ad_id_mapping                  clinicas *              crm_automation_executions
crm_automation_queue           crm_automations         crm_broadcast_recipients
crm_conversation_notes         crm_custom_fields       crm_followup_configs
crm_followup_queue             crm_lead_custom_values  crm_lead_pacientes
crm_lead_stage_history         dashboard_holidays      funnel_channels
leads_diarios                  pacientes               pagamentos
registros_diarios_atendimento  tipos_procedimento *    tratamentos
ai_assistant_config            bot_execution_logs      bot_executions
bot_stage_triggers             bot_versions
```
`*` = também tem uma PERMISSIVE "Admins can manage" sem escopo de tenant, que se ficasse sozinha vazaria dados entre tenants — por isso a RESTRICTIVE precisa continuar existindo.

## Correção

Uma única migration que, para cada tabela acima, cria uma policy **PERMISSIVE FOR SELECT TO authenticated** escopada por tenant. A `tenant_isolation` RESTRICTIVE já existente continua garantindo que ninguém (nem `crc`, nem futuras policies permissivas amplas) consiga sair do próprio tenant.

Padrões de escopo:

- Tabelas com coluna `tenant_id` direta → `USING (tenant_id = current_tenant_id())`
- Tabelas escopadas via `clinicas` (pacientes/pagamentos/tratamentos/leads_diarios/registros_diarios_atendimento usam `clinica_id`) → `USING (EXISTS (SELECT 1 FROM clinicas c WHERE c.id = <tbl>.clinica_id AND c.tenant_id = current_tenant_id()))`
- `crm_lead_pacientes`, `crm_lead_stage_history`, `crm_lead_custom_values` (escopadas via `crm_leads`) → `USING (EXISTS (SELECT 1 FROM crm_leads l WHERE l.id = <tbl>.lead_id AND l.tenant_id = current_tenant_id()))`
- `crm_broadcast_recipients` (via `crm_broadcasts.tenant_id`), `bot_execution_logs`/`bot_executions` (via `bots.tenant_id` ou coluna própria), `bot_stage_triggers`/`bot_versions` (via `bots.tenant_id`) → EXISTS equivalente na tabela pai
- `crm_automation_executions` (via `crm_automation_queue.tenant_id`) → EXISTS na fila

Todas as novas policies têm nome padronizado `<tabela>_tenant_select` para ficar óbvio no `pg_policies` e evitar colisão com nomes antigos.

Superadmin já é coberto porque `current_tenant_id()` retorna o `profiles.tenant_id` do superadmin — para permitir superadmin ver tudo, cada `USING` também inclui `has_role(auth.uid(), 'superadmin')`.

## Verificação

1. `SELECT tablename, policyname, permissive, cmd FROM pg_policies WHERE tablename = 'pacientes'` deve mostrar tanto a permissive `pacientes_tenant_select` quanto a restrictive `tenant_isolation`.
2. Rodar de novo o probe com a sessão do Rizodent:
   - `GET /rest/v1/pacientes?select=id` deve retornar 520 linhas
   - Dashboard: KPIs de faturamento, Ticket Médio, Pacientes com pagamento devem sair de zero
   - Página `/rizodent/pacientes` deve listar os 520
3. Como LUV Agency, mesmo probe deve continuar retornando apenas os dados do próprio tenant (0 pacientes, 0 pagamentos) — sem vazamento.

## Arquivos

- **Novo:** `supabase/migrations/<timestamp>_restore_permissive_select_tenant.sql`
- Nenhum código de aplicação muda — o problema é 100% RLS.
