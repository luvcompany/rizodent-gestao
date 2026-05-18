
## Contexto rápido

1. **Faturamento do mês** já é calculado a partir da tabela `pagamentos` (não da etapa Contratado). Mover o lead para o funil de Pós-venda **não altera nenhum KPI financeiro** — o histórico em `crm_lead_stage_history` preserva a passagem por "Contratado" no Funil Principal para qualquer relatório baseado em data de contratação.
2. Templates hoje são compartilhados em todo o tenant (`crm_whatsapp_templates` só tem `tenant_id`). Precisa ter "dono" para filtrar por papel.
3. Decisões aprovadas pelo usuário:
   - Transferência para Pós-venda: **botão manual no card/chat** + **fallback automático no próximo dia útil às 7h** se ainda não tiver sido transferido. Pós-venda pode reverter a qualquer momento.
   - Templates: **cada papel vê apenas os seus próprios** (admin/superadmin enxergam todos). **Aplica-se em `CrmConversa` e `CrmConversas`** (e em qualquer outro ponto que liste modelos: bots, automações, follow-ups, broadcasts).

---

## Parte 1 — Transferência Contratado → Pós-venda

### 1.1 Botão manual
- No header do chat (`CrmConversa`) e no card do Kanban: botão **"Enviar para Pós-venda"** visível apenas quando o lead está em etapa "Contratado" de um pipeline que não seja o de Pós-venda **e** ainda não está atribuído a usuário `posvenda`.
- Ao clicar, chama a edge function `transfer-lead` já existente passando o usuário Pós-venda padrão. A função já move pipeline/stage para Pós-venda → primeira etapa quando o destinatário tem papel `posvenda` e registra mensagem de sistema.

### 1.2 Fallback automático
- Nova edge function **`auto-transfer-contracted-to-posvenda`** agendada via `pg_cron` todos os dias úteis às 07:00 BRT (10:00 UTC).
- Busca leads cuja última entrada em uma etapa "Contratado" foi em dia útil anterior, que ainda não estão no pipeline Pós-venda nem atribuídos a usuário `posvenda`, e executa a mesma rotina de transferência. Pula sábados/domingos.
- Mensagem de sistema: "Transferência automática para Pós-venda".

### 1.3 Reversão
Pós-venda já consegue reatribuir via sidebar de transferência existente. Sem mudanças.

### 1.4 Faturamento
Sem impacto — apenas adicionar nota na memória.

---

## Parte 2 — Templates de mensagem filtrados por papel

### 2.1 Schema
- Migration em `crm_whatsapp_templates`:
  - `created_by_user_id uuid` (nullable)
  - `owner_role app_role` (nullable)
- Templates legados (`owner_role IS NULL`) continuam visíveis para todos para não quebrar nada.

### 2.2 RLS
SELECT visível quando:
- `tenant_id = current_tenant_id()` **E**
- ( `owner_role IS NULL` **OU** usuário possui o papel `owner_role` **OU** usuário é `admin` / `gerente` / `superadmin` ).

### 2.3 Frontend
- `CrmModelos.tsx`: no INSERT, gravar `created_by_user_id = auth.user.id` e `owner_role = papel principal` (lido de `user_roles`).
- **Sem alterações necessárias** em `CrmConversa.tsx`, `CrmConversas.tsx`, `useChatConversation.ts`, `ChatInput.tsx`, automações, follow-ups, bots e broadcasts — a RLS já filtra automaticamente nos dois lados (lista de envio de template no chat individual **e** no envio em massa/conversa pela tela de conversas).
- Opcional em `CrmModelos.tsx`: badge indicando o papel dono do template.

### 2.4 Comportamento esperado
| Usuário               | Vê templates                                          |
|-----------------------|--------------------------------------------------------|
| `rizodent` (admin)    | Todos (próprios, dos outros papéis e legados)         |
| `gerente`             | Todos                                                  |
| `crc`                 | Apenas criados por CRCs + legados                     |
| `posvenda` (Neiriane) | Apenas criados por Pós-venda + legados                |
| `superadmin`          | Todos                                                  |

Em `CrmConversa` (chat individual) e em `CrmConversas` (lista geral de conversas), ao clicar em **Enviar template**, a lista exibida respeita exatamente essa tabela.

---

## Arquivos afetados

```text
supabase/migrations/<new>.sql
  - ALTER TABLE crm_whatsapp_templates ADD created_by_user_id, owner_role
  - DROP/CREATE POLICY SELECT com filtro por papel
  - cron.schedule diário 10:00 UTC

supabase/functions/auto-transfer-contracted-to-posvenda/index.ts   (novo)

src/pages/CrmModelos.tsx               (gravar owner_role + created_by_user_id no insert; badge opcional)
src/pages/CrmConversa.tsx              (botão "Enviar para Pós-venda" no header)
src/components/.../KanbanCard.tsx      (mesmo botão no card quando stage = Contratado)
```

---

## Fora de escopo

- Marcar template como "compartilhado" explicitamente (admin pode forçar visível a todos) — pode ser adicionado depois.
- Migrar templates legados para um dono específico — permanecem visíveis a todos.
