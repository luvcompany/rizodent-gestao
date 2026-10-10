# Nome do canal do WhatsApp refletido em todo o CRM

## Objetivo
Fazer o nome configurado em **Integrações** ser a fonte única do nome do número e refletir a alteração nas conversas, divisórias do histórico e seletor **Enviar por**, sem precisar sair e entrar novamente.

## Diagnóstico confirmado
- A integração principal está salva como **“Whatsapp - Principal”**.
- O cadastro público do mesmo número, usado pelas conversas e seletores, ainda está como **“Whatsapp - Comercial”**.
- As duas áreas leem `whatsapp_numbers.display_name`; portanto, a divergência está na sincronização entre a configuração da integração e esse cadastro.
- Após salvar, a tela invalida a lista usada nas conversas, mas não invalida a segunda lista usada pelo seletor de envio.

## Implementação
1. **Corrigir a sincronização do nome**
   - Ajustar a regra do banco que espelha uma integração WhatsApp em seu número para sempre copiar o nome configurado quando a integração for criada ou editada.
   - Manter intactas as regras de mundo/equipe, acesso, número padrão, ativação e histórico.
   - Corrigir os nomes atualmente divergentes usando o valor já salvo em cada integração ativa.

2. **Atualizar as telas imediatamente após salvar**
   - Ao salvar o nome em Integrações, recarregar as duas fontes usadas no CRM:
     - nomes exibidos na lista e nas divisórias das conversas;
     - opções do seletor **Enviar por**.
   - Continuar usando o nome atual do número para mensagens antigas; não gravar uma cópia fixa do nome em cada mensagem.

3. **Cobrir todos os pontos pedidos**
   - Etiqueta do número na lista de conversas.
   - Divisória “Pelo número” dentro da conversa.
   - Seletor **Enviar por**.
   - Número padrão mostrado nas conversas.

## Validação
- Renomear temporariamente um canal em Integrações e confirmar que o novo nome aparece imediatamente nas áreas acima.
- Recarregar a página e confirmar que o nome permanece correto.
- Confirmar que os números Comercial 2 e Closer continuam separados e com seus nomes próprios.
- Executar os testes do seletor de número e adicionar cobertura para a atualização do nome após salvar.

## Detalhes técnicos
- A correção do banco será uma migration versionada em `drizzle/migrations`, preservando os grants restritos da função de gatilho.
- Nenhuma mensagem, lead, número, permissão ou escolha de envio será alterada; somente o nome exibido será sincronizado.
