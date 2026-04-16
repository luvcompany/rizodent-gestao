

## Plano: Conversão Diária Real do CRC + Data de Entrada Fixa do Lead

### Contexto
1. A métrica atual "Conversão Diária CRC" no relatório só conta agendamentos cuja `scheduled_date` é o **mesmo dia** do contato. Isso não reflete o poder de conversão real — se o atendente fala com o lead hoje e agenda pra semana que vem, não conta.
2. Hoje, na lista de Conversas (CrmConversas/CrmConversa) e nos cards do Kanban (CrmKanban), a data exibida ao lado do nome geralmente é `last_message_at` (data da última mensagem), o que muda toda hora. O usuário quer ver **a data de criação do lead** (`created_at`) fixa, para conseguir filtrar leads do dia.

### Mudanças

**1. Conversão Diária do CRC (em `src/pages/CrmRelatorios.tsx`)**

Reformular a lógica do componente `ConversionMetricsSection` (tabela "Conversão Diária por CRC"):

- **Contatos por dia**: continua igual — contar leads únicos com quem cada atendente trocou mensagem outbound naquele dia (já está correto).
- **Agendados (NOVA lógica)**: para cada (atendente, dia), contar quantos daqueles leads contatados naquele dia tiveram **um agendamento criado em qualquer data futura**, desde que o agendamento tenha sido **registrado (`created_at` do appointment) no mesmo dia do contato**.
  - Ou seja: cruzar via `lead_id` + `crm_appointments.created_at::date == dia do contato` (independente da `scheduled_date`).
- **Taxa de conversão**: `agendados / contatos * 100` (já está).

Isso responde exatamente: "de 40 pessoas que falei hoje, quantas consegui agendar (pra qualquer dia)".

Renomear cabeçalho da coluna de "Agendados (mesmo dia)" para apenas "Agendados" e ajustar o subtítulo da seção para deixar claro: *"Leads contatados por dia × leads que foram agendados (para qualquer data) no mesmo dia do contato"*.

**2. Data de entrada fixa do lead**

Trocar a data exibida ao lado do nome do lead, de `last_message_at` para `created_at` (data de entrada/criação do lead), nos seguintes lugares:

- **`src/pages/CrmConversas.tsx`** — coluna/lista de conversas, badge de data ao lado do nome.
- **`src/pages/CrmConversa.tsx`** — mesmo elemento na versão alternativa.
- **`src/pages/CrmKanban.tsx`** — cards do kanban, data exibida no card do lead.

A data continua formatada em `pt-BR`. Para leads do dia, mostrar "Hoje HH:mm"; ontem "Ontem"; demais, `dd/MM`.

### Arquivos a editar
1. `src/pages/CrmRelatorios.tsx` — nova lógica de agendados por created_at do appointment.
2. `src/pages/CrmConversas.tsx` — usar `created_at` na data do lead.
3. `src/pages/CrmConversa.tsx` — idem.
4. `src/pages/CrmKanban.tsx` — idem nos cards.

