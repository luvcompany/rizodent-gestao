## Plano de correção

1. **Ajustar a regra central de funis**
   - Atualizar `can_access_pipeline()` para que `crc` tenha o mesmo acesso base de `admin`/`gerente` em funis comuns.
   - Manter funis com `allowed_roles` preenchido, como **Pós-venda**, restritos somente aos papéis listados e `superadmin`.
   - Resultado esperado: Admin e CRC veem os mesmos funis gerais; nenhum dos dois vê Pós-venda.

2. **Corrigir conversas do CRC**
   - Revisar a listagem de Conversas para não depender de limite inicial insuficiente nem de cache antigo.
   - Implementar paginação/carregamento incremental para trazer todas as conversas visíveis ao perfil, não só as primeiras centenas/milhares.
   - Manter a separação WhatsApp/Instagram e respeitar o isolamento do Pós-venda.

3. **Corrigir tarefas e agendamentos**
   - Atualizar as políticas de `crm_tasks` e `crm_appointments` para incluir `crc` como perfil privilegiado igual a `admin`/`gerente`.
   - Ajustar o filtro da tela de Calendário: hoje ele trata `crc` como não privilegiado e esconde tarefas que o Admin vê.
   - Manter tarefas/agendamentos do Pós-venda fora da visão de Admin/CRC, filtrando pelo funil do lead quando necessário.

4. **Validar contagens reais**
   - Conferir depois da correção:
     - Conversas visíveis para CRC/Admin nos funis gerais.
     - Tarefas visíveis no Calendário.
     - Agendamentos visíveis no Calendário.
     - Pós-venda continua isolado para o setor de Pós-venda.

## Achado principal

O problema vem de duas diferenças ainda ativas:

- `can_access_pipeline()` deixou `crc` dependente de overrides, enquanto `admin`/`gerente` continuam privilegiados nos funis comuns.
- A tela de Calendário também considera privilegiado apenas `admin`, `gerente` e `superadmin`, então `crc` não vê todas as tarefas/agendamentos como Admin.

## Detalhe técnico

- Hoje há cerca de **3.198 leads ativos** no total, sendo **324 no Pós-venda** e **2.874 fora do Pós-venda**.
- Como Pós-venda deve ficar isolado, a visão correta de Admin/CRC deve ficar nos funis gerais, não incluir os 324 leads de Pós-venda.