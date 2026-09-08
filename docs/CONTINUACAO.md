# Continuação automática — CRClin

Este arquivo é lido a cada 4 horas pela rotina na nuvem "CRClin — continuação
automática" (claude.ai/code/routines). Ela só executa itens com
`status: pendente` **e** `autorizado: sim`, na ordem, e depois atualiza este
arquivo. Itens sem autorização ficam aqui só como registro.

Regras que valem acima de qualquer item: nunca mexer em `whatsapp-webhook`,
`CrmIntegracoes.tsx` nem em upload/envio de mídia; nunca afrouxar isolamento
(RESTRICTIVE, `can_access_whatsapp_number`, `can_access_pipeline`,
`tenant_hard_isolation`); nunca transportar segredos; nunca reescrever
desfechos de agendamento em lote sem autorização literal do dono; publicar são
3 passos (migration, redeploy de function, publish do site) e conferir depois.

Última atualização: 2026-09-08 12:30 UTC, pela sessão local do Claude Code.

---

## Item 1 — Varredura de leads presos em Agendado/Reagendado

- status: concluído em 2026-09-08 13:20 UTC (sessão local)
- autorizado: sim

Migration `20260908140000_varredura_agendado_sem_agendamento.sql` aplicada
(cron job 35, 06:00 UTC). Primeira execução real: 62 leads movidos, 1 sem
etapa destino no funil (GIDENALDA, funil com "Agendado " sem "Não contratado").
Correções da folha das SDRs (6 faltas → comparecimento + CHAIANE 24/08)
também aplicadas, `outcome_source = 'folha-sdr'`.

## Item 2 — Fase 1 do rodízio de SDRs (papel `sdr` + aba Equipe)

- status: concluído em 2026-09-08 19:52 UTC (migration, 15 functions e site no ar)
- autorizado: sim

Conferido depois de aplicar: 77 policies `sdr_` (73 restritivas em 56 tabelas),
6 gatilhos `trg_sdr_`, `gestor_user_id` = rizodentvca2. As 512 policies antigas
seguem com o mesmo hash `c28b7f00…` de antes. Conversas por papel intactas:
CRC 9.012, pós-venda 316, closer 37. Falta só o dono criar as 3 SDRs na aba
Equipe (passo 4 de `docs/PUBLICAR-PENDENTE.md`).

Em construção pela sessão local (migration
`supabase/migrations/20260908150000_sdr_fase1_papel_e_equipe.sql`, front
`src/pages/CrmEquipe.tsx` e `src/hooks/useGestorEquipe.ts`, papéis em
`src/lib/roles.ts`, mais 15 edge functions que dependem de
`_shared/authz.ts`). O roteiro de publicação em 4 passos está em
`docs/PUBLICAR-PENDENTE.md`. Quando a sessão local terminar, ela mesma publica
e atualiza este item. Se aparecer no GitHub um commit com esses arquivos e este
item continuar "em andamento" por mais de 12 horas, a rotina deve apenas
relatar isso ao dono, sem publicar.

## Item 3 — Conferir carimbo de autor nas mensagens humanas

- status: pendente
- autorizado: sim
- como fazer: `SELECT count(*) FILTER (WHERE sender_id IS NOT NULL) AS com_autor, count(*) AS total FROM messages WHERE direction='outbound' AND type IN ('text','audio','image','document','video') AND status <> 'system' AND created_at > '2026-09-08 02:24:00+00'`. Se `total` > 0 e `com_autor` = 0, marcar este item como `bloqueado: sender_id não está sendo carimbado — send-whatsapp-message precisa de novo redeploy a partir do main` e NÃO tentar corrigir. Se `com_autor` > 0, marcar concluído com os números. Se `total` = 0, deixar pendente (ainda não houve envio humano).

## Item 4 — Conferir carimbo de crédito no primeiro agendamento real

- status: pendente
- autorizado: sim
- como fazer: `SELECT credito_origem, count(*) FROM crm_appointments WHERE created_at > '2026-09-08 00:00:00+00' GROUP BY 1`. Se houver linhas com `credito_origem` diferente de `backfill_fase0` (esperado: `dona_do_lead_na_criacao`, `herdado_remarcacao`, `sem_dona_na_criacao` ou `informado_pelo_servidor`), marcar concluído com a distribuição. Se todas as linhas novas estiverem NULL, marcar `bloqueado: gatilho trg_zz_carimba_credito_agendamento não carimbou` sem corrigir. Se não houver linhas, deixar pendente.
