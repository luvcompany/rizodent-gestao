## Diagnóstico

O aprendizado da Bia existe, mas hoje ele quase não influencia as novas sugestões por 3 motivos principais:

- Existem exemplos salvos em `ai_good_examples`, mas nenhum está com embedding preenchido; assim a busca por exemplos parecidos não encontra nada.
- A função de sugestão só injeta exemplos no prompt quando há pelo menos 30 exemplos com busca semântica funcionando; na prática, as correções atuais não entram no contexto.
- Se o atendente corrige a resposta digitando manualmente no campo normal do chat, em vez de editar/enviar pelo bloco da Bia, essa correção não é registrada como aprendizado.

## Plano de correção

1. **Corrigir o registro de aprendizado**
   - Ajustar `record-good-example` para salvar exemplos com embedding de forma confiável.
   - Registrar também a resposta errada sugerida pela Bia quando houver edição, criando um par: “não responder assim” → “responder assim”.
   - Evitar que falhas silenciosas deixem exemplos salvos sem vetor sem nenhum aviso.

2. **Fazer a Bia aprender também com correções manuais**
   - Quando existir uma sugestão pendente da Bia e o atendente enviar uma mensagem manual diferente pelo chat, marcar essa sugestão como corrigida/descartada.
   - Salvar a mensagem manual como exemplo ideal para casos parecidos.

3. **Usar as correções no prompt imediatamente**
   - Em `generate-reply-suggestion`, carregar sempre exemplos recentes e correções editadas do mesmo cliente, mesmo que a busca semântica ainda não esteja disponível.
   - Quando houver embeddings, priorizar exemplos similares.
   - Incluir no prompt um bloco de “Correções anteriores da equipe” com instrução explícita para não repetir respostas que já foram corrigidas.

4. **Backfill dos exemplos atuais**
   - Criar uma rotina para preencher embeddings dos 43 exemplos já existentes.
   - Após isso, as correções antigas passam a ser usadas na busca por similaridade.

5. **Melhorar transparência na aba Aprendizado**
   - Exibir quantos exemplos estão prontos para uso, quantos ainda estão sem embedding e quantas sugestões foram corrigidas.
   - Mostrar de forma clara a resposta sugerida vs. resposta corrigida/enviada.

## Resultado esperado

Depois da implementação, quando você corrigir uma resposta da Bia, essa correção será usada nas próximas sugestões. Se ela tentar repetir um padrão já corrigido, o prompt terá exemplos reais dizendo o que evitar e qual resposta seguir.