# Otimização Mobile do CRM

Hoje o CRM foi desenhado para desktop/iPad. Em telas <768px (celular), os três painéis do `CrmConversas` (lista de leads, chat, painel do lead) aparecem espremidos lado a lado, e o Kanban exige rolagem horizontal extrema. Vou ajustar a experiência mobile sem alterar o comportamento desktop.

## O que muda

### 1. Layout geral (`CrmLayout.tsx`)
- Sidebar já é "drawer" no mobile (ok), mas o `main` tem `p-6` que come espaço. Reduzir para `p-2 sm:p-4 lg:p-6`.
- Header: ocultar o texto "CRM — Gestão de Leads" em telas pequenas, mantendo só o menu e a sineta.

### 2. Conversas (`CrmConversas.tsx`)
Em telas `< lg` (1024px), trocar o `ResizablePanelGroup` de 3 colunas por uma navegação em "views" única:
- **View 1: Lista de conversas** (padrão ao entrar).
- **View 2: Chat** (abre ao tocar em um lead, com botão "← Voltar" no header do chat).
- **View 3: Painel do lead** (abre via botão de info no header do chat, com "← Voltar").

Em `lg+` (desktop/iPad), mantém o layout atual com 3 painéis redimensionáveis.

Implementação: estado `mobileView: "list" | "chat" | "lead"` controlado por `useIsMobile()` + handlers nos cliques.

### 3. Kanban (`CrmKanban.tsx`)
- Manter rolagem horizontal, mas reduzir largura das colunas no mobile (`w-[260px]` → `w-[78vw]` em mobile) para mostrar uma coluna por tela com "peek" da próxima.
- Adicionar `snap-x snap-mandatory` ao container e `snap-center` nas colunas para que o swipe pare em cada coluna.
- Reduzir paddings internos no mobile.

### 4. Painel do lead (sidebar direita)
- No mobile (view 3) ocupa 100% da largura.
- Botão "Voltar para chat" no topo.

## Detalhes técnicos

- Usar o hook existente `useIsMobile()` (`src/hooks/use-mobile.tsx`, breakpoint 768px) — ampliar para `< 1024` neste fluxo via prop ou novo hook `useIsCrmMobile()`.
- Não mexer em lógica de dados, RLS, queries ou estado de chat — só camada de apresentação.
- Sem mudanças em rotas: tudo continua em `/crm/conversas` e `/crm`.

## Arquivos afetados
- `src/components/CrmLayout.tsx` (paddings + header)
- `src/pages/CrmConversas.tsx` (views condicionais mobile)
- `src/pages/CrmKanban.tsx` (snap + largura de coluna)
- `src/hooks/use-mobile.tsx` (novo helper `useIsCrmMobile` para breakpoint lg)

## Fora de escopo (posso fazer depois se quiser)
- Dashboard, Relatórios, Calendário, Configurações — também precisam de ajuste mobile, mas em telas separadas. Posso atacar numa segunda rodada para manter este PR focado.
