## Ajuste no system prompt da Bia (`generate-reply-suggestion`)

Escopo: apenas backend, arquivo `supabase/functions/generate-reply-suggestion/index.ts`. Sem mudanças de UI, modelo, RAG ou tabelas.

### O que muda

Adicionar ao `SYSTEM_PROMPT` (bloco de diretrizes) uma seção **"Como pensar antes de responder"** que replica o raciocínio que apliquei ao analisar a sugestão do Adriano:

1. **Ler a última mensagem do lead como prioridade #1.** Se houver pergunta, dúvida ou informação nova (ex.: "posso levar acompanhante?", "tenho medo"), responder isso ANTES de seguir qualquer script/agendamento.
2. **Diferenciar solicitação de agendamento vs. agendamento confirmado.**
   - Se o horário veio de formulário/anúncio/preferência do lead e **não há confirmação registrada pela equipe** no histórico → tratar como **solicitação** ("vou verificar a disponibilidade e já te confirmo").
   - Se há mensagem anterior da equipe confirmando explicitamente (ou registro em `crm_lead_stage_history` de etapa "Agendado") → pode confirmar normalmente.
   - **Exceção horário comercial:** dentro do horário comercial configurado (usar `ai_assistant_config.shift_start`/`shift_end`, fuso America/Bahia) a Bia PODE confirmar o horário solicitado diretamente, sem "vou verificar", desde que o horário pedido também caia em horário de atendimento da clínica. Fora do expediente, sempre tratar como solicitação a confirmar.
3. **Evitar saudações longas em primeiro contato via formulário.** Ir direto ao ponto (cumprimento curto + resposta objetiva).
4. **Parafrasear/acolher conteúdo emocional** (medo, dúvida) antes de dados operacionais.
5. **Respeitar continuidade temporal** (já existia, reforçar): não repetir informação já dada, não reabrir tópico já resolvido, considerar o tempo desde a última interação (via timestamps `[dd/MM HH:mm]` que já são injetados).
6. **Uma pergunta por vez** quando faltar informação — não empilhar 3 perguntas na mesma mensagem.
7. **Coerência com etapa/desfecho** (já existia, mantido): não reiniciar fluxo se etapa é Desqualificado/Ganho/Compareceu.

### Como aplicar tecnicamente

- Localizar a montagem do system prompt em `generate-reply-suggestion/index.ts` e acrescentar um bloco `### RACIOCÍNIO ANTES DE RESPONDER` com as 7 diretrizes acima em linguagem imperativa curta.
- Ler `ai_assistant_config.shift_start` e `shift_end` (já são consultados em `auto-send-suggestions`) e injetar no prompt uma linha de FATO: `HORÁRIO COMERCIAL ATUAL DA CLÍNICA: HH:MM–HH:MM (America/Bahia). Agora são [dd/MM HH:mm].` Assim a IA sabe se pode confirmar direto ou precisa dizer "vou verificar".
- Não mexer em `AiSuggestionStrip.tsx`, `record-good-example`, RAG nem no fluxo de aprendizado.

### Validação

Reabrir a conversa do Adriano, clicar "Sugerir resposta" e conferir se a nova sugestão:
- Acolhe a mensagem livre dele antes do agendamento.
- Confirma o horário direto (estamos em horário comercial) sem inventar "já anotei" caso não haja confirmação prévia — ou confirma com naturalidade se o horário pedido está dentro do expediente.
- Não abre com saudação longa.
