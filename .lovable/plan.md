

# Plano: Diferenciar anúncios por conta de anúncio (Ad Account)

## Problema
O mesmo criativo (mesma imagem e descrição) é usado em 4 contas de anúncio diferentes (uma por cidade). Com a deduplicação atual por imagem+descrição, todos aparecem como um só.

## Solução
Capturar o **ID e nome da conta de anúncio** via Meta Graph API e usá-lo para diferenciar criativos idênticos entre contas.

## O que será feito

### 1. Novas colunas no banco
Adicionar `ad_account_id` (text) e `ad_account_name` (text) nas tabelas `crm_leads` e `messages`.

### 2. Webhook: capturar conta de anúncio
Na chamada à Graph API que já existe no webhook (linha 341), adicionar `account_id` aos fields solicitados:
```
fields=id,name,permalink_url,account_id,creative{...}
```
E fazer uma segunda chamada rápida para buscar o nome da conta:
```
GET /{account_id}?fields=name
```
Salvar ambos nos campos novos do lead e da mensagem.

### 3. Atualizar deduplicação no seletor e relatórios
A chave de agrupamento passa a incluir `ad_account_id`:
```typescript
const key = `${normalizeImgUrl(img)}::${desc}::${ad_account_id || ""}`;
```
No seletor visual, exibir o nome da conta abaixo do nome do anúncio para facilitar a identificação (ex: "Conta: Rizodent BH").

### 4. Enriquecimento retroativo (opcional)
Criar script/edge function que percorre os leads existentes com `ad_id` preenchido e busca o `account_id` via Graph API para preencher os campos novos.

## Arquivos afetados
| Arquivo | Ação |
|---|---|
| Migração SQL | Adicionar colunas `ad_account_id` e `ad_account_name` em `crm_leads` e `messages` |
| `whatsapp-webhook/index.ts` | Buscar e salvar account_id/name na criação do lead e mensagem |
| `InlineTagsEditor.tsx` | Incluir account na chave de dedup e exibir nome da conta |
| `LeadEditPanel.tsx` | Idem |
| `CrmRelatorios.tsx` | Idem para relatórios |

