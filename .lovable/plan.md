## Diagnóstico

Investiguei o RPC `crm_usage_metrics` e os dados reais dos últimos 90 dias:

| Card                | Fonte atual                      | Registros | Situação |
|---------------------|----------------------------------|----------:|----------|
| Bots                | `bot_executions`                 | 10.449    | OK       |
| Uso da IA (Bia)     | `ai_conversation_analysis`       | 6         | **Fonte errada** — ignora 519 sugestões e 2.559 transcrições |
| Follow-ups          | `crm_followup_queue`             | 0         | Feature foi **removida** do sistema; card não faz mais sentido |
| Automações          | `crm_automation_queue`           | 23.248    | OK       |
| Transmissões        | `crm_broadcasts`                 | 0         | Sem uso ainda; card sempre vazio |

## O que fazer

### 1. Remover card "Follow-ups"
A funcionalidade de follow-ups foi apagada do projeto, então o card deve sair da tela em `src/pages/CrmMetricas.tsx` (junto com KPI, `fu_data` do RPC e imports/estados). Isso remove o principal card vazio.

### 2. Ampliar a fonte de "Uso da IA (Bia)"
No RPC `crm_usage_metrics`, a seção `uso_ia` hoje só conta `ai_conversation_analysis`. Ampliar para incluir todas as interações reais da Bia com estas fontes agregadas por dia/mês:

- `ai_reply_suggestions` — agrupado por `status` (`suggested`, `approved`, `edited`, `discarded`, `dismissed`) → rótulos "Sugestão", "Aprovada", "Corrigida", "Ruim", "Ignorada".
- `messages` com `transcription IS NOT NULL` → rótulo "Transcrição de áudio".
- `ai_good_examples` (criação) → rótulo "Exemplo bom aprendido".
- Manter `ai_conversation_analysis` com rótulo "Análise de conversa".

O front já traduz automaticamente via `IA_MODE_LABELS`, então basta acrescentar as novas chaves ao dicionário.

### 3. Melhorar estado vazio de "Transmissões"
Manter o card, mas quando não houver dados exibir uma mensagem explicativa em vez do gráfico em branco:
"Nenhuma campanha disparada neste período. Crie uma em Conversas → Transmissões."

### 4. KPI superior
- Remover o KPI "Follow-ups enviados".
- Renomear "Interações com a IA" para incluir sugestões + transcrições no total.
- Ficam 3 KPIs: **Execuções de Bot**, **Interações com a IA**, **Mensagens em Transmissões**.

## Arquivos afetados

- Nova migration: recriar `public.crm_usage_metrics(p_from date, p_to date)` com as fontes ampliadas e sem `fu_data`.
- `src/pages/CrmMetricas.tsx`: remover bloco de Follow-ups, atualizar `UsageData` type, ajustar KPIs, adicionar rótulos novos em `IA_MODE_LABELS`, colocar estado vazio explicativo em Transmissões.

Sem mudanças de RLS, sem novas tabelas.
