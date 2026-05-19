## Diagnóstico

O lead **ZENAIDE LIMA LADEIA (557798413016)** está no pipeline **Pós-venda**, que tem `allowed_roles = {posvenda}`. O usuário **Rizodent** é `admin` e tem overrides explícitos de acesso para todos os outros 6 pipelines, mas não para o Pós-venda — por isso o lead sumiu da visualização dele.

### Por que esse lead foi parar lá indevidamente

- Histórico mostra: Funil Principal → Contratado (hoje 14:17) → Pós-venda (hoje 14:26).
- O `assigned_to` continua como **Rizodent (admin)**, e **não** como a Neiriane (posvenda).
- A transferência automática oficial (`auto-transfer-contracted-to-posvenda`) sempre reatribui o lead para o usuário posvenda e registra mensagem de sistema "🤖 Transferência automática para Pós-venda" — nenhuma das duas coisas aconteceu aqui.
- Conclusão: foi movido por outro caminho (provavelmente arrasto no Kanban ou ação manual) sem reatribuir o dono.

### Critério para identificar "outros na mesma condição"

Leads que estão no pipeline Pós-venda mas **não** pertencem a um usuário com role `posvenda` — ou seja, ninguém de pós-venda assumiu, então não são realmente pós-venda.

Resultado da varredura no tenant Rizodent (`00000000-0000-0000-0000-000000000010`):

| Lead | Telefone | Dono atual | Status |
|---|---|---|---|
| ZENAIDE LIMA LADEIA | 557798413016 | Rizodent (admin) | único caso |

Os outros 245 leads do Pós-venda estão todos atribuídos à Neiriane (posvenda) — corretos.

## Plano de recuperação

1. **Reverter o lead ZENAIDE** de volta para o pipeline original via UPDATE em `crm_leads`:
   - `pipeline_id` → `a1b2c3d4-0001-4000-8000-000000000001` (Funil Principal)
   - `stage_id` → `15ee8d94-02c0-430b-89f4-96043a40c74e` (Contratado)
   - `assigned_to` permanece como Rizodent
2. **Fechar a linha aberta** em `crm_lead_stage_history` (Pós-venda/Contato inicial) marcando `exited_at = now()` e inserir nova linha aberta apontando para Funil Principal/Contratado, para o histórico do lead refletir o retorno.
3. **Inserir mensagem de sistema** explicando a reversão ("↩️ Lead revertido para Funil Principal — não era caso de Pós-venda").
4. **Não alterar os 245 leads legítimos** atribuídos à Neiriane.

Operação será feita via insert tool (UPDATE/INSERT em dados, sem mudança de schema). Quer que eu execute?
