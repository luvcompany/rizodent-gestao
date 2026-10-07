# Closer: voltar a criar lead, mover lead e editar funis/etapas

## O que já foi visto no banco
- Depois do endurecimento de segurança, algumas funções que o sistema usa por baixo ainda estão bloqueadas para usuários logados. Exemplos: `lead_whatsapp_number`, `conversa_lead_visivel`, `conversa_lead_alcancavel`, `etapa_equivalente_no_funil`, `pipeline_clonar_etapas_padrao`, `ensure_role_default_pipeline`, `rodizio_*`, `tenant_of_lead`. Foi o mesmo tipo de falha que já travou a SDR.
- As regras de acesso do closer só deixam editar lead que tem número de WhatsApp vinculado e liberado para ele. Lead criado à mão, sem número, pode ser recusado.
- A causa exata ainda não foi confirmada. Por isso o primeiro passo é reproduzir o erro.

## Passos
1. **Reproduzir como closer real**: entrar com um usuário closer da RizoDent e testar quatro coisas: criar lead, mover lead de etapa, criar/renomear/excluir etapa no funil do closer e editar o funil. Anotar a mensagem exata de cada erro.
2. **Corrigir cada causa encontrada**:
   - Liberar para usuários logados as funções bloqueadas que essas ações usam. Ferramentas de debug e de limpeza continuam fechadas.
   - Lead criado pelo closer sem número: gravar automaticamente o número do funil dele. Se isso não for possível, aceitar o lead quando ele está no funil do closer. O isolamento de "mundos" continua: o closer não vê nem mexe em leads de SDR, CRC ou pós-venda.
   - Funis e etapas: confirmar que as regras de etapas e automações aceitam o closer no funil do papel dele. É o que a tela já promete.
3. **Testar de novo como closer** as quatro ações. Depois, conferir que SDR, CRC e recepção continuam funcionando.

## Garantias
- A normalização de telefone (anti-duplicata) continua ativa.
- Nenhum lead é apagado ou movido.
- Nada muda nas telas.

## Detalhes técnicos
- `GRANT EXECUTE ... TO authenticated` nas funções necessárias, sem `anon`.
- Revisar as policies `closer_number_scope_lead_update`, a INSERT de `crm_leads` para closer e as policies de INSERT/UPDATE/DELETE de `crm_stages`/`crm_pipelines` com `funil_do_papel_do_usuario`.
- Ajuste pontual de policy ou gatilho que carimba `whatsapp_number_id`, conforme o erro reproduzido.
