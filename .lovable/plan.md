## Página de Ligações (histórico estilo WhatsApp)

Criar uma nova página no CRM com o histórico completo de todas as ligações de voz do WhatsApp, com filtros por tipo (atendidas, perdidas, recusadas, bloqueadas) e player de áudio da gravação nas ligações atendidas.

### Onde vai aparecer
- Novo item na sidebar do CRM: **Ligações** (ícone de telefone), entre "Conversas" e "Calendário".
- Rota: `/crm/ligacoes`.

### Layout da página

Cabeçalho com título "Ligações" e filtros:
- **Abas de tipo** (chips no topo): Todas · Atendidas · Perdidas · Recusadas · Bloqueadas · Não completadas
- **Campo de busca** por nome do lead ou telefone
- **Filtro de data** (presets de calendário já usados em outros lugares do CRM)
- **Filtro por direção**: Todas / Recebidas / Realizadas

Lista principal (uma linha por ligação, ordenada da mais recente para a mais antiga):

```text
[avatar/ícone]  Nome do lead                          14:32
                📞↙ Recebida · 02:14                  hoje
────────────────────────────────────────────────────────
[avatar]        João Silva                            11:07
                📞↗ Perdida                           hoje
────────────────────────────────────────────────────────
[avatar]        Maria (novo lead)                     ontem
                🚫 Bloqueada pelo cliente
```

Cada linha mostra:
- Nome do lead (ou telefone se não houver lead vinculado)
- Ícone + rótulo do tipo (recebida/realizada, atendida/perdida/recusada/bloqueada, não completada, falhou)
- Duração formatada (mm:ss) quando atendida
- Horário/data relativa
- Botão "Abrir conversa" à direita → leva para `/crm/conversa/:leadId`

### Detalhes ao clicar

Clique na linha abre um painel lateral (Sheet) com:
- Dados do lead (nome, telefone, foto se houver)
- Direção, status, início, conexão, fim, duração
- Quem iniciou / quem atendeu (usuário do CRM)
- Mensagem de erro (quando aplicável — por exemplo o "sem permissão de ligação aprovada")
- **Player de áudio** com a gravação (quando atendida e houver `recording_url`), com controle de velocidade 1x-2x e botão de transcrever, iguais aos áudios da conversa
- Botão "Ir para a conversa"
- Botão "Ligar de volta" (só quando dentro da janela de 24h e o lead permite ligações)

### Classificação dos tipos

A tabela `whatsapp_calls` já tem `status`, `direction`, `duration_seconds` e `error_message`. A categoria é derivada assim:
- **Atendida**: `status = 'completed'` e `duration_seconds > 0`
- **Perdida**: `direction = 'inbound'` e `status in ('missed','no_answer','ringing_timeout')` ou `duration_seconds = 0`
- **Recusada**: `status = 'rejected'`
- **Bloqueada**: `error_message` contém "No Approved Call Permission" / `error_subcode = 2593090` — mesmo sinal usado no toast atual
- **Não completada / Falhou**: `status in ('failed','error')` sem enquadrar em bloqueada
- **Em andamento**: `status in ('ringing','connecting','connected')` — mostradas separadas no topo com badge "Ao vivo"

### KPIs no topo

Cards resumo do período filtrado:
- Total de ligações
- Taxa de atendimento (atendidas ÷ total)
- Tempo médio de atendimento
- Perdidas / Recusadas / Bloqueadas (contadores)

### Detalhes técnicos

- **Nova página**: `src/pages/CrmLigacoes.tsx`, registrada em `src/App.tsx` como rota preguiçosa, com prefetch igual às outras.
- **Item de menu**: adicionar em `src/components/CrmLayout.tsx` entre Conversas e Calendário, com ícone `Phone` do lucide.
- **Fonte de dados**: `SELECT` em `whatsapp_calls` com `LEFT JOIN` implícito via query separada para `crm_leads` (nome, telefone, avatar) usando o `lead_id`, ordenado por `started_at DESC`, paginado (50 por página, scroll infinito).
- **Realtime**: subscrição no canal `postgres_changes` de `whatsapp_calls` para atualizar a lista quando entram chamadas novas ou terminam (mesmo padrão usado hoje pelo `WhatsappCallContext`).
- **Storage da gravação**: reutilizar o `recording_url` já persistido em `whatsapp_calls` e o mesmo bucket privado `call-recordings` — a URL assinada de 1 ano gerada no upload já cobre a exibição. Se estiver expirada, o front regenera via função utilitária existente `getSignedMediaUrl`.
- **Transcrição**: reaproveitar `AudioTranscriptionToggle` + edge function `transcribe-audio`. Como a transcrição hoje é indexada por `messages.id`, adicionar a coluna `transcription text` em `whatsapp_calls` (migration) e o botão passa a gravar/ler direto ali; sem impacto em outros lugares.
- **Permissões**: RLS já existente em `whatsapp_calls` (por `tenant_id`) cobre a visualização; a página só lista o que o usuário já vê.
- **Sem mudança no fluxo de ligação** em si — a página é somente leitura sobre dados que já são gravados.

### Fora do escopo

- Não altera o pop-up de chamada atual, nem o WhatsappCallContext.
- Não altera as bolhas de "📞 Chamada de voz" já exibidas dentro da conversa (elas continuam funcionando; a página nova é a visão consolidada de tudo).
- Não expõe áudio de ligações não atendidas (elas nunca têm gravação).