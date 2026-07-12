
## O que vamos resolver

Dois problemas observados na conversa do Rafael:

1. **Bot aceitou "Olá! Posso ter mais informações sobre isso?" como nome completo** — o bloco de captura do nome grava qualquer texto e avança de etapa, sem sanitizar.
2. **Template de confirmação exibiu `Período: 🌅 Manhã]`** — sobrou um `]` porque o texto do bloco no editor de bot está com bracket desbalanceado (é conteúdo configurado pelo usuário no `flow_json`, não código).

## Escopo

### 1. Validação de "nome completo" no bloco de espera de resposta (bot-engine)

- Adicionar um flag opcional `validateAs: "full_name"` em nós de captura (`wait_reply` e nós `send_text`/`send_menu` com `saveToField`).
- Novo helper `isLikelyFullName(text)` no `supabase/functions/bot-engine/index.ts` com heurísticas simples:
  - Rejeita se contiver `?`, `!`, URL, dígitos.
  - Rejeita saudações/perguntas típicas: `olá`, `oi`, `bom dia`, `boa tarde`, `boa noite`, `informações`, `preço`, `valor`, `quero`, `posso`, `como`, `quando`, `onde`, `porque`.
  - Exige ao menos 2 palavras alfabéticas, cada uma com ≥ 2 letras, comprimento total 4–80 chars.
- No handler de resposta (linhas ~473–522), antes de gravar `saveToField` e escolher `nextEdge`: se o nó tem `validateAs === "full_name"` e a resposta falha na validação, **re-envia um prompt amigável e mantém `status: "waiting_reply"`** (mesmo padrão do fallback de menu já existente nas linhas 508–522).
- Contador `invalid_attempts` nas `variables` da execução; após 2 tentativas inválidas, encerra a execução com `status: "completed"` e motivo `"name_validation_exhausted"` para que a atendente humana entre.
- Mensagem de re-prompt configurável por nó (`invalidReplyMessage`), com fallback `"Só pra confirmar, me diga seu nome completo (nome e sobrenome), por favor 🙂"`.

### 2. UI: toggle no editor de bot

- Em `src/components/bot-editor/NodePropertiesPanel.tsx`, quando o nó tiver `saveToField` preenchido, exibir:
  - Select "Validar resposta como": `Nenhuma` | `Nome completo`.
  - Campo `Mensagem de re-prompt` (opcional) quando validação ativa.
- Persistido em `node.data.validateAs` e `node.data.invalidReplyMessage`.

### 3. Aviso de brackets/placeholders desbalanceados no editor

- Em `NodePropertiesPanel.tsx`, no editor de texto de mensagem (VariableTextarea), adicionar um pequeno aviso inline (texto laranja abaixo do campo) quando detectarmos `[`/`]`, `{{`/`}}` ou `*` desbalanceados no texto atual do nó.
- Isso não altera nada automaticamente — só ajuda o usuário a encontrar o `]` sobrando no template de confirmação e corrigir manualmente no bot editor.

### 4. Deploy

- Redeploy da edge function `bot-engine` após as mudanças.

## Fora de escopo

- Não vamos editar o `flow_json` do bot em produção automaticamente — a correção do `]` no template de confirmação será feita pelo usuário no bot editor (o aviso de bracket desbalanceado o guia até lá).
- Nenhuma mudança em banco, RLS, ou outras edge functions.
- Sem alteração no fluxo de mensagens já existente que não use `validateAs`.

## Arquivos afetados

- `supabase/functions/bot-engine/index.ts` — helper de validação + branch de re-prompt.
- `src/components/bot-editor/NodePropertiesPanel.tsx` — toggle de validação + aviso de brackets.
