# Dashboard visual do CRM

## Objetivo
Atualizar somente a apresentação do Dashboard CRM e de “Meu desempenho” da SDR, mantendo consultas, cálculos, filtros, estados, textos funcionais e ações existentes.

## Alterações
- Reorganizar o cabeçalho com título forte e ações preservadas.
- Destacar “Faturamento do mês” em um card escuro, com valor grande e cor derivada do tema.
- Converter os demais indicadores para `KpiCard`, usando chips e tons semânticos.
- Revestir tarefas, atrasadas, agendamentos, resultados e confirmações com `SectionCard` e `StatusPill`.
- Exibir nomes completos com quebra de linha, sem truncamento.
- Agrupar “Próximos agendamentos” em painéis por dia.
- Trocar o seletor 7/14/30 dias por abas em pílula, preservando o mesmo estado `upcomingDays`.
- Aplicar a mesma linguagem visual aos indicadores e painéis de “Meu desempenho”, sem alterar seu filtro de datas.
- Remover alturas e rolagens internas conflitantes para evitar rolagem dupla em 1440px.
- Ajustar as grades para rótulos completos em 1280px, 1024px e celular.

## Detalhes técnicos
- Reutilizar `PageHeader`, `KpiCard`, `SectionCard`, `StatusPill`, `PillTabs` e `EmptyState` de `src/components/crm-ui`.
- Usar exclusivamente tokens semânticos do tema; nenhuma cor fixa ou paleta Tailwind.
- Manter handlers, hooks, queries, validações, rotas, contagens e condições de exibição sem mudanças.
- Validar tipagem, compilação e ausência de rolagem horizontal nas larguras solicitadas.
