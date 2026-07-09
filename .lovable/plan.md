# Diarização nas transcrições de ligação

## Contexto

Hoje `transcribe-audio` envia a gravação da ligação para o Lovable AI Gateway (`openai/gpt-4o-mini-transcribe`) e recebe um bloco único de texto — sem separação de falantes. Os modelos STT do Gateway (gpt-4o-mini-transcribe / gpt-4o-transcribe) **não fazem diarização**: não existe parâmetro que retorne "speaker 1 / speaker 2".

Existem dois caminhos possíveis. Recomendo o **Caminho A**, porque é determinístico, sem custo extra e usa o que já temos.

---

## Caminho A — Diarização por canal (recomendado)

A ligação WhatsApp Calling é WebRTC: temos duas trilhas de áudio distintas (mic local do atendente + áudio remoto do lead). Se gravarmos como **áudio estéreo** — atendente no canal esquerdo, lead no canal direito — dá para separar os falantes com 100% de precisão, sem depender de IA de diarização.

Fluxo:

1. **Gravação (frontend, `whatsapp-call-session.ts`):** trocar o `MediaRecorder` atual (mix mono) por um `MediaStreamDestination` com `AudioContext`, roteando `localStream` para o canal L e `remoteStream` para o canal R via `ChannelMergerNode`. Resultado: um `.webm` estéreo em vez de mono. Nada muda no upload nem no bucket.

2. **Backend (`transcribe-audio/index.ts`):** ao detectar que a origem é `whatsapp_calls`, dividir o áudio em dois arquivos mono (canal L → atendente, canal R → lead) antes de mandar pro STT. Fazemos duas chamadas ao Lovable Gateway com `openai/gpt-4o-transcribe` pedindo `response_format: "verbose_json"` (traz `segments[]` com `start`/`end`). Depois intercalamos os segmentos por timestamp e montamos:

   ```
   [00:00] Atendente: Alô, aqui é da Rizodent...
   [00:04] Lead: Oi, tudo bem?
   [00:06] Atendente: Tudo, e o senhor?
   ```

3. **Armazenamento:** o texto formatado continua indo para `whatsapp_calls.transcription` (mesma coluna, só o formato muda). Nada quebra na UI atual — o `AudioTranscriptionToggle` já renderiza `whitespace-pre-wrap`.

4. **Backfill:** ligações **antigas** foram gravadas em mono, então não têm como ser diarizadas retroativamente. Elas continuam mostrando a transcrição corrida atual. Só chamadas novas ganham a separação.

### Detalhes técnicos

- **Splitter de canais no edge:** o Deno não tem `ffmpeg` embutido. Duas opções:
  - (a) Usar `ffmpeg` via `Deno.Command` — só funciona se estiver disponível no runtime das Edge Functions (não está por padrão).
  - (b) **Preferido:** decodificar o WebM/Opus no cliente antes do upload usando `AudioContext.decodeAudioData`, extrair os dois canais como PCM, e subir **dois arquivos WAV mono** (`recording-agent.wav`, `recording-lead.wav`) no bucket `call-recordings`. Adicionar coluna `recording_url_agent` / `recording_url_lead` em `whatsapp_calls` (ou um JSONB `recording_tracks`). O edge function só faz duas chamadas STT e intercala.
- **Modelo:** trocar de `gpt-4o-mini-transcribe` para `openai/gpt-4o-transcribe` **apenas para ligações**, porque precisamos de `verbose_json` com timestamps por segmento. Áudios de chat continuam no fluxo atual.
- **Custo:** duas chamadas STT por ligação (uma por canal) em vez de uma. Cada uma processa metade do "áudio ativo" real, mas o billing é por duração total, então **≈ 2× o custo de transcrição por ligação**.

---

## Caminho B — Diarização por IA (alternativa)

Manter gravação mono e pedir ao Gemini (`google/gemini-2.5-flash` via chat completions com `input_audio`) para transcrever **e** rotular falantes por análise de voz. Prompt do tipo "identifique dois falantes A e B pela voz e formate como diálogo".

- **Prós:** funciona retroativamente em gravações antigas; sem mudança no frontend.
- **Contras:** não é diarização real, é heurística — o Gemini erra bastante quando as vozes são parecidas, quando um dos lados fala pouco, ou quando há ruído. Não distingue "quem é o atendente" vs "quem é o lead" sem prompt extra. Já vimos limitações desse approach no `ai-conversation-assist`.

Só recomendo se você quiser diarizar as gravações **já existentes**.

---

## Recomendação

Ir de **Caminho A** para ligações novas. Se você também quiser tratar as antigas, adicionar Caminho B como fallback só para registros com gravação mono (detectável pelo header do WebM).

## Pergunta antes de implementar

1. Fecha com o **Caminho A** (gravação estéreo, diarização determinística, só ligações novas)?
2. Ou quer que eu inclua o **Caminho B** como fallback para as ligações já gravadas?
