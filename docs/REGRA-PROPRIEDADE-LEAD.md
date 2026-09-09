# Regra universal de propriedade do lead

Decisão do dono, 09/09/2026.

**Lead que tem uma SDR como dona só muda de dona de duas formas:**

1. **Transferência explícita** pelo seletor "Responsável" — pela própria SDR
   (só para outra SDR, o administrador ou a pós-venda) ou pelo administrador.
2. **Realocação automática por silêncio** — lead que escreveu e ficou o tempo
   configurado (aba Equipe → painel do rodízio) sem resposta humana, em
   horário comercial, com outra SDR em expediente. No máximo uma vez por dia.

**Nada mais troca a dona**: mensagem recebida, mudança de etapa, consulta
marcada, comparecimento, contrato, automação, bot, webhook, importação, API.
Um lead agendado pela Júlia que escreve três dias depois continua da Júlia.

Como está blindado no banco: gatilho `trg_zz_propriedade_lead` em
`crm_leads`, antes de qualquer troca de `assigned_to`. Só passa quem carrega a
autorização transacional (`rodizio.autorizado = 'sim'`): a função da
realocação e a RPC `lead_transferir_autorizado`, usada pela `transfer-lead`.
Humano logado tentando por fora recebe erro claro; caminho de servidor
(webhook, automação, API) tem a dona preservada em silêncio, com WARNING no
log — nunca quebra o fluxo.

**Lead do administrador** continua entrando no rodízio quando escreve, em
qualquer etapa (`entrada_todas_etapas`). A regra acima protege quem já tem
dona SDR.

Migration: `supabase/migrations/20260909180000_propriedade_do_lead.sql`.
