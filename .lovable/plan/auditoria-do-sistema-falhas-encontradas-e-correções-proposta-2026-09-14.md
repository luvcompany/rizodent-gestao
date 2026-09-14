# Auditoria do sistema — falhas encontradas e correções propostas

Levantamento feito em leitura (banco, funções e telas). Nada foi alterado. Abaixo o que está errado, o que é risco e o que proponho corrigir, em ordem de prioridade.

## 1. Filtro de origem não encontra parte dos leads (falha confirmada)

O campo de origem é gravado com acento pelos formulários ("Indicação", "Orgânico"), mas o filtro de Fonte nas Conversas e no Kanban procura sem acento. Resultado: quem filtra por Indicação não vê nenhum lead, mesmo havendo 37 leads com essa origem hoje.

Pior: a origem está bagunçada no banco — convivem "facebook_ad", "Anúncio", "Instagram Lite (@rizodentclinicas)", "Instagram", "instagram", "site", "Site", "outro", "Outros", "Retroativo", "kommo". Qualquer filtro ou relatório por origem fica incompleto.

Correção: comparar origem ignorando acento e maiúsculas (já existe essa normalização usada nos relatórios) e agrupar as variantes equivalentes num mesmo rótulo, nas Conversas, no Kanban e nas listas de origem.

## 2. Lista de conversas corta em 5.000 leads

A busca de leads das Conversas tem um teto fixo de 5.000 registros. Hoje são ~9.600 leads no total; contas maiores simplesmente não veem os leads acima do teto, sem nenhum aviso. Todo o filtro também acontece depois, no navegador, o que deixa a tela pesada.

Correção: paginar de verdade (já existe o mecanismo usado no Dashboard e no Kanban) e mandar os filtros principais para o banco em vez de filtrar tudo no navegador.

## 3. Um giga de registros de log ocupando o banco

O banco tem 1,46 GB, e cerca de 1 GB é histórico de tarefas agendadas e de chamadas HTTP internas que nunca são limpos (590 MB e 428 MB, com pouquíssimas linhas reais — é espaço inflado). Somam-se 131 mil linhas de log de bots e 44 mil linhas na fila de automações, incluindo itens de maio.

Correção: limpeza periódica desses históricos (manter ~7 a 30 dias) e recuperação do espaço inflado. Sem risco para dados de clientes.

## 4. Uploads sem limite de tamanho

Os depósitos de mídia de conversa e de gravações de ligação não têm limite de tamanho por arquivo. Um arquivo enorme pode estourar armazenamento e custo. Proponho limites alinhados ao que o WhatsApp aceita (imagem 5 MB, vídeo 16 MB, documento 100 MB).

## 5. Qualidade do código (melhorias, sem urgência)

- Telas gigantes: Conversas 2.221 linhas, Kanban 1.813, Relatórios 1.580 — misturam busca de dados, regra de negócio e visual.
- 13 telas ainda buscam todas as colunas da tabela quando precisam de poucas, deixando o carregamento mais lento.
- Uso extenso de tipos "soltos" (58 casos só nas Conversas) e um erro engolido sem registro, o que esconde problemas reais.
- Pontos verificados e **sem problema**: atualizações em tempo real têm limpeza correta em todos os casos; as checagens de papel na tela são apenas cosméticas e têm validação no servidor por trás.

## Fora do escopo (não será mexido)

- RLS/políticas de segurança do banco e endurecimento de permissões.
- Investigação das transações revertidas no banco.

## Detalhes técnicos

- Origem: `ConversationFilters.tsx:376-377` usa `indicacao`/`organico`; `LeadEditPanel.tsx:65-66`, `InlineTagsEditor.tsx:42-43` e `CrmKanban.tsx:356` gravam `indicação`/`orgânico`; comparação exata em `CrmConversas.tsx:1186-1193` e `CrmKanban.tsx:1203-1210`. Reaproveitar `norm()`/`classifyOrigemCanonica()` de `src/lib/reportKit.ts:174-218`.
- Teto de leads: `CrmConversas.tsx:1018` `.limit(5000)`; migrar para `fetchAllPaged` (`src/lib/reportKit.ts:133-151`) ou `.range()` como em `CrmKanban.tsx:608,643,717`.
- Retenção: `cron.job_run_details` 590 MB / `net._http_response` 428 MB (24 crons ativos, ~10 mil execuções/dia); `bot_execution_logs` 131k linhas / 60 MB; `crm_automation_queue` 44k linhas / 31 MB (12.447 `cancelled`, 3.548 `failed`, 1.519 `expired`). Novo cron diário de purga + `VACUUM FULL` fora de horário de pico.
- Storage: definir `file_size_limit` em `chat-media` e `call-recordings`.
- `select('*')` a enxugar: `CrmDashboard.tsx:136-137`, `CrmAutomacoes.tsx:183,190-193,217`, `CrmBots.tsx:37`, `CrmBotEditor.tsx:112`, `CrmCampanhas.tsx:31`, `CrmConfiguracoes.tsx:185,394`, `CrmIaConfig.tsx:70`, `CrmIntegracoes.tsx:186,198,203`, `CrmModelos.tsx:196,211,227`, `CrmRespostasRapidas.tsx:31`.

## Ordem de execução sugerida

1. Filtro de origem + normalização das variantes (item 1) — só código de tela.
2. Paginação real das Conversas (item 2) — só código de tela.
3. Limpeza e retenção dos logs do banco (item 3) — migration + cron.
4. Limites de upload nos buckets (item 4) — configuração de bucket.
5. Higiene de código e colunas explícitas (item 5) — incremental.

Cada etapa é independente; posso executar todas ou apenas as que você escolher.