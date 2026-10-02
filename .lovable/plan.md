# Cor dos botões configurável por cliente

## Resultado
Adicionar no painel administrativo, em **Cliente → Branding**, uma cor específica para botões de ação e abas ativas. A cor principal atual continuará controlando o menu lateral e a identidade geral do cliente.

## Implementação
- Adicionar ao cadastro do cliente o campo de cor dos botões, com preenchimento inicial herdando a cor principal para não alterar clientes existentes.
- Incluir o novo seletor no cadastro e na edição do cliente, com prévia imediata dos botões e abas.
- Fazer a configuração pública de marca entregar essa cor junto com logo e cores atuais.
- Gerar os tons suaves e o contraste de texto dos botões a partir dessa cor, inclusive no modo escuro.
- Manter sidebar, badges do menu, gráficos e cores de status ligados às regras atuais; somente botões de ação e abas usam a nova configuração.
- Atualizar as funções administrativas que criam e editam clientes para aceitar o novo campo.

## Validação
- Conferir que a RizoDent mantém o menu laranja atual.
- Alterar a cor dos botões na prévia administrativa e confirmar a aplicação em botões e abas do CRM.
- Validar tema claro/escuro, criação e edição de cliente, compilação e ausência de erros no navegador.
