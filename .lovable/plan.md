# Refazer os 5 modelos WhatsApp na Meta

## Contexto

Os 5 modelos abaixo estão `APPROVED` na Meta, mas têm `[Primeiro nome]` e `[Data e Horário]` como texto literal — ou seja, o paciente recebe a palavra `[Primeiro nome]` em vez do nome real. Precisam ser refeitos com placeholders válidos `{{1}}` e `{{2}}`.

| Modelo antigo | Cidade | Header atual |
|---|---|---|
| `agendamento_guanambi_w9yunp` | Guanambi | IMAGEM da clínica |
| `agendamento_itabuna_997814` | Itabuna | IMAGEM da clínica |
| `agendamento_vca_1_ld18jz` | VCA (R. Francisco Andrade) | IMAGEM da clínica |
| `agendamento_vca_2_im8new` | VCA (R. Monsenhor Olímpio) | IMAGEM da clínica |
| `confirmacao_de_agenda_segunda_hw8nan` | Confirmação seg. | Sem header |

Decisões já confirmadas:
- "Serviço: Check-up odontológico" fica **fixo** (sem variável).
- Submissão para Meta **automática** (sem revisão prévia).

## Ponto importante sobre as imagens das clínicas

A submissão de header tipo `IMAGE` na Meta exige um `header_handle` recém-gerado por sessão de Resumable Upload — a URL `scontent.whatsapp.net` que está salva hoje **não funciona** numa nova submissão. Reimplementar o fluxo de upload resumível só para isso é um esforço grande, então proponho:

→ **Converter o header das 4 ag*endamento* para TEXT** com `📍 Agendamento Realizado` (que hoje está no corpo). A informação de localização permanece no corpo do texto. Isso permite submissão 100% automática, sem upload manual.

Se preferir manter as fotos, o caminho alternativo é eu deixar os rascunhos prontos e você reenviar a imagem pela tela Modelos antes de submeter — me avise e eu sigo por aí.

## Conteúdo final dos 5 modelos

Todos `language=pt_BR`, `category=UTILITY` (mais adequado que MARKETING para confirmação de agendamento, evita rejeição), nomes novos com sufixo `_v2`.

### 1. `agendamento_guanambi_v2`
- Header TEXT: `📍 Agendamento Realizado`
- Body:
  ```
  Olá {{1}}! Seu agendamento foi realizado.
  
  Data e horário: {{2}}
  Serviço: Check-up odontológico
  
  Estamos localizados na Rua dos Expedicionários, 71 - Centro, ao lado do banco Santander.
  
  Estaremos te esperando 🧡
  ```
- Footer: `Rizodent`
- Botão URL: `Ver localização` → `https://maps.app.goo.gl/E8MHDBPVp4Mxr4gr6`

### 2. `agendamento_itabuna_v2`
Mesma estrutura, endereço: `Av. Cinquentenário, 375, ao lado da Jan e Ju, em frente ao banco Bradesco`. Botão URL para o mapa de Itabuna.

### 3. `agendamento_vca_1_v2`
Endereço: `R. Francisco Andrade, próximo ao Bigode de Pedral e acima do Ceasa (antiga Meira Gás)`. Botão URL do mapa correspondente.

### 4. `agendamento_vca_2_v2`
Endereço: `R. Monsenhor Olímpio, 37 - Centro, ao lado da Esquina Embalagens`. Botão URL correspondente.

### 5. `confirmacao_de_agenda_segunda_v2`
- Sem header
- Body:
  ```
  Olá {{1}}! Aqui é da Rizodent 🧡✨
  
  Estamos confirmando sua consulta agendada para segunda-feira, {{2}}.
  
  Por favor, responda "Sim" para confirmar ou "Quero reagendar" se precisar de outra data.
  
  Aguardamos você 😊
  ```
- Botões Quick Reply: `Sim!` e `Quero reagendar.`

## Mapeamento dos placeholders

Já existe em `send-whatsapp-message`:
- `{{1}}` → `lead.name` (primeiro nome)
- `{{2}}` → próxima data/hora do agendamento

Nada precisa mudar no backend de envio.

## Passos de execução

1. **Migração** insere as 5 novas linhas em `crm_whatsapp_templates` (status `DRAFT`, tenant Rizodent).
2. **Submeter à Meta**: invocar a edge function `submit-whatsapp-template` 5 vezes (uma para cada). Cada chamada cria o modelo na Meta e atualiza `status=PENDING` + `meta_template_id`.
3. **Aguardar aprovação** (geralmente minutos). A sincronização automática já existente vai mover para `APPROVED`.
4. **Excluir os 5 antigos** chamando `manage-whatsapp-templates` com `action: "delete"` para cada um — apaga da Meta e do banco local.

Os passos 2–4 ficam num botão único "Migrar para placeholders" na tela Modelos (UI temporária), porque as edge functions exigem sessão autenticada de admin/gerente — não dá para rodar 100% no backend sem expor service role. Você clica uma vez e o frontend executa as 9 chamadas em sequência.

## Arquivos a alterar

- `supabase/migrations/...` — inserir 5 novos modelos DRAFT.
- `src/pages/CrmModelos.tsx` — adicionar botão "Migrar 5 modelos antigos" (one-shot), que:
  1. chama `submit-whatsapp-template` para cada `*_v2`;
  2. chama `manage-whatsapp-templates` action `delete` para cada modelo antigo;
  3. mostra progresso por modelo (toast).

Após uso, o botão pode ser removido na próxima limpeza — fica visível só enquanto algum modelo com `[colchete]` existir.

## Riscos / observações

- Se a Meta rejeitar algum modelo (texto fora de política), o antigo correspondente **não** é excluído — o botão só apaga após sucesso da criação.
- Categoria `UTILITY` cobra menos que `MARKETING` por mensagem e tem aprovação mais rápida. Confirma se topa.
- O nome `_v2` é definitivo; a Meta bloqueia o nome antigo por ~30 dias após delete.
