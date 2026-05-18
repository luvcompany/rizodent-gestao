# CRM Pós-Venda — Fase 1

Reaproveita 100% da estrutura existente (pipelines, automações, follow-up, templates, tags). Não cria pipeline novo — adiciona duas camadas em cima do que já roda: um **Health Score automático** e um **Dashboard de Risco** dedicado ao role `posvenda`. A reativação é totalmente automatizada via templates WA já aprovados.

---

## 1. Health Score automático v1

### Regras de pontuação (recálculo via cron)

| Sinal | Pontos |
|---|---|
| Cada mensagem inbound respondida | +10 |
| Mudança de estágio (engajamento) | +15 |
| Agendamento confirmado | +30 |
| Avaliação/feedback positivo (tag `feedback_positivo`) | +20 |
| Tarefa concluída pelo paciente | +5 |
| Cancelou consulta (status `cancelled`/`no_show`) | -40 |
| Sem resposta há 30+ dias | -20 |
| Sem voltar à clínica há 180+ dias | -25 |
| Tag `reclamacao` | -15 |

Score final clampado em 0–100. Faixas:

- **0–29 — Frio** (badge cinza)
- **30–59 — Morno** (badge amarelo)
- **60–79 — Quente** (badge laranja)
- **80–100 — VIP / Engajado** (badge verde)

### Onde aparece

- Badge colorido na lista de conversas e no Kanban (somente para `posvenda`, `admin`, `superadmin`)
- Painel lateral do lead com breakdown ("Por que esse score?")
- Filtro "Faixa de score" na lista

### Backend

- Evoluir `recalculate_lead_score()` para usar a nova fórmula (hoje é só msg+stage+inativo)
- Cron a cada 30min chamando `recalculate_all_lead_scores(500)` por batch
- Trigger em `crm_appointments` (cancelado/no_show) e em `messages` (inbound) para recalcular sob demanda os afetados

---

## 2. Dashboard Pós-Venda

Nova rota `/rizodent/crm/posvenda` visível para `posvenda` e `admin`. Layout idêntico ao Dashboard CRM atual (3 colunas, design system existente).

### 4 cards principais (clicáveis → lista filtrada)

1. **Em risco** — leads que atendem qualquer um:
   - sem resposta há 30+ dias **OU**
   - última consulta cancelada/no_show **OU**
   - score abaixo de 30
2. **Sumidos** — sem voltar à clínica há 180+ dias (cruza com `pacientes` via `crm_lead_pacientes`)
3. **VIPs** — score ≥ 80 ou ticket acumulado acima do percentil 80 da clínica
4. **Aniversariantes da semana** — usa `pacientes.data_nascimento` quando disponível

### Cards secundários

- Total de pacientes ativos (com lead vinculado)
- Reativações automáticas disparadas nos últimos 30d
- Taxa de resposta dos disparos automáticos
- Top 5 leads com maior queda de score nos últimos 7d

### Drilldown

Cada card abre `/rizodent/crm/conversas` com filtro pré-aplicado, igual ao padrão dos Relatórios.

---

## 3. Reativação 100% automática

Reusa `crm_followup_configs` (já existente) com config nova específica para pós-venda:

- **Gatilho:** lead entra num estado de risco (cron diário identifica e move/marca via automação `on_enter` no estágio "Reativação")
- **Sequência:**
  1. Dia 0 — template WA `reativacao_inicial` ("Faz um tempo que não vemos seu sorriso 😊")
  2. Dia +3 — template `reativacao_oferta` (avaliação preventiva)
  3. Dia +7 — template `reativacao_final` (última chance, condição especial)
- Resposta do paciente pausa a sequência e marca status `responded` (já é o comportamento atual do followup-engine)
- Se score voltar a subir após resposta, sai automaticamente do estágio Reativação

Configuração feita 100% pela tela `/crm/followups` existente — sem código novo no engine.

---

## Detalhes técnicos

### Migrations
1. Atualizar função `recalculate_lead_score(p_lead_id uuid)` com a nova fórmula (inclui appointments cancelados, dias sem visita via `pacientes`).
2. Criar função `posvenda_dashboard_metrics()` (SECURITY DEFINER) retornando JSONB com os 4 contadores + listas top-N. Restringir a `posvenda`/`admin`/`superadmin`.
3. Criar índices: `crm_leads(last_inbound_at)`, `crm_leads(score)`, `pacientes(data_nascimento)`.
4. Cron `pg_cron` a cada 30min → `recalculate_all_lead_scores(500)`.
5. Cron diário 08:00 → identifica leads em risco e move para estágio "Reativação" (criar estágio se não existir no pipeline padrão do tenant).

### Frontend
- `src/pages/CrmPosVendaDashboard.tsx` — nova página (copia layout de `CrmDashboard.tsx`)
- `src/components/chat/LeadScoreBadge.tsx` — badge reusável com breakdown em tooltip
- Adicionar item "Pós-Venda" no `CrmLayout.tsx` visível só para `posvenda`/`admin`
- Filtro "Score" no `ConversationFilters.tsx`
- Renderizar badge em `CrmConversas` e `CrmKanban` condicionado ao role

### RLS
- `posvenda_dashboard_metrics()` retorna `forbidden` se o usuário não for `posvenda`/`admin`/`superadmin`
- Nenhuma alteração em policies existentes (continua respeitando `owner_role` e `tenant_isolation`)

### Não-objetivos da Fase 1
- Eventos clínicos (fez implante → fluxo) — fica para Fase 2
- Memória emocional estruturada — Fase 2
- CRM Familiar — Fase 2
- NPS / LTV detalhado nos relatórios — Fase 2

---

## Entregáveis

- 1 migration (função `recalculate_lead_score` v2 + `posvenda_dashboard_metrics` + índices)
- 1 SQL via insert tool (jobs pg_cron, contém URL/anon key do tenant)
- 1 página nova (`CrmPosVendaDashboard.tsx`)
- 1 componente badge + integração em 2 telas
- 1 estágio "Reativação" criado no pipeline padrão + 1 config de follow-up modelo
- 3 templates WhatsApp a serem aprovados manualmente no Meta (nomes acima)

Pronto pra implementar quando você aprovar.