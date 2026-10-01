# Renovação visual da tela de Conversas

## Objetivo
Aplicar o padrão visual do CRM à tela de Conversas, sem alterar dados, textos, permissões, consultas, ações ou comportamento.

## O que será ajustado
- Organizar lista, chat e detalhes do lead como três superfícies brancas separadas sobre o fundo tingido.
- Transformar as abas WhatsApp/Instagram em pílulas com contadores preservados.
- Refinar o cabeçalho, a busca e cada linha da lista, incluindo avatar de 44px, selo do canal, nomes em até duas linhas, pílulas suaves e estados ativo/não lido derivados da marca.
- Reorganizar o cabeçalho do chat para preservar nome, telefone, cópia, etapa e selos sem sobreposição.
- Aplicar superfície afundada às mensagens, com bolhas recebidas brancas, enviadas em `primary-soft`, datas em pílula e notas internas no tom semântico de alerta.
- Harmonizar o painel de detalhes com a terceira superfície e manter todos os seus campos e ações.
- Eliminar rolagem horizontal e garantir que o cabeçalho do chat permaneça acessível em 1024px com janela baixa.

## Detalhes técnicos
- Reutilizar tokens e componentes semânticos já existentes no CRM; nenhuma cor de marca será fixada.
- Fazer alterações visuais pontuais em `CrmConversas` e nos componentes de mensagem, data, nota e status usados pela tela.
- Preservar virtualização, painéis redimensionáveis, seleção de conversa, envio, menus e regras de canal.
- Validar em 1440, 1280, 1024 com altura reduzida e 390px, além de conferir modo claro/escuro quando disponível.
