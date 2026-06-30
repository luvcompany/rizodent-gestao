## Objetivo
No `AutomationModal` (gatilhos "Enviar arquivo" e "Enviar áudio"), substituir os campos de URL livre por upload real de mídia (e gravador no caso de áudio), reaproveitando as regras do CRM Conversa/Conversas.

## Mudanças

### 1. `src/components/automation/AutomationModal.tsx` — bloco `ActionConfigInline`

**Enviar arquivo (`send_file`):**
- Remover o input "URL do arquivo".
- Adicionar botão "Selecionar arquivo" (`<input type="file">`) aceitando imagem, vídeo e documento.
- Validar tamanho seguindo o ChatInput:
  - Imagem ≤ 5 MB (com compressão automática se > 4 MB, via `compressImage`)
  - Vídeo ≤ 16 MB
  - Documento ≤ 100 MB
- Upload no bucket `chat-media` (mesmo path padrão usado pelo ChatInput) e gravar a URL pública resultante em `file_url` + também salvar `file_name` e `file_mime` em `config` para reuso.
- Mostrar preview com nome/tamanho + botão para remover/trocar.
- Indicador de "Enviando..." durante upload.

**Enviar áudio (`send_audio`):**
- Remover o input "URL do áudio".
- Duas opções em tabs/botões: **Gravar** e **Enviar arquivo**.
  - **Gravar**: integrar o `AudioRecorderComposer` (já existente). Ao confirmar, converter via mesma lógica do ChatInput (OGG/Opus nativo ou via OpusMediaRecorder), upload no bucket `chat-media` pasta `audio`, e gravar `audio_url`.
  - **Upload**: `<input type="file" accept="audio/*">` com mesmo limite/processamento usado no chat (sem conversão para WAV/Instagram, já que automação é WhatsApp).
- Mostrar player simples para o áudio escolhido e botão "Regravar/Trocar".

### 2. Reuso/refator leve
- Extrair helper `uploadAutomationMedia(file, folder)` em `src/components/automation/automationMediaUpload.ts` (espelho do `uploadFile` do ChatInput) para manter o ChatInput intacto.
- Reutilizar `compressImage` de `src/components/chat/imageCompressor`.
- Reutilizar `AudioRecorderComposer` (props já compatíveis: `onConfirm(blob)`).

### 3. Compatibilidade com backend
- `automation-engine` / `automation-queue-worker` já enviam via `send-whatsapp-message` usando `file_url` / `audio_url`. Não precisa mexer no backend — só garantir que a URL salva é pública e acessível pela Meta (bucket `chat-media` já tem policy de leitura pública assinada / signed URL — manter mesma estratégia do chat).
- Se o bucket não for público, gerar `createSignedUrl` com validade longa (ex.: 7 dias) ou usar a mesma URL pública que o `ChatInput` usa hoje (via `getPublicUrl`). Manter exatamente o mesmo método do ChatInput para consistência.

## Fora de escopo
- Não alterar `CrmConversa.tsx` / `CrmConversas.tsx`.
- Não alterar a tabela de automações nem o schema do `config` JSONB (apenas adicionamos campos opcionais `file_name`/`file_mime` que já são tolerados).
- Não mexer em outros tipos de ação (template, bot, webhook, etc.).
