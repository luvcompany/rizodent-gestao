# Mensagens chegando instantaneamente nas Conversas

## O que já existe
- A conversa aberta já escuta mensagens novas ao vivo, e a lista de conversas escuta mudanças nos leads.
- Se o ao vivo falhar, a tela só confere de novo a cada 60 segundos. Isso explica atrasos de até 1 minuto.

## Causa ainda não confirmada — passo 1 é medir
O atraso pode estar em três pontos:
1. **No servidor:** entre a Meta avisar e a mensagem ser gravada (baixar mídia, ver dados do anúncio, distribuir o lead).
2. **No aviso ao vivo:** a tabela de mensagens tem muitas regras de permissão. O sistema confere todas elas para cada pessoa conectada antes de avisar, e isso pode atrasar ou até descartar o aviso.
3. **Na tela:** a conexão ao vivo cai (aba em segundo plano, rede) e só volta na conferência de 60s.

Vou medir os três: horário da Meta x horário em que a mensagem foi gravada, registros do recebedor do WhatsApp e um teste no navegador.

## Correções (aplico as que a medição confirmar)
- **Servidor:** gravar a mensagem de texto primeiro e só depois fazer o trabalho pesado (mídia, anúncio, distribuição, automações), em segundo plano.
- **Aviso ao vivo leve:** em vez de cada tela escutar a tabela de mensagens com todas as regras, o servidor manda um aviso curto ("chegou mensagem no lead X") para o grupo certo. Aí a tela busca a mensagem pelo caminho normal, que já respeita as permissões. Assim ninguém vê o que não pode.
- **Reconexão:** quando a conexão ao vivo cair ou a aba voltar a ficar visível, buscar na hora o que chegou nesse intervalo. A conferência de segurança cai de 60s para 15s, só enquanto a aba está aberta.
- **Lista de conversas:** subir o card na hora, sem esperar a lista recarregar.

## O que não muda
Visual, botões, permissões, contadores e regras de quem vê cada conversa continuam iguais.

## Detalhes técnicos
- Medir pelo campo `metadata` (timestamp da Meta) x `created_at` em `messages`, e pelos logs de `whatsapp-webhook`.
- Broadcast: um canal por tenant/grupo, mandando só `lead_id` e `message_id`. O cliente faz o SELECT normal, com RLS. Isso fica no lugar de `postgres_changes` em `messages`, cujo custo de RLS vale para cada pessoa conectada.
- `useChatConversation.ts`: tratar o status `CHANNEL_ERROR`/`TIMED_OUT` com resubscribe + busca incremental, e buscar de novo no `visibilitychange`.
- `CrmConversas.tsx`: aplicar o UPDATE de `last_inbound_at` de forma otimista.
- Registrar em `AGENTS.md` a regra de usar Broadcast leve em vez de `postgres_changes` em tabelas com RLS pesada.
