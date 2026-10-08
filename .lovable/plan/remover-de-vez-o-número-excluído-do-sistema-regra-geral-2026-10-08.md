# Remover de vez o número excluído do sistema (regra geral)

## Situação confirmada

Você excluiu a integração do número de contingência (+55 77 8128-1211) na tela Integrações, mas o cadastro dele continuou ativo. Por isso ele ainda aparece:

- na lista "Enviar por:" da conversa de cada lead;
- no seletor "Número padrão de envio" da aba Integrações;
- os 12 modelos dele continuam aparecendo nas listas de modelos.

## O que será feito

### 1. Limpeza do contingência (agora)

- **Desativar o número no cadastro** — o "Whatsapp Contingência" deixa de constar como número ativo e some de "Enviar por:", do seletor de padrão e dos selos de status.
- **Remover os 12 modelos dele** da tela de Modelos (já não existem na Meta, a conta foi banida).
- **Limpar as permissões** que davam acesso a esse número às usuárias.

### 2. Regra automática para qualquer número excluído (daqui em diante)

Quando você excluir a integração de **qualquer** número de WhatsApp (em Integrações ou em Conexões), o sistema faz sozinho, na mesma hora:

- desativa o número no cadastro — ele some de "Enviar por:", do seletor de número padrão e da checagem de saúde;
- remove as permissões de acesso daquele número;
- esconde os modelos daquele número nas telas de Modelos, Transmissão e gatilhos (as listas passam a mostrar só modelos de números ativos).

Se o número excluído era o **padrão de envio**, o padrão fica vazio e você escolhe outro na aba Integrações (o seletor novo já mostra o aviso "Escolha o número…").

## O que NÃO muda

- Nenhum lead é apagado nem movido. Leads que tinham o número excluído como "Enviar por:" voltam a usar o número padrão.
- O histórico de mensagens trocadas pelo número continua nas conversas, com a marca do número.
- Os 145 modelos antigos sem número vinculado não são tocados.
- O "Rizodent - Comercial 2" continua como padrão de envio.

## Detalhes técnicos

- Limpeza imediata: `UPDATE whatsapp_numbers SET is_active = false` no número 232255f7 (phone_number_id 1440612142459013); `DELETE` dos 12 templates e das permissões (`user_permission_overrides`) desse número.
- Regra geral: trigger `AFTER DELETE` em `integrations` (chaves `whatsapp_%`) que desativa o `whatsapp_numbers` correspondente e remove suas permissões — migração nova.
- Telas de Modelos, Transmissão e gatilhos: filtro para só listar modelos cujo `whatsapp_number_id` está ativo (ou sem número vinculado, como hoje).
