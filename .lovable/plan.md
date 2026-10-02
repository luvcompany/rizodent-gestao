# Relatório das SDRs — visual novo nas abas de agendamentos

## Objetivo
Manter as três abas (Visão geral, Agendamentos feitos, Consultas do dia), mas trocar as tabelas largas e "feias" por cartões organizados no padrão visual do CRM, com balãozinho de detalhe por dia e um comparativo lado a lado entre as SDRs. Só muda a pele: números, contagens e a RPC `relatorio_sdr_diario` continuam iguais.

## O que muda

### 1. Aba "Agendamentos feitos" — comparativo + balãozinho
- **Comparativo no topo:** um cartão por SDR, lado a lado, com: total de agendamentos feitos no período, média por dia útil e melhor dia. Ao final, cartão "Equipe" com o total geral.
- **Detalhe por dia em balãozinho:** em vez da tabela com uma linha por dia, cada cartão de SDR mostra os dias em formato de lista compacta; ao passar o mouse ou clicar no número do dia, abre um balãozinho (Popover) com os dados organizados igual ao relatório geral: quantos marcou naquele dia e a lista de leads (clicável, com "Ver conversa").
- Remove a tabela larga atual.

### 2. Aba "Consultas do dia" — cartões por dia
- Em vez da tabela larga, um cartão por dia do período (estilo o bloco do relatório geral): "Consultas do dia: 5" e, em pílulas com cor semântica, Compareceram / Faltas / Cancelamentos / Remarcados / Pendentes — cada número clicável, abrindo a lista de leads com "Ver conversa".
- Mantém o seletor de SDR (Todas / cada uma) no topo.
- Mantém o aviso vermelho quando a soma das situações não fecha com o total do dia.
- Dias sem consulta não aparecem (hoje aparecem como linhas zeradas).

### 3. Padrão visual
- Cartões `rounded-2xl`, sombra suave, bordas `border/60`; pílulas de situação nos tons semânticos já usados no relatório geral (success, destructive, warning, purple, slate).
- Balãozinho: Popover `rounded-xl` com os números em linhas label → valor, igual ao padrão dos KPIs do relatório geral.
- Funciona em 1440/1366/1280/1024 e no celular (390), sem rolagem horizontal.

## O que NÃO muda
- RPC `relatorio_sdr_diario` e `relatorio_agendamentos_detalhe` (nenhuma migration nova).
- Contagens, filtros de período, seletor de SDR, listas de leads e botão "Ver conversa".
- Aba "Visão geral" continua como está.

## Arquivos
- `src/components/relatorios/SdrDiario.tsx` — reescrita visual dos dois modos (feitos / do_dia).
- Nenhum outro arquivo.

## Verificação
- Build/typecheck OK.
- Playwright (1280 e 390): abas abrem, cartões e balãozinhos funcionam, números batem com os atuais, listas abrem com "Ver conversa", sem rolagem horizontal.
