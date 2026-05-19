## 1. Popover de Marcadores — ajustar posição do botão "Novo"

Em `src/components/chat/LeadLabelsPopover.tsx`, o botão `+ Novo` fica colado no `X` de fechar do `DialogContent`. Adicionar `mr-8` (ou `pr-6`) no container do header para abrir espaço para o X do Radix Dialog.

## 2. Migrar Rizodent para CRC sem perder nada (com overrides amplos)

### Banco (migração + insert de dados)

- Trocar role do Rizodent (`d9b27aa3-049e-4ec9-9ae3-fb160a9544fa`) de `admin` para `crc` em `user_roles`.
- Criar overrides em `user_permission_overrides` para Rizodent com `granted = true` nas páginas/ações administrativas que hoje só admin vê (Usuários, Configurações, Integrações, Bots/Editor, Automações, Modelos, Respostas Rápidas, Relatórios, Dashboard principal, Pacientes, Tipos de procedimento, Registro Diário, Cadastro de Leads, Marketing, Atendimento).
- Garantir que o Rizodent vê os funis CRC: adicionar role `crc` aos `allowed_roles` (ou deixar `NULL` = todos não-posvenda) dos funis não-posvenda; e adicionar override `pipeline:<id_posvenda> = false` para Rizodent (negar acesso explicitamente ao Pós-venda).
- Reatribuir ownership dos recursos hoje criados por Rizodent (`bots`, `crm_quick_replies`, `crm_whatsapp_templates`, `crm_broadcasts`, automations) para `owner_role = 'crc'` quando atualmente forem `admin`/null e tiverem `created_by = Rizodent`. Mensagens/leads/pacientes ficam intactos (já estão por `assigned_to`/tenant).

### RLS (isolamento total CRC × Pós-venda)

Reforçar policies para que role `crc` NÃO veja recursos `owner_role = 'posvenda'` e role `posvenda` NÃO veja `owner_role = 'crc'`. Admin/gerente/superadmin continuam vendo tudo. Tabelas afetadas:

- `crm_leads` (via `can_access_pipeline()` que já cobre posvenda) — confirmar e ajustar policy SELECT para também filtrar por `owner_role` do lead quando aplicável.
- `bots`, `crm_quick_replies`, `crm_whatsapp_templates`, `crm_broadcasts`, `crm_automations`, `crm_followup_configs`: SELECT permite quando `owner_role IS NULL` OR `owner_role = get_user_primary_role(auth.uid())` OR usuário é admin/gerente/superadmin.
- `messages` e `instagram_messages`: já amarradas ao `lead.tenant_id`; herdarão o filtro do lead via join na policy.

Resultado: criar qualquer novo `crc` ou `posvenda` enxerga apenas o que pertence à sua role, igual ao usuário-modelo da função.

## 3. Migrar leads "Contratado" existentes para Pós-venda + validar cron

- Identificar todas as etapas chamadas `Contratado`/`Contratados` em qualquer funil (exceto o próprio Pós-venda) no tenant Rizodent.
- Mover esses leads para o funil Pós-venda (`c7fb4a30-…`), na primeira etapa do funil Pós-venda, preservando `assigned_to`, mensagens, agendamentos e tarefas. Registrar em `crm_lead_stage_history` via trigger existente.
- Validar agendamento de `auto-transfer-contracted-to-posvenda` no `pg_cron`: deve rodar 07:00 BRT em dias úteis (seg–sex). Se não existir ou estiver fora do horário, recriar o cron via `supabase--insert` (não migração, pois contém URL/anon-key).
- Smoke-test invocando a edge function manualmente uma vez para confirmar idempotência.

## 4. Remover tela branca de carregamento das páginas do Dashboard principal

Em `src/App.tsx` as páginas principais (Dashboard, Atendimento, Pacientes, Relatórios, Marketing, Cadastro de Leads, Usuários, Tipos de Procedimento, Registro Diário, Configurações) ainda usam `lazy()` com `Suspense fallback={null}`, gerando o flash branco.

Solução (mesma já aplicada ao CRM): converter essas páginas para imports eager. Manter `lazy()` apenas para Admin Panel, Bot Editor, CrclinLanding, ChangePassword (telas pesadas/raras).

---

## Detalhes técnicos

- A migração de SQL será 1 só (schema/policies). Alterações de DADOS (role swap, overrides, move leads, owner_role backfill) usarão `supabase--insert` para não rodarem em projetos remix.
- O cron job de pós-venda será inserido via `supabase--insert` (contém URL e anon key específicos do projeto).
- Após a migração, regenerar `types.ts` é automático.
- Verificar com `supabase--linter` no final.

## Arquivos a editar

- `src/components/chat/LeadLabelsPopover.tsx` — espaço do botão Novo
- `src/App.tsx` — eager imports das páginas principais
- Migration SQL nova (policies + overrides schema se necessário)
- Comandos `supabase--insert` para: role swap, overrides, move de leads, cron job

## Validação

- Login como Rizodent: ainda vê tudo (admin-like) MAS funil Pós-venda some e leads do Pós-venda não aparecem em Conversas/Kanban.
- Login como Neiriane (posvenda): vê só Pós-venda, sem CRC.
- Criar usuário CRC novo: vê exatamente o que Rizodent vê (menos os overrides admin).
- Etapa Contratado vazia no funil Principal; leads aparecem no Pós-venda.
- Trocar abas no /rizodent/* sem flash branco.