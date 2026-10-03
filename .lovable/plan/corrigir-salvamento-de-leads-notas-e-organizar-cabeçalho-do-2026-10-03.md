# Corrigir salvamento de leads/notas e organizar cabeçalho do calendário

## 1. Erro ao salvar lead, nota e nome (urgente)
Causa confirmada: usuários logados perderam a permissão de rodar as funções automáticas do banco que acontecem ao salvar (26 só em leads e notas).
- Migration devolvendo a usuários logados a permissão de executar todas as funções automáticas do sistema (evita o mesmo erro em pagamentos, agendamentos, tarefas, mensagens).
- Visitantes não logados continuam sem acesso. Nada no app muda.
- Conferir no banco que nenhuma fica bloqueada.

## 2. Cabeçalho do calendário organizado
Hoje as alturas e estilos não batem: setas e "Hoje" de 36px, contador em pílula cinza, "Legenda" 36px e o seletor Agendamentos/Tarefas solto por cima, maior (48px) e com outro formato.
- Uma única barra alinhada: à esquerda setas + período + "Hoje"; à direita contador, "Legenda" e o seletor Agendamentos/Tarefas.
- Todos os controles com a mesma altura (40px) e cantos iguais; seletor em pílula compacta no mesmo nível, sem ficar flutuando.
- Na aba Tarefas o seletor fica no mesmo lugar.
- Conferir em 1440, 1280, 1024 e celular, sem nada cortado. Nenhum botão removido.

## Detalhes técnicos
- `GRANT EXECUTE ... TO authenticated` para funções `public` com `prorettype = 'trigger'::regtype` (bloco DO).
- `CrmCalendario.tsx`: remover posicionamento `xl:absolute` do toggle e os `xl:pr-[330px]`; renderizar o toggle dentro da barra de cada visão, alturas `h-10`.
