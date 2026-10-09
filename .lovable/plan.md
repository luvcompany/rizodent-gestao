# Devolver às SDRs/CRC as conversas e os leads do número de contingência

## Causa (confirmada no banco)
Desta vez o problema não são as permissões das funções. Quando a integração do **Whatsapp Contingência** foi excluída, a regra que eu criei para desativar o número também **tirou de todo mundo a permissão de ver esse número**. Como o sistema só mostra mensagens e leads de números que a pessoa pode ver:

- **6.665 mensagens** trocadas pelo contingência ficaram ocultas para as SDRs e a CRC. São as "mensagens que sumiram" e as do "número antigo que não dá para ler".
- **25 leads** que estavam marcados com o contingência ficaram invisíveis para elas. Por isso não conseguem abrir nem mover esses leads.
- Nos registros das últimas 24h não aparece nenhum erro de "permissão negada" do banco. Criar, editar e mover os demais leads continua liberado.

## O que vou fazer
1. **Devolver o acesso ao histórico:** quem é do grupo dono do número (CRC, SDR, gerente) volta a ver as mensagens e os leads de números desativados, só para leitura do histórico. O número desativado continua fora de "Enviar por:", do número padrão e dos modelos.
2. **Mudar a regra de exclusão:** ao excluir a integração de um número, o sistema só desativa o número. Ele não tira mais a permissão de ver o histórico. Assim isso não volta a acontecer com nenhum número.
3. **Passar os 25 leads para o número padrão atual** (Rizodent - Comercial 2). Assim eles voltam a aparecer, podem ser movidos e as respostas saem por um número que funciona. O histórico continua mostrando "Pelo número Whatsapp Contingência" nas mensagens antigas.
4. **Testar como SDR e como CRC de verdade:** abrir um lead do contingência, ler as mensagens antigas, mover de etapa, editar o nome, criar nota e criar lead novo.
5. **Varredura de proteção:** conferir se toda função que roda ao criar, editar ou mover lead, mensagem ou nota está liberada para quem está logado. Registrar essa regra no AGENTS.md para que nenhuma limpeza futura volte a bloquear isso.

## Fora do escopo
Nenhum lead ou mensagem é apagado. Os modelos do contingência continuam escondidos.

## Detalhes técnicos
- `can_access_whatsapp_number(_number_id)`: adicionar o caso "número inativo do tenant cujo `owner_role`/mundo é o do chamador" (crc/sdr → mundo crc). Assim RLS de `messages` e `crm_leads` libera a leitura do histórico.
- Alterar `integracao_whatsapp_excluida_desativa_numero()` para não apagar `user_permission_overrides`.
- Dados: `update crm_leads set whatsapp_number_id = <Comercial 2>` onde o número é o contingência (25 linhas).
- Auditoria: listar funções de trigger em `crm_leads`, `messages`, `crm_conversation_notes` e `crm_lead_stage_history` e as funções chamadas por funções não SECURITY DEFINER, e garantir EXECUTE para `authenticated`.
