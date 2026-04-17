
The user wants to allow multiple patients to share the same phone number (e.g., family members sharing a WhatsApp). Currently the system blocks duplicates by phone signature when linking from CRM and likely on the Atendimento/Pacientes pages too.

Let me check current behavior across the 3 surfaces: LeadBudgetPanel (CRM linking), Atendimento (patient creation), Pacientes (patient list).

Plan:

## Objetivo
Permitir cadastrar/vincular múltiplos pacientes com o mesmo telefone, mediante confirmação explícita do usuário ("Cadastrar mesmo assim como pessoa diferente").

## Mudanças

### 1. `src/components/chat/LeadBudgetPanel.tsx` (vinculação no CRM)
- Quando `createAndLinkPaciente` detectar pacientes existentes pelo telefone (assinatura 8 dígitos), em vez de bloquear, exibir um diálogo de confirmação listando os pacientes encontrados com:
  - Botões "Vincular a este paciente" (um por resultado)
  - Botão "Criar novo paciente com mesmo telefone" (força criação)
- Auto-link silencioso continua só quando há 1 match (mantém comportamento atual). Se quiser forçar criar outro, usuário usa o diálogo manual.

### 2. `src/pages/Atendimento.tsx` (cadastro de paciente novo)
- Ao buscar/criar paciente por telefone, se já existir, exibir aviso com lista dos existentes + botão "Cadastrar como pessoa diferente (mesmo telefone)" para prosseguir criando novo registro.

### 3. `src/pages/Pacientes.tsx` (lista de pacientes)
- No fluxo de criação rápida de paciente (se houver), aplicar mesma lógica: detectar duplicidade por telefone, oferecer "Cadastrar mesmo assim".

### 4. Bug fix: `valorContratadoGeral is not defined` em `Atendimento.tsx`
Variável removida no refactor anterior mas ainda referenciada em algum lugar — corrigir junto.

## Diagrama de fluxo
```text
Telefone digitado
    │
    ├─ 0 matches → cria normalmente
    ├─ 1+ matches → mostra lista
    │     ├─ [Vincular a este] → usa paciente existente
    │     └─ [Criar como pessoa diferente] → força INSERT novo
```

## Arquivos a alterar
1. `src/components/chat/LeadBudgetPanel.tsx`
2. `src/pages/Atendimento.tsx` (incluindo fix do `valorContratadoGeral`)
3. `src/pages/Pacientes.tsx`
