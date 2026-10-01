# Renovação visual de Relatórios, Métricas e Pós-venda

## Objetivo
Aplicar o padrão visual do Dashboard em todas as abas de Relatórios, na tela de Métricas e em Pós-venda, sem alterar consultas, cálculos, filtros, navegação ou ações.

## Relatórios
- Fortalecer o cabeçalho e transformar a navegação entre abas em pílulas responsivas.
- Padronizar os filtros como cards e os indicadores com chips pastéis, números grandes e valores monetários indivisíveis.
- Renovar Visão Geral, Origem e Conversão, Funil, Comparar funis, Ações por Dia e Métricas de Uso.
- Colocar tabelas em cards com cabeçalho afundado e rolagem interna.
- Usar tokens semânticos nos funis, destaques e gráficos, com a primeira série sempre na cor dinâmica da marca.

## Métricas
- Aplicar cabeçalho forte, filtro em card, KPIs no padrão do Dashboard e gráficos em ChartCard.
- Remover cores fixas e definir cada série por função sem depender da posição visual do item.

## Pós-venda
- Aplicar cabeçalho forte, indicadores em KpiCard e listas em cards limpos.
- Preservar integralmente categorias, critérios, atalhos e estados existentes.

## Exportação e responsividade
- Manter áreas exportáveis livres de `color-mix()`, máscaras, recortes e pseudo-elementos decorativos.
- Garantir que valores como “R$ 3.490.900,00” não quebrem no meio.
- Validar 1440, 1280, 1024 e 390px, com tabelas rolando somente dentro dos próprios cards.
- Executar verificação de tipos e compilação.
