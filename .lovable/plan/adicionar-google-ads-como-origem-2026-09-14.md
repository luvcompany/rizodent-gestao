# Adicionar "Google Ads" como origem

Hoje os leads que chegam pelo Google Ads são gravados com a fonte `google_ads` (o webhook do WhatsApp já detecta isso pelo texto da primeira mensagem), mas essa opção não existe em nenhuma lista da tela: nem no filtro das Conversas/Kanban, nem nos campos de Origem do lead. Por isso não dá para filtrar nem para marcar manualmente.

## O que muda

1. **Filtro de Fonte/Integração** (usado nas Conversas e no Kanban): entra a opção "Google Ads", logo abaixo de "Anúncio".
2. **Filtragem**: ao escolher "Google Ads", a lista passa a mostrar os leads gravados como `google_ads` e também os gravados apenas como `google` (leads antigos criados pelo cadastro manual).
3. **Campo Origem do lead** (painel de edição do lead e a edição rápida na conversa): entra "Google Ads" na lista, para poder corrigir manualmente um lead.
4. **Cadastro de lead no Kanban**: a lista de origem passa a ter "Google Ads" com rótulo legível, no lugar do atual "Google".

Nada de dado é alterado em massa: leads já existentes continuam como estão, e o filtro passa a alcançá-los.

## Detalhes técnicos

- `src/components/chat/ConversationFilters.tsx`: novo `SelectItem value="google_ads"`.
- `src/pages/CrmConversas.tsx` (~linha 1174) e `src/pages/CrmKanban.tsx` (~linha 1194): no bloco que compara `filters.source`, tratar `google_ads` como conjunto (`google_ads`, `google`), do mesmo jeito que `anuncio` já agrupa `facebook_ad`/`instagram_ad`.
- `src/components/chat/LeadEditPanel.tsx` e `src/components/chat/InlineTagsEditor.tsx`: acrescentar `{ value: "google_ads", label: "Google Ads" }` em `SOURCE_OPTIONS_DEFAULT`.
- `src/pages/CrmKanban.tsx` (~linha 348): trocar a lista de strings crua por pares valor/rótulo, incluindo `google_ads` → "Google Ads".

Só código de tela — nenhuma migration, edge function ou publish.

## Observação (fora do pedido, se quiser depois)

No filtro atual, "Indicação" e "Orgânico" enviam `indicacao`/`organico` sem acento, enquanto o banco grava `indicação`/`orgânico` — então esses dois filtros provavelmente não retornam nada. Posso corrigir junto se você quiser.
