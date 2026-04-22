

# Unificação CRM + Dashboard + Relatórios completos

Vou entregar três blocos integrados: (1) **botão automático de "Compareceu / Não compareceu / Contratou / Não contratou"** dentro da conversa, (2) **Dashboard principal puxando dados do CRM** (lançamentos automáticos), e (3) **Relatórios completos** com tudo que você pediu por unidade, canal e funil.

---

## 1. Botão de resultado do agendamento na conversa (CRC + CRM Conversas)

No painel lateral do lead (componente `AppointmentConfirmBar`), quando passar **1 dia após `scheduled_date`** e o agendamento ainda estiver com `status = confirmed`, aparece um card laranja destacado:

```
┌────────────────────────────────────────┐
│ ⚠ Agendamento de 18/04 — qual o resultado? │
│  [ Compareceu ]   [ Não compareceu ]   │
└────────────────────────────────────────┘
```

- **Não compareceu** → `status = no_show`, lead movido automaticamente para etapa **"Não compareceu"** do funil atual.
- **Compareceu** → abre segundo passo no mesmo card:
  ```
  Compareceu! Resultado da avaliação:
  [ Contratou ]   [ Não contratou ]
  ```
  - **Contratou** → `status = contracted`, move para **"Contratado"** do funil atual.
  - **Não contratou** → `status = not_contracted`, **move o lead para o funil de "Não Contratados"** (etapa "Novo lead" / "Conversando" do pipeline de recuperação).

Tudo com `crm_lead_stage_history` atualizada, mensagem de sistema no chat e disparo de automações de etapa (já existente).

O mesmo card aparece também no **CrmDashboard** numa nova coluna "Aguardando resultado" (lista de agendamentos vencidos sem desfecho), com os dois botões inline.

---

## 2. Dashboard principal (geral) puxando do CRM

Hoje o Dashboard principal lê de `leads_diarios` (lançamento manual). Vou trocar a fonte para o CRM, sem perder o histórico:

| KPI / Gráfico | Nova fonte | Observação |
|---|---|---|
| Leads novos por dia | `crm_leads.created_at` | agrupado por `cidade` |
| Leads por unidade | `crm_leads.cidade` | VCA / Guanambi / Ipiaú / Itabuna |
| Agendamentos por dia | `crm_appointments.scheduled_date` | filtro por cidade do lead |
| Comparecimentos | `crm_appointments.status IN (contracted, not_contracted)` | |
| Faltas | `crm_appointments.status = no_show` | |
| Contratações | `crm_appointments.status = contracted` | |
| Faturamento | continua em `pagamentos` | inalterado |

A página antiga **"Cadastro de Leads"** (lançamento manual) fica como fallback opcional — passamos a marcar a fonte como "CRM (auto)" quando o dia tem leads no `crm_leads` e oculta a necessidade de lançar manualmente.

---

## 3. Relatórios — tudo o que você pediu

Adiciono na página `CrmRelatorios` uma nova aba **"Origem & Conversão"** com:

### 3.1 Leads que chegaram — segmentado
Tabela cruzada **Cidade × Origem** (Anúncio / Orgânico / Indicação / Outros), com filtro por canal específico (FB / IG / WhatsApp / Webhook).

```
                  Vit. Conquista   Guanambi   Itabuna   Ipiaú   Total
Anúncio Meta            142          68         44       31      285
WhatsApp Direto          22          11          7        4       44
Indicação                15           5          3        2       25
─────────────────────────────────────────────────────────────────────
Total                   179          84         54       37      354
```

### 3.2 Leads atendidos (respondidos)
Calculado via `messages`: lead atendido = tem ao menos uma mensagem `outbound` enviada por um CRC após o primeiro `inbound`.
- KPIs: **Respondidos no mesmo dia / em até 1h / em até 24h / não respondidos**
- Por cidade e por canal.

### 3.3 Agendamentos & Comparecimento
- Quantidade agendada (cohort do período).
- **Taxa de comparecimento** = `(contracted + not_contracted) / (contracted + not_contracted + no_show)`.
- Quebra por cidade e por anúncio de origem.

### 3.4 Funil de conversão — taxas por etapa
Card visual do funil com 6 taxas calculadas:

```
Lead         → Atendido        : 78%
Atendido     → Agendado        : 41%
Agendado     → Compareceu      : 65%
Compareceu   → Avaliação feita : 92%
Avaliação    → Fechamento      : 38%
─────────────────────────────────────
Lead         → Fechamento      :  7,4%   (conversão geral)
```

Definição de "Avaliação feita" = agendamento com status `contracted` ou `not_contracted` (apareceu na clínica).

### 3.5 Ranking automático
- 🏆 **Melhor canal/campanha** (maior conversão Lead→Fechamento, mín. 10 leads).
- 🔻 **Pior canal/campanha** (menor conversão).
- ⚠ **Principal ponto de perda no funil** — calculado pegando a maior queda percentual entre etapas consecutivas.
- 🏥 **Unidade que melhor converte / pior converte** (mesma métrica por cidade).

---

## Detalhes técnicos

**Backend (sem migrations novas necessárias — colunas já existem):**
- `crm_appointments.status` já aceita `confirmed | no_show | contracted | not_contracted | cancelled`.
- A movimentação automática usa o helper `moveLeadToScheduledStage` existente, generalizado para aceitar nome de etapa alvo (`"Não compareceu"`, `"Contratado"`, `"Não contratado"`).
- Para mover ao funil **"Não Contratados"** (pipeline diferente): localizo pipeline pelo nome `Não Contratados` / `Recuperação`, pego primeira etapa, atualizo `pipeline_id` + `stage_id` do lead e gravo histórico.

**Frontend:**
- `src/components/chat/AppointmentConfirmBar.tsx` — adiciona seção "Aguardando resultado" quando `scheduled_date < hoje` e `status = confirmed`.
- `src/pages/Dashboard.tsx` — adiciona busca paralela em `crm_leads`, `crm_appointments`, mescla com fonte legada de `leads_diarios` (CRM tem prioridade).
- `src/pages/CrmRelatorios.tsx` — nova aba `<TabsTrigger value="origem-conversao">` com 5 cards descritos acima.
- `src/pages/CrmDashboard.tsx` — nova coluna "Aguardando resultado" com botões inline.
- Reutiliza `DateRangeFilter` e respeita filtro por cidade já existente.

**Edge functions:** nenhuma criada — toda a lógica é client-side com RLS.

---

## Resumo do impacto

✅ Você nunca mais lança leads/agendamentos manualmente — tudo flui do CRM.  
✅ O botão de comparecimento aparece sozinho no dia seguinte ao agendamento, em qualquer tela do CRM.  
✅ Relatórios respondem todas as perguntas: por unidade, por canal, taxas de cada etapa, melhor/pior canal e ponto de perda.  
✅ Dashboard principal e dashboard CRM passam a mostrar os mesmos números, sem retrabalho.

