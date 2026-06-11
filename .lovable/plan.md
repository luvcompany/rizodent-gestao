## Problema encontrado

O frontend já está enviando o `tenant_id` correto ao criar o funil. O erro continua porque a criação usa retorno imediato do registro criado, e a regra de leitura atual de `crm_pipelines` depende de uma função que consulta a própria tabela. Durante esse retorno do insert, a regra não consegue validar o funil recém-criado e o banco bloqueia com RLS.

Também há um segundo ponto provável: as etapas (`crm_stages`) têm `tenant_id`, mas alguns inserts de etapa ainda não enviam esse campo e não existe trigger para preencher automaticamente.

## Plano de correção

1. **Ajustar a regra de leitura de funis no banco**
   - Trocar a política de leitura de `crm_pipelines` para validar acesso usando os próprios campos da linha nova (`tenant_id`, `allowed_roles`) em vez de chamar uma função que consulta `crm_pipelines` novamente.
   - Manter o isolamento por clínica/tenant e os acessos por papel: `crc`, `gerente`, `posvenda` e `superadmin` conforme já definido.

2. **Garantir tenant automático em funis e etapas**
   - Criar uma trigger segura para preencher `tenant_id` automaticamente em `crm_pipelines` e `crm_stages` quando o frontend não enviar.
   - Corrigir registros antigos de etapas sem `tenant_id` usando o tenant do funil pai.

3. **Reforçar o frontend onde cria etapas**
   - Em `CrmAutomacoes.tsx`, incluir `tenant_id` ao criar nova etapa e ao duplicar etapas de um funil.
   - Em `CrmIntegracoes.tsx`, incluir `tenant_id` ao criar as etapas padrão de um novo funil.
   - Manter o `tenant_id` já enviado na criação dos funis.

4. **Validar o fluxo do CRC**
   - Repetir a criação de funil como usuário CRC.
   - Confirmar que o funil aparece na lista e que as etapas são criadas sem erro.

```xml
<presentation-actions>
  <presentation-open-history>View History</presentation-open-history>
</presentation-actions>
<presentation-actions>
<presentation-link url="https://docs.lovable.dev/tips-tricks/troubleshooting">Troubleshooting docs</presentation-link>
</presentation-actions>
```