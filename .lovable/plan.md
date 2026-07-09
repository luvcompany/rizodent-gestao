## Corrigir transcrição de ligações + criar lead automático em ligações recebidas

Duas mudanças pequenas e independentes.

### 1) Transcrição das gravações de ligação

Hoje a transcrição usa o modelo configurado em `ai_assistant_config.transcription_model` (padrão Gemini via chat completions com `input_audio`). As gravações de ligação são `audio/webm;codecs=opus` — o Gemini via chat completions falha silenciosamente com esse container e retorna vazio/erro, e o botão fica sem resposta.

Correção:
- Quando a origem for uma gravação de ligação (URL do bucket `call-recordings` ou MIME `audio/webm`/`opus`), a edge function `transcribe-audio` passa a usar o endpoint dedicado de STT do Lovable AI Gateway (`/v1/audio/transcriptions` com `openai/gpt-4o-mini-transcribe`), que aceita webm nativamente e é o caminho recomendado para transcrição de áudio real.
- Áudios normais de conversa (mensagens `type=audio`, que são OGG/Opus do WhatsApp) continuam pelo caminho atual (Gemini) — sem alteração de comportamento para eles.
- Adicionar logs claros de status/erro do gateway na função para diagnósticos futuros (`console.error` com corpo da resposta).
- Surfacear o erro real no `toast` do botão (hoje ele apenas mostra "Erro ao transcrever áudio"; passa a mostrar a mensagem retornada quando houver).

### 2) Criar lead automaticamente para ligações recebidas de números fora do CRM

Hoje, no `whatsapp-webhook`, se o telefone da chamada não bate com nenhum lead do tenant, `leadId` fica `null` e:
- a ligação é gravada em `whatsapp_calls` sem `lead_id`;
- nenhuma linha de `messages` é criada, então a conversa não existe.

Correção (só para `direction = 'inbound'` e evento `connect`/`accept`/`terminate`):
1. Normaliza o telefone remoto pelas mesmas regras já em uso (`+55`, remove 9º dígito).
2. Se não existe lead com esse telefone no tenant, cria um novo `crm_leads`:
   - `name`: nome do contato do WhatsApp se vier no payload, senão o próprio telefone formatado (`+55 11 …`).
   - `phone`: telefone normalizado.
   - `pipeline_id`: primeiro pipeline do tenant (mesma regra do `generic-lead-webhook`).
   - `stage_id`: primeira etapa desse pipeline.
   - `source`: `ligacao_recebida`.
   - `assigned_to`: usuário `rizodent` do tenant (mesma regra dos webhooks de lead) — quando não achar, deixa `null`.
   - `tenant_id`.
3. Usa o `id` do lead criado (ou o existente encontrado) para gravar a `whatsapp_calls`, criar a `messages` do tipo `call` e atualizar `last_message`/`last_message_at` do lead — igual ao fluxo atual.
4. Guard de idempotência: como o webhook do WhatsApp dispara vários eventos por chamada (`ringing`, `connect`, `terminate`), o passo 2 sempre passa pelo `SELECT` primeiro; só insere se não achou.

Resultado: qualquer ligação recebida abre uma conversa no CRM e aparece tanto em Conversas quanto em Ligações, mesmo se o número for desconhecido.

### Arquivos afetados

- `supabase/functions/transcribe-audio/index.ts` — desvio de rota para webm/call-recordings via `/v1/audio/transcriptions` + logs.
- `supabase/functions/whatsapp-webhook/index.ts` — bloco de criação automática de lead para chamada `inbound` sem match.
- `src/components/chat/AudioTranscriptionToggle.tsx` — mostrar mensagem real de erro no `toast`.

### Fora do escopo

- Não altera fluxo de mensagens (só ligações).
- Não muda modelo/config global de transcrição — o padrão para áudios normais continua como está.
- Não altera nenhuma tabela/RLS — só reaproveita as regras já existentes.