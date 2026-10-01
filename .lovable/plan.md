# Renovação visual do calendário e telas iniciais

## Objetivo
Aplicar o padrão visual do CRM ao calendário de agendamentos e tarefas e às telas iniciais da recepção, closer e SDR, sem alterar dados, regras, permissões ou ações.

## Calendário
- Reorganizar o cabeçalho com período em destaque, navegação em botões-card e alternador Agendamentos/Tarefas em pílula.
- Transformar a legenda em pílulas com ponto semântico.
- Renovar a matriz semanal em card com cabeçalho fixo, hoje destacado pela marca e coluna suavemente tingida.
- Aplicar aos eventos fundo suave, barra lateral de 3px e cores semânticas por status; permitir quebra natural dos nomes.
- Renovar as visões de tarefas Eventos, Lista, Semana e Mês, garantindo encaixe em 1280px.
- Diferenciar visualmente “hoje” e “selecionado” no mini calendário.

## Telas iniciais
- Preservar a tela compartilhada por recepção, closer e SDR, renovando título, KPIs, fila, consultas e atalhos com os componentes e tokens do CRM.
- Garantir títulos e rótulos com quebra natural, atalhos contidos no card e boa leitura em 1024px.
- Manter a tela “Meu desempenho” da SDR alinhada ao mesmo sistema visual, sem mudar seus dados ou filtros.

## Detalhes técnicos
- Alterações apenas em classes e composição visual dos componentes existentes.
- Uso exclusivo de tokens semânticos e da cor dinâmica da marca; sem cores fixas de cliente.
- Nenhuma mudança em hooks, consultas, handlers, rotas, condições ou textos de dados.
- Validação em 1440, 1280, 1024 e 390px, além de checagem de tipos e compilação.
