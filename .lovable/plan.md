# Passada final do redesign do CRM

## Objetivo
Concluir a revisão exclusivamente visual das telas fora de `/admin`, preservando dados, textos, permissões, rotas e comportamentos.

## Implementação
- Substituir cores fixas de interface e status por tokens semânticos; manter somente cores que representam identidade externa ou escolha explícita do usuário, como logos de canais e cores cadastradas de etapas/funis.
- Fortalecer os tokens derivados da marca para manter contraste com marcas claras ou escuras, em tema claro e escuro, sem aproximar a marca das cores semânticas de sucesso, alerta, erro, informação, roxo e neutro.
- Corrigir estruturas responsivas encontradas em Conversas, editor de bots, Equipe/permissões, recepção, integrações, relatórios e demais telas: larguras rígidas, grupos de ações, abas, nomes longos, painéis e tabelas.
- Aplicar proteções globais somente ao escopo visual do CRM para impedir rolagem horizontal da página, quebra letra a letra e estouro de conteúdo, mantendo rolagem interna onde necessária.

## Validação
- Conferir as rotas acessíveis em 1366, 1280, 1024 e 390 px.
- Simular marca laranja, uma marca clara e uma marca escura nos temas claro e escuro, verificando contraste dos principais controles e estados.
- Rodar verificação de tipos, compilação e busca residual de cores fixas.
- Entregar um resumo final organizado tela por tela, incluindo limitações de telas que dependam de dados ou sessão indisponíveis.
