# Closer: criar lead repetido e mesclar na transferência

## 1. Closer cria o lead mesmo se ele já existir
- Quando o closer cadastra à mão um telefone que já existe com SDR, CRC, pós-venda ou recepção, o aviso "Lead já cadastrado" ganha a opção **"Criar mesmo assim no meu funil"**.
- O lead novo nasce no funil e no número do closer. O lead do outro usuário não muda.
- A regra anti-duplicata continua valendo do jeito de hoje. Ela segue padronizando o telefone e barrando duplicata dentro do mesmo mundo, inclusive entre dois closers.

## 2. Transferência para um closer que já tem esse lead
- Quando alguém usa **Transferir lead** e escolhe um usuário closer que já tem lead com o mesmo telefone, o sistema mescla os dois:
  - Fica só o lead do closer, com o funil, a etapa e o número dele.
  - As mensagens, notas e o histórico do lead antigo passam para o lead do closer, marcados como "histórico anterior".
  - O lead antigo some das telas do SDR, da CRC e dos demais.
  - Uma cópia de segurança do lead removido vai para a lixeira de leads excluídos, como na mesclagem anterior.
- Tarefas e agendamentos ainda abertos do lead antigo também passam para o lead do closer.
- Se o closer ainda não tem esse lead, a transferência funciona como hoje.

## 3. Aba "Histórico anterior" na conversa
- Na conversa do lead, o closer vê duas abas: **Conversa**, a atual, e **Histórico anterior**.
- O Histórico anterior mostra, só para leitura, as mensagens trocadas antes com a SDR ou com outro usuário, com data e o nome de quem atendeu.
- A aba só aparece quando existe histórico.
- O balão de não lidas e as respostas continuam valendo só para a conversa atual do número do closer.

## Garantias
- Nenhum botão nem dado atual é removido.
- A regra de telefone padronizado continua ativa.
- Os mundos continuam separados. O SDR não vê o lead depois da transferência, e o closer só vê o histórico dentro do lead dele.

## Detalhes técnicos
- Em `CrmKanban.tsx`, liberar `podeDuplicar` para o papel closer quando o lead encontrado for de outro mundo. O lead novo leva o `whatsapp_number_id` do closer.
- Criar a coluna `messages.historico_de_lead_id`, que pode ficar vazia, e uma RPC `security definer` chamada `mesclar_lead_no_closer(origem, destino)`. Ela vai:
  - repontar mensagens, notas, histórico de etapas, tarefas e agendamentos para o lead do closer;
  - carimbar `historico_de_lead_id`;
  - guardar a cópia em `deleted_leads_backup` e apagar o lead de origem.
- A edge function `transfer-lead` detecta o papel closer do destino e procura um lead com o mesmo telefone normalizado no tenant. Se achar, chama a RPC em vez de só trocar o `assigned_to`.
- A tela da conversa separa as mensagens com `historico_de_lead_id` na aba nova, só para leitura. A contagem de não lidas e a janela de 24h ignoram essas mensagens.
