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

**Fim do ciclo da SDR (comparecimento).** Consulta com desfecho de
comparecimento (contratou ou não) ou lead movido para etapa do administrador
(Contratado, Não contratado, Compareceu…) encerra o ciclo da SDR, mas a
entrega ao administrador só acontece depois de uma **carência** (aba Equipe →
painel do rodízio, padrão 24 h; 0 = na hora). Até lá o lead continua dela:
ela vê, responde, liga e marca. O crédito do agendamento fica com ela em
qualquer caso (`responsavel_credito_id`, imutável) — o relatório de
comparecimentos conta por crédito, seja quem for que marcou (SDR, CRC ou o
Dontus). Se alguém transferir o lead durante a carência, a entrega agendada
cai. Migration `20260909210000_entrega_ao_gestor_com_carencia.sql`
(tabela `crm_entregas_gestor`, cron `sdr-entrega-ao-gestor`).

**SDR excluída.** A conta só é apagada depois de a RPC
`equipe_redistribuir_leads` mover TODOS os leads dela pelo caminho
autorizado: lead com ciclo encerrado → administrador; os demais → revezam
entre as outras SDRs do rodízio (motor ligado) ou voltam ao administrador
para entrar de novo no rodízio quando escreverem. Tudo no livro (fase
`manual`). Migration `20260909220000_equipe_editar_excluir.sql`.

Migration da regra: `supabase/migrations/20260909180000_propriedade_do_lead.sql`.
