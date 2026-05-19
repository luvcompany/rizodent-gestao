## Objetivo
Tornar o CRM o painel principal. Usuários "Pós-venda" só veem o CRM. Mover **Configurações** e **Usuários** para dentro do CRM (e remover da sidebar do sistema antigo).

## Mudanças

### 1. `src/components/CrmLayout.tsx`
- Adicionar **Usuários** ao menu lateral do CRM (rota `/crm/usuarios`), visível só para `superadmin` (já existe gate).
- **Configurações** já está no CRM — apenas garantir que esteja no fim do menu.
- Esconder o botão **"Voltar ao Sistema"** quando `userRole === "posvenda"`. Para os demais (crc, gerente, superadmin), o botão continua existindo (já que o sistema antigo continua acessível para eles).

### 2. `src/App.tsx`
- Adicionar rotas no bloco `CrmLayout`:
  - `/crm/usuarios` → `<Usuarios />`
  - `/crm/configuracoes` já existe
- Remover (ou manter, ver "Observação" abaixo) as rotas `/usuarios` e `/configuracoes` do `AppLayout`. Decisão: **manter** as rotas antigas redirecionando para as novas (`<Navigate to="/crm/usuarios" replace />` e `/crm/configuracoes`) para não quebrar bookmarks.

### 3. `src/components/AppLayout.tsx`
- Remover **Configurações** e **Usuários** dos `navItems` (mover para o CRM).
- Manter os demais itens visíveis para CRC/Gerente/Superadmin.

### 4. Redirecionamento por papel (posvenda)
- Em `src/pages/TenantLogin.tsx`: após login bem-sucedido, ler o `user_role` recém carregado e redirecionar:
  - `posvenda` → `/crm`
  - outros → `/dashboard` (comportamento atual)
- Em `src/components/ProtectedRoute.tsx`: se `userRole === "posvenda"` e a URL atual está fora de `/crm` (`/dashboard`, `/pacientes`, `/relatorios`, `/marketing`, `/leads`, `/atendimento`, `/procedimentos`, `/registro-diario`), redirecionar para `/crm`. Isso garante isolamento mesmo via URL direta ou impersonation.

### 5. Botão "Voltar ao Sistema"
- Ocultado para `posvenda` (esses usuários só têm CRM).

## Observação
Como Configurações e Usuários estão sendo movidos, os links antigos (`/configuracoes`, `/usuarios`) passam a redirecionar para os novos dentro do CRM — assim a navegação fica unificada para todos os papéis.

## Arquivos alterados
- `src/App.tsx`
- `src/components/AppLayout.tsx`
- `src/components/CrmLayout.tsx`
- `src/components/ProtectedRoute.tsx`
- `src/pages/TenantLogin.tsx`
