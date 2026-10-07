# Cada tipo de usuário vê só as próprias conexões de WhatsApp

## Regra
- **CRC e SDR** formam um único grupo e veem as mesmas conexões, que ficam na tela Integrações.
- **Closer** vê só as conexões do closer. **Recepção** vê só as da recepção.
- Qualquer tipo de usuário criado no futuro segue a mesma regra e fica separado, até vocês decidirem outra coisa.
- Gerente e Luv Agency continuam com acesso a tudo, como hoje.

## O que vai mudar
1. **Toda conexão passa a ter dono.** A conexão guarda o tipo de usuário de quem a criou. As conexões que já existem ficam assim:
   - "Whatsapp - Teste" e "Rizodent - Comercial" (••••6302) ficam no grupo CRC/SDR.
   - "Rizodent- Comercial" (••••0018) fica com o Closer.
2. **A tela Integrações mostra só as conexões do grupo de quem está vendo.** O CRC não vê mais o número do closer.
3. **A proteção também fica no servidor, não só na tela.** Um CRC não consegue ler, pausar, editar nem remover a conexão de outro grupo, mesmo por fora da tela. Isso evita que alguém pause ou exclua o número sem querer.
4. **A tela Conexões** (closer, recepção e os grupos futuros) continua listando só os números da própria pessoa, com os botões Editar e Excluir que acabei de colocar.
5. **Teste:** entro como CRC e confirmo que o ••••0018 não aparece. Depois entro como Closer e confirmo que ele aparece e que dá para editar.

Observação: a correção que fiz há pouco já esconde o ••••0018 do CRC. O seu print pode ter sido tirado antes de a tela atualizar. Mesmo assim, ela só escondia o número na tela. Este plano transforma isso numa regra fixa, protegida no servidor e válida para todos os tipos de usuário.

## Detalhes técnicos
- Nova coluna `integrations.owner_role` (texto, aceita vazio). Preencher: `crc` para as entradas antigas sem dono e `closer` para `whatsapp_1326232703900018`.
- Função `integration_world(role)`: devolve `crc` quando o papel é crc ou sdr. Para os outros papéis, devolve o próprio papel.
- RLS em `integrations` para chaves `whatsapp_%`: o usuário só acessa a entrada quando o grupo de `owner_role` é o mesmo grupo dele, ou quando ele é gerente ou superadmin. Antes de aplicar, conferir as policies atuais e verificar se as edge functions usam a chave de serviço.
- `minha-conexao-whatsapp` passa a gravar `owner_role` com o papel de quem conecta. O fluxo da tela Integrações grava `crc`.
- `CrmIntegracoes.tsx` passa a filtrar pelo grupo, em vez de usar `owner_user_id`.
- Gatilho de normalização de telefone não é tocado.
