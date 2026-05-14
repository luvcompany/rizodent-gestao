## Objetivo

Remover da página de Integrações (`/crm/integracoes`) as informações sensíveis do Meta App (Callback URLs, Verify Tokens, OAuth Redirect URI e o switch "Ativar" que aparecia no card global do WhatsApp/Instagram dentro da seção "Conecte sua conta ao nosso Meta App"). Em vez disso, manter apenas os cards principais (WhatsApp Business e Instagram Lite) que abrem os popups de configuração, e colocar o toggle ativar/desativar dentro de cada conta conectada listada nos popups.

## Mudanças

### 1. Esconder a seção de credenciais do Meta App
Em `src/pages/CrmIntegracoes.tsx`:
- Remover o `<MetaAppCredentialsSection />` da renderização (e remover o import).
- Remover também o aviso azul "Conecte sua conta ao nosso Meta App" que está no rodapé da página (vindo dessa seção).

Resultado: o usuário não vê mais Callback URL, Verify Token, OAuth Redirect URI, nem o switch global por canal. Os secrets continuam configurados no backend; apenas a UI deixa de expô-los. A função `tenant-meta-info` continua existindo (uso interno do nosso técnico), mas não é mais chamada pelo frontend.

### 2. Toggle ativar/desativar por conta conectada

**WhatsApp** (cards na grade `whatsappEntries` em `CrmIntegracoes.tsx`):
- Já existe um `Switch` por card que chama `handleToggleIntegration` alternando `integrations.status` entre `connected` e `disabled`. Está correto — manter como está. Apenas garantir que esse é o único ponto de ativar/desativar (já que o switch global está sendo removido).

**Instagram Lite** (cada `IgAccount` listada no popup em `InstagramLiteSection.tsx`):
- Adicionar um `Switch` ao lado do badge "Ativo/Token expirado" e antes do botão de lixeira.
- O switch lê e grava `ig_accounts.active`. Quando `active = false`, o badge passa a "Inativo" e a conta não envia/recebe mensagens (a lógica de webhooks/envio Instagram já consulta `active`).
- Handler novo `handleToggleActive(acc)` que faz `update({ active: !acc.active })` em `ig_accounts` e recarrega a lista.
- Atualizar o contador "X ativas" do card principal para considerar `active === true` (além de token não expirado).

### 3. Limpeza
- Manter o arquivo `src/components/integrations/MetaAppCredentialsSection.tsx` no projeto (não deletar) caso seja necessário no futuro para uso interno/superadmin, mas ele deixa de ser importado.

## Detalhes técnicos

- Nenhuma mudança no banco: a coluna `ig_accounts.active` já existe e `integrations.status` já é usada.
- Nenhuma mudança em edge functions.
- Trabalho 100% frontend, em 2 arquivos:
  - `src/pages/CrmIntegracoes.tsx` — remover import + render do `MetaAppCredentialsSection`.
  - `src/components/integrations/InstagramLiteSection.tsx` — adicionar Switch por conta, handler de toggle, ajustar contagem de "ativas".
