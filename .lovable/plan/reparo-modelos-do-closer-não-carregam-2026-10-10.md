# Reparo: Modelos do Closer não carregam

## Objetivo
Fazer a tela Modelos do Closer listar os modelos do número dele e confirmar criando um modelo de abordagem inicial.

## Passos
1. **Diagnóstico (causa ainda não confirmada):** entrar como usuário Closer, abrir Modelos e capturar o erro exato (tela, resposta das funções de modelos, logs de `manage-whatsapp-templates` / `sync-whatsapp-templates-cron`, permissões de leitura nos modelos e no número do Closer).
2. **Correção mínima** no ponto confirmado (permissão de leitura do mundo Closer, filtro por número/conta, ou função de sincronização), sem afetar SDR/CRC, Recepção nem `/admin`, respeitando as regras de mundo dos números.
3. **Teste como Closer:**
   - lista de modelos carrega sem erro;
   - criar o modelo `abordagem_inicial_closer` (categoria Marketing, pt_BR) no número do Closer, com texto curto de primeiro contato usando `{{1}}` para o nome;
   - confirmar na Meta que ficou `PENDING` e que aparece na tela do Closer, e não aparece para SDR/CRC.
4. Relatar a causa, o que foi corrigido e o status do modelo.

## Detalhes técnicos
- Se a correção exigir banco, migration em `drizzle/migrations` mantendo grants e gatilhos de normalização de telefone.
- Se exigir função, publicar só as funções alteradas.
