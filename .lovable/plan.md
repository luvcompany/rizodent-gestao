# Plano

## 1. Salvar a chave da Anthropic com segurança
- A chave que você colou no chat será armazenada como secret `ANTHROPIC_API_KEY` no backend (Lovable Cloud), via `set_secret`. Ela fica acessível apenas para as edge functions, nunca para o navegador.
- **Importante:** como ela apareceu em texto plano no chat, recomendo revogá-la no console da Anthropic e gerar uma nova depois de salvarmos — chaves expostas em qualquer canal devem ser rotacionadas.
- Após salvar o secret, a função `generate-reply-suggestion` voltará a usar os modelos `anthropic/*` (Claude Sonnet/Haiku) selecionados em Configurações → IA → Bia, sem precisar do fallback para o Gemini.

## 2. Exibir a barra da Bia também em `/crm/conversas`
Hoje o componente `AiSuggestionStrip` (sugestão da Bia com ✓/✗, edição inline e handoff) só aparece em `src/pages/CrmConversa.tsx` (página de conversa individual). Vou replicar exatamente o mesmo posicionamento em `src/pages/CrmConversas.tsx` (a lista lateral com chat embutido):

- Importar `AiSuggestionStrip` no topo do arquivo.
- Inserir o componente imediatamente **acima** do `<ChatInput>` (linha ~1278), dentro do mesmo bloco condicional do lead selecionado.
- Renderizar apenas quando o canal resolvido for `whatsapp` (mesma regra usada em `CrmConversa.tsx`); para Instagram não mostramos (a Bia só envia WhatsApp).
- Props: `leadId={selectedLeadId}` e `leadPhone={selectedLead.phone}`, idênticas às de `CrmConversa.tsx`.
- O componente já tem subscription Realtime própria por `lead_id`, então não precisa de nenhuma mudança de estado na página — basta montar.

## 3. Validação
- Abrir `/crm/conversas`, selecionar um lead de WhatsApp, e conferir que a tira da Bia aparece acima do campo de digitação, com o botão "Sugerir resposta (Bia)" quando não há sugestão pendente.
- Disparar uma sugestão e confirmar que ela usa um modelo `anthropic/*` (visível no badge), comprovando que o `ANTHROPIC_API_KEY` está ativo.

## Notas técnicas
- Nenhuma alteração de banco de dados.
- Nenhuma mudança em edge functions — o suporte a Anthropic já está implementado e cai sozinho de volta para o Gateway se a chave for removida.
- Apenas dois arquivos editados: `src/pages/CrmConversas.tsx` (import + uma linha no JSX) e o secret store.
