## Objetivo

Adicionar um botão **"Compartilhar com papel"** em cada card de modelo na tela **Modelos de Mensagem** (`CrmModelos.tsx`), permitindo que admin/gerente/superadmin alterem o `owner_role` do template para definir quem enxerga aquele modelo. Funciona em conjunto com a RLS restritiva já planejada (CRC/Pós-venda só veem seus próprios).

## Comportamento

Botão (ícone `Users`) ao lado dos atuais Editar/Duplicar/Excluir, **visível apenas para admin / gerente / superadmin**.

Ao clicar abre um pequeno popover/dialog com Select:

| Opção                 | Efeito no `owner_role`              |
|-----------------------|-------------------------------------|
| Todos os papéis (compartilhado) | `NULL` (legado / global)  |
| Admin                 | `'admin'`                           |
| Gerente               | `'gerente'`                         |
| CRC                   | `'crc'`                             |
| Pós-venda             | `'posvenda'`                        |

Salvar faz `UPDATE crm_whatsapp_templates SET owner_role = ... WHERE id = ?`.

Pré-seleciona o valor atual do template. Mostra toast de sucesso e recarrega a lista.

### Badge no card

Pequeno chip ao lado do nome indicando o dono atual:
- "Compartilhado" (cinza) quando `owner_role IS NULL`
- "Admin" / "Gerente" / "CRC" / "Pós-venda" (colorido) quando definido

Assim o admin enxerga rapidamente o escopo de cada modelo.

## RLS

A política `Admins and managers can update crm_whatsapp_templates` **já permite** admin/gerente alterar qualquer template. Superadmin já cobre via `tenant_isolation`. Nenhuma migration adicional necessária para esta funcionalidade.

(A migration que endurece a leitura para CRC/Pós-venda — proposta anteriormente — continua sendo aplicada separadamente.)

## Arquivos

```
src/pages/CrmModelos.tsx
  - Ler papel do usuário atual (já temos get_user_primary_role)
  - Adicionar botão Users no card (condicional ao papel)
  - Novo Dialog "Compartilhar modelo" com Select de papel
  - Função handleShare(template, role)
  - Badge de escopo ao lado do nome
```

## Fora de escopo

- Compartilhar com múltiplos papéis simultâneos (continua um único `owner_role`; "Todos" via `NULL`).
- Edição em lote.
