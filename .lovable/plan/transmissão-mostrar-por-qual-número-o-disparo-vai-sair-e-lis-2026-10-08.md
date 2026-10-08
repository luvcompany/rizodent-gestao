# Transmissão: mostrar por qual número o disparo vai sair e listar só os modelos que funcionam nele

## O que muda para você

Na tela **Transmissão**, ao abrir "Nova transmissão" (ou ao trocar o funil do filtro), aparece uma linha:

> Vai sair por: **Whatsapp Contingência** (+55 77 8128-1211) · Conectado na Meta

E a lista de **Modelo** passa a mostrar só os modelos aprovados **na conta desse número** — cada um com a etiqueta do número, como já acontece no Instagram. Assim não dá mais para escolher sem querer um modelo antigo e ver todas as mensagens serem recusadas.

Nada some: existe um interruptor **"Mostrar modelos de outros números"**. Ligado, a lista completa volta, com o número de cada modelo escrito ao lado e um aviso vermelho se o modelo escolhido não é do número que vai enviar.

O envio em si não muda de comportamento — o número continua sendo decidido pelo servidor, lead por lead. A tela apenas mostra e facilita a escolha certa.

## Como o número é decidido (regra que a tela vai passar a mostrar)

- Funil do filtro aponta para um número (ex.: **Padrão Closer** → Rizodent-Comercial) → o disparo sai por esse número.
- Funil do filtro é o legado (**Funil Principal**) ou nenhum funil foi escolhido → sai pelo **"Número padrão de envio"** (hoje: Whatsapp Contingência).
- Lead que já pertence a um número (closer, recepção, ou "Enviar por:" escolhido) → sai pelo número **desse lead**, mesmo no disparo.

## Passos

1. **Função nova no banco** `numero_de_envio_do_disparo(p_pipeline_id)`: devolve o número que vai enviar para o funil escolhido (nome, telefone, identificador da conta, número de telefone da Meta e estado de saúde). Segue a mesma ordem do servidor: número do funil → número padrão de envio → número principal → primeiro número ativo.
2. **Corrigir a repetição de nomes**: hoje, dois modelos com o mesmo nome em números diferentes (ex.: "agendamento" no principal e no contingência) viram **uma só opção** na lista, e a que sobra pode ser a do número errado — todas as mensagens desse disparo seriam recusadas. A comparação passa a levar o número em conta, então os dois aparecem, cada um com sua etiqueta.
3. **Tela de Transmissão**: buscar o número ao abrir o diálogo e a cada mudança de funil; mostrar a linha "Vai sair por:" com o selo verde/âmbar/vermelho (o mesmo selo da tela Integrações); filtrar a lista de modelos pelo número que vai enviar; adicionar o interruptor "Mostrar modelos de outros números".
4. **Nada muda** no motor de disparo nem no envio de mensagem, e nenhuma coluna nova é criada.

## O que você verá se o número estiver caído

A linha mostra o número com o selo vermelho e o motivo (ex.: "fora do ar na Meta"). O botão de disparo continua funcionando como hoje — a tela avisa, não bloqueia.

## Detalhes técnicos

- RPC `public.numero_de_envio_do_disparo(p_pipeline_id uuid)` SECURITY DEFINER, `GRANT EXECUTE TO authenticated`; retorna `numero_id, nome, phone_e164, phone_number_id, waba_id, origem ('funil'|'padrao'|'principal'), saude, motivo`. Ordem: `funnel_channels.channel_config->>'integration_key'` do funil (quando `whatsapp_<phone_number_id>`) → `whatsapp_numbers` `is_active AND is_default` → `integrations` `whatsapp_config` → primeiro ativo por `is_default DESC, created_at`; `saude` = `integrations.config->>'health_status'`.
- `deduplicateTemplates` (src/lib/templateUtils.ts:22) hoje usa só o nome limpo como chave; passa a usar nome + `waba_id`/`whatsapp_number_id` quando presentes (objetos sem esses campos mantêm a chave só pelo nome, sem afetar outras telas).
- `src/pages/CrmCampanhas.tsx`: `useQuery`/`useEffect` chamando a RPC com `form.pipeline_id || null`; estado `mostrarOutrosNumeros`; `templates` filtrados por `waba_id` igual ao do número devolvido; `TemplateSearchSelect` com etiqueta do número no `SelectItem`; selo reaproveitando `SeloSaudeWhatsapp` (src/components/whatsapp/WhatsappSaude.tsx:38).
- Confirmação no banco: a RPC para `Funil Principal` devolve o contingência (WABA 1042192912129672), para `Padrão Closer` devolve Rizodent-Comercial, e sem funil devolve o contingência; a lista de modelos do contingência deve ter exatamente os 9 aprovados lá.
- Verificação: compilação e checagem de tipos limpas; abrir a tela como SDR/CRC e como closer e conferir a linha do número e a lista de modelos nos três casos (sem funil, Funil Principal, Padrão Closer).
