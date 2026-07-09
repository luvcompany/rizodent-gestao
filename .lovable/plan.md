# Ligações WhatsApp no CRM — Receber e Fazer

Integração da **WhatsApp Business Calling API** (Meta Cloud API) para receber chamadas dos leads e originar chamadas do CRM, tudo dentro da tela de Conversas, usando o mesmo número já conectado (+55 77 8114-7531).

---

## O que o usuário verá

**Receber ligação (user-initiated)**
- Quando um lead ligar pelo WhatsApp, aparece um **modal de chamada recebida** no CRM (toque + notificação do navegador) com nome, foto e botões **Aceitar / Recusar**.
- Ao aceitar, abre a barra de chamada em cima da conversa: cronômetro, mudo, alto-falante, encerrar.
- Áudio flui direto entre o navegador do atendente e o cliente (WebRTC/Opus).
- Após encerrar, o registro entra na timeline da conversa (duração, status: atendida/perdida/recusada).

**Fazer ligação (business-initiated)**
- Botão de **telefone** no cabeçalho da conversa.
- Se o lead **ainda não deu permissão**, o CRM envia primeiro uma **mensagem de permissão de chamada** (padrão Meta). O lead aprova no WhatsApp e só então o botão fica ativo (limite Meta: 100 chamadas/dia por par após aprovação).
- Se já houver permissão válida, clique disca direto.

**Histórico**
- Aba **Registros de ligações** por conversa e um relatório geral (atendidas, perdidas, duração média, por atendente).

---

## Pré-requisitos (fora da plataforma, que só você resolve)

1. **Habilitar Calling** no número em *WhatsApp Manager → Configurações de ligação* (você já está nessa tela — o toggle "Permitir ligações de voz" precisa ficar **Ativado** ✅ está ok).
2. Limite de mensagens do número: **≥ 2.000 destinatários únicos/dia** (exigência Meta para produção; teste funciona com número sandbox).
3. O App Meta (`META_APP_ID_V2`) precisa estar inscrito no campo de webhook **`calls`** da WABA — feito via Graph API no deploy.
4. Permissão `whatsapp_business_messaging` já concedida (ok).

---

## Etapas de implementação

### Fase 1 — Webhook e registro de chamadas (receber sinalização)
- **Edge function `whatsapp-calls-webhook`**: recebe eventos `calls` (`connect`, `terminate`, `status`) da Meta, valida assinatura HMAC, grava em `whatsapp_calls` e emite Realtime pro frontend.
- Nova tabela `whatsapp_calls` (id, conversation_id, lead_id, phone_number_id, wa_call_id, direction, status, started_at, ended_at, duration_seconds, initiated_by user_id, sdp offer/answer, ice candidates jsonb) com RLS por tenant.
- Assinatura automática no campo `calls` da WABA logo após conexão do Instagram/WhatsApp (patch no fluxo OAuth existente).

### Fase 2 — Sinalização WebRTC (áudio funcionando)
- **Edge function `whatsapp-call-signaling`**: proxy para Graph API `POST /{phone_number_id}/calls` com ações `pre_accept`, `accept`, `reject`, `terminate` e troca de SDP/ICE.
- **Hook `useWhatsappCall`** no frontend: cria `RTCPeerConnection` (Opus, STUN público), envia offer/answer via edge function, aplica ICE candidates recebidos do webhook via Realtime.
- **Componente `IncomingCallModal`**: escuta Realtime na tabela `whatsapp_calls` (filtrado por tenant + atendente atribuído), toca ringtone, aceita/recusa.
- **Componente `ActiveCallBar`**: fica no topo da conversa durante chamada ativa.

### Fase 3 — Chamadas originadas pelo CRM
- Botão de telefone no header da conversa (`ConversationView`).
- **Edge function `whatsapp-request-call-permission`**: envia template Meta de permissão de chamada; grava estado em `whatsapp_call_permissions` (lead_id, status, expires_at).
- Ao clicar em ligar: verifica permissão; se ausente/expirada, mostra confirmação "enviar pedido de permissão?"; se aprovada, chama `POST /{phone_number_id}/calls` com `action=connect`.
- Trata limites Meta: 100 chamadas/dia por par, revogação após 4 não atendidas consecutivas (mostra aviso no UI).

### Fase 4 — Histórico e relatórios
- **Aba "Ligações"** dentro da conversa: lista `whatsapp_calls` do lead com play de gravação (fase futura), botão "ligar de volta".
- **Página `/crm/relatorios/ligacoes`**: KPIs (total, atendidas, perdidas, duração média), filtro por atendente/período, exportação CSV.
- Contador de chamadas perdidas no badge de navegação (reaproveita padrão `crm-navigation-badges`).

---

## Detalhes técnicos

- **Sinalização**: Graph API + webhook (padrão, sem SIP). Sem servidor SIP nem Asterisk.
- **Mídia**: WebRTC direto do navegador do atendente. STUN público do Google + fallback (TURN não necessário para maioria dos casos; se tiver problema de NAT, avaliar TURN pago numa fase 2).
- **Segurança**: assinatura HMAC do webhook validada com `META_APP_SECRET_V2`; RLS em `whatsapp_calls` por tenant; JWT do usuário validado no edge de sinalização.
- **Reconexão OAuth**: adicionar scope `whatsapp_business_management` já está presente; escopos existentes cobrem calling.
- **Multi-tenant**: `phone_number_id` já existe em `whatsapp_connections`, roteia webhook pelo `metadata.phone_number_id` do payload.
- **Sem SIP nesta rodada** — se depois quiser plugar numa central telefônica existente, migra para SIP+SDES numa fase posterior.

---

## Fora do escopo (por enquanto)
- Vídeo e compartilhamento de tela (Meta ainda em desenvolvimento).
- Gravação de áudio da chamada (Meta não fornece nativo; teria que gravar no navegador com consentimento — fase futura).
- URA/IVR e distribuição automática entre atendentes.
- SIP/Asterisk.

---

## Ordem de entrega sugerida
1. Fase 1 (webhook + tabela + assinatura) — ~1 iteração
2. Fase 2 (WebRTC receber) — ~2 iterações (a parte mais complexa)
3. Fase 3 (originar chamadas) — ~1 iteração
4. Fase 4 (histórico/relatórios) — ~1 iteração

Aprova esse plano? Posso começar pela Fase 1.
