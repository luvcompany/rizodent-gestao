

# Plano: Dropdown de Origem + Vinculação a Anúncio com Miniatura

## Objetivo
No `LeadEditPanel`, substituir o campo de texto livre "Origem" por um dropdown com opções pré-definidas e adicionar um seletor visual de anúncios que mostra miniaturas dos criativos já cadastrados no sistema.

## O que será feito

### 1. Dropdown de Origem
Substituir o `<Input>` de origem por um `<Select>` com opções:
- `whatsapp` / `facebook_ad` / `instagram_ad` / `indicação` / `orgânico` / `site` / `ligação` / `outro`
- Quando "outro" for selecionado, exibir campo de texto livre

### 2. Seletor Visual de Anúncio
Abaixo do dropdown de origem, adicionar uma seção "Vincular a Anúncio" que:
- Busca anúncios distintos do banco (`crm_leads` com `ad_id IS NOT NULL`), agrupados por `descricao_anuncio` (para não duplicar criativos iguais)
- Exibe uma lista/grid com miniatura (`imagem_origem`), nome do anúncio e trecho da descrição
- Ao clicar, vincula o lead preenchendo: `ad_id`, `imagem_origem`, `nome_anuncio`, `descricao_anuncio`, `link_anuncio`, e atualiza `source` para `facebook_ad` ou `instagram_ad`
- Botão para desvincular anúncio se já houver um vinculado
- Placeholder de vídeo para anúncios sem imagem

### 3. Tipo Lead expandido
Expandir o tipo `Lead` no componente para incluir os campos de anúncio (`ad_id`, `imagem_origem`, `nome_anuncio`, `descricao_anuncio`, `link_anuncio`) e salvá-los no `handleSave`.

## Detalhes Técnicos

### Query de anúncios distintos
```typescript
const { data: ads } = await supabase
  .from("crm_leads")
  .select("ad_id, imagem_origem, nome_anuncio, descricao_anuncio, link_anuncio")
  .not("ad_id", "is", null)
  .limit(500);
// Agrupar por descricao_anuncio para deduplificar
```

### Arquivo afetado
| Arquivo | Ação |
|---|---|
| `src/components/chat/LeadEditPanel.tsx` | Adicionar Select de origem, seletor visual de anúncio com miniaturas, salvar campos de anúncio |

