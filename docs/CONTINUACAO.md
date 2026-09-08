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

- status: em andamento na sessão local (não executar)
- autorizado: não

Migration `supabase/migrations/20260908140000_varredura_agendado_sem_agendamento.sql`
(função `varre_agendado_sem_agendamento` + cron 06:00 UTC). A sessão local
aplica, faz o dry-run e a primeira execução real. Se este item ainda estiver
"em andamento" depois de 2026-09-09 00:00 UTC, a sessão local caiu: então trocar
`autorizado` para `sim` NÃO é permitido a esta rotina — o dono decide.

## Item 2 — Fase 1 do rodízio de SDRs (papel `sdr` + aba Equipe)

- status: em andamento na sessão local (não executar)
- autorizado: não

Em construção pela sessão local (migration
`supabase/migrations/20260908130000_sdr_fase1_papel_e_equipe.sql`, front
`src/pages/CrmEquipe.tsx`, papéis em `src/lib/roles.ts`). Quando a sessão local
terminar, ela mesma publica e atualiza este item. Se aparecer no GitHub um
commit com esses arquivos e este item continuar "em andamento" por mais de 12
horas, a rotina deve apenas relatar isso ao dono, sem publicar.

## Item 3 — Conferir carimbo de autor nas mensagens humanas

- status: pendente
- autorizado: sim
- como fazer: `SELECT count(*) FILTER (WHERE sender_id IS NOT NULL) AS com_autor, count(*) AS total FROM messages WHERE direction='outbound' AND type IN ('text','audio','image','document','video') AND status <> 'system' AND created_at > '2026-09-08 02:24:00+00'`. Se `total` > 0 e `com_autor` = 0, marcar este item como `bloqueado: sender_id não está sendo carimbado — send-whatsapp-message precisa de novo redeploy a partir do main` e NÃO tentar corrigir. Se `com_autor` > 0, marcar concluído com os números. Se `total` = 0, deixar pendente (ainda não houve envio humano).

## Item 4 — Conferir carimbo de crédito no primeiro agendamento real

- status: pendente
- autorizado: sim
- como fazer: `SELECT credito_origem, count(*) FROM crm_appointments WHERE created_at > '2026-09-08 00:00:00+00' GROUP BY 1`. Se houver linhas com `credito_origem` diferente de `backfill_fase0` (esperado: `dona_do_lead_na_criacao`, `herdado_remarcacao`, `sem_dona_na_criacao` ou `informado_pelo_servidor`), marcar concluído com a distribuição. Se todas as linhas novas estiverem NULL, marcar `bloqueado: gatilho trg_zz_carimba_credito_agendamento não carimbou` sem corrigir. Se não houver linhas, deixar pendente.
