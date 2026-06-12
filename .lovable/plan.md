Plano para fazer o envio de áudio e arquivos voltar a funcionar:

1. Corrigir a política de upload do bucket `chat-media`
   - O problema provável está na regra atual de envio: ela exige que o arquivo já pertença a uma mensagem do tenant antes mesmo do upload existir.
   - Vou restaurar o comportamento anterior para permitir que usuários autenticados façam upload no `chat-media`.

2. Manter a segurança de leitura
   - O bucket continuará privado.
   - Arquivos existentes continuarão acessíveis apenas por URL assinada, por dono do arquivo ou por vínculo com mensagens do tenant.
   - Não vou tornar o bucket público nem afrouxar leitura geral.

3. Preservar o envio via WhatsApp
   - Após o upload, a função `send-whatsapp-message` continuará baixando o arquivo pelo backend e enviando para a API do WhatsApp.
   - Não vou alterar funis, leads, etapas ou regras do Zigomático.

4. Validar depois da correção
   - Conferir se a política ativa ficou com upload permitido para usuários logados.
   - Conferir se o bucket `chat-media` segue privado.
   - Validar pelos logs/requisições que o erro de upload/RLS deixou de acontecer.