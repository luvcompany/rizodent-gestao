# Renovação visual do Kanban e modo Lista

## Objetivo
Atualizar somente a apresentação da tela de funil, mantendo intactos dados, textos, filtros, ações, permissões, carregamento e toda a lógica de arrastar e mover cartões.

## Alterações visuais
- Reorganizar o cabeçalho com chip de ícone, nome forte do funil, seletor com 40px e cantos arredondados, alternador Kanban/Lista em pílula, filtro e busca no mesmo padrão visual.
- Transformar a faixa de indicadores em uma grade responsiva, com números destacados e rótulos abaixo em larguras menores que 1400px; em 1024px, usar duas fileiras.
- Manter cada coluna com 280px, trilho afundado e faixa superior na cor cadastrada da etapa; apresentar contagem e valor em uma pílula.
- Refinar os cartões com superfície do tema, sombra suave e estados de tarefa por semântica: “Sem Tarefas” neutro, “Com tarefa” em sucesso e “Atrasada” em erro.
- Atualizar o modo Lista para uma tabela limpa com cabeçalho afundado, espaçamento compacto em 1024/1200 e rolagem restrita ao card quando necessária.
- Preservar o comportamento responsivo no celular, sem rolagem horizontal da página.

## Detalhes técnicos
- Alterar apenas a camada visual da página do Kanban, reutilizando os componentes e tokens semânticos já existentes no CRM.
- Substituir controles HTML visuais do cabeçalho por componentes do design system sem mudar seus handlers.
- Não alterar `DragDropContext`, `Droppable`, `Draggable`, `handleDragEnd`, regras de etapa, queries ou mutations.
- Validar Kanban e Lista em 1440, 1280, 1200, 1024 e 390px, além da compilação TypeScript.
