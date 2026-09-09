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

Última atualização: 2026-09-10 (madrugada, UTC), pela sessão local.

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

- status: concluído em 2026-09-08 20:05 UTC (rotina na nuvem)
- autorizado: sim
- como fazer: `SELECT count(*) FILTER (WHERE sender_id IS NOT NULL) AS com_autor, count(*) AS total FROM messages WHERE direction='outbound' AND type IN ('text','audio','image','document','video') AND status <> 'system' AND created_at > '2026-09-08 02:24:00+00'`. Se `total` > 0 e `com_autor` = 0, marcar este item como `bloqueado: sender_id não está sendo carimbado — send-whatsapp-message precisa de novo redeploy a partir do main` e NÃO tentar corrigir. Se `com_autor` > 0, marcar concluído com os números. Se `total` = 0, deixar pendente (ainda não houve envio humano).

Conferido em 2026-09-08 20:05 UTC: 431 mensagens outbound (text/audio/image/document/video, status <> 'system') desde 2026-09-08 02:24 UTC, sendo 390 com sender_id preenchido (90,5%). O carimbo de autor está funcionando. As 41 sem sender_id (18 text/read, 8 audio/played, 7 text/delivered, 4 text/sent, 3 audio/delivered, 1 audio/sent) ocorreram entre 08:00 e 19:00 UTC e não têm autor humano — compatível com envios automáticos; não foi feita nenhuma correção.

## Item 4 — Conferir carimbo de crédito no primeiro agendamento real

- status: concluído em 2026-09-08 20:05 UTC (rotina na nuvem)
- autorizado: sim
- como fazer: `SELECT credito_origem, count(*) FROM crm_appointments WHERE created_at > '2026-09-08 00:00:00+00' GROUP BY 1`. Se houver linhas com `credito_origem` diferente de `backfill_fase0` (esperado: `dona_do_lead_na_criacao`, `herdado_remarcacao`, `sem_dona_na_criacao` ou `informado_pelo_servidor`), marcar concluído com a distribuição. Se todas as linhas novas estiverem NULL, marcar `bloqueado: gatilho trg_zz_carimba_credito_agendamento não carimbou` sem corrigir. Se não houver linhas, deixar pendente.

Conferido em 2026-09-08 20:05 UTC: 18 agendamentos criados desde 2026-09-08 00:00 UTC, todos com credito_origem carimbado — 17 'dona_do_lead_na_criacao' e 1 'herdado_remarcacao'. Nenhuma linha nova com NULL nem com 'backfill_fase0'. O gatilho trg_zz_carimba_credito_agendamento está funcionando.

## Item 5 — Fases 2 a 5 do rodízio (ponto, motor, fechar conversa, pesquisa, relatórios)

- status: concluído em 2026-09-09 03:16 UTC (3 migrations aplicadas + site publicado)
- autorizado: sim

Migrations `20260909100000_sdr_fase3_motor_rodizio.sql`,
`20260909100100_sdr_fase2_ponto_e_conversa.sql` e
`20260909100200_sdr_fase5_relatorios.sql` aplicadas; site `index-I6nzPqb7.js`.
Conferido: `crm_rodizio_config.modo = 'desligado'`, 29 funções `rodizio_*`, 11
`ponto_*`, 3 `relatorio_sdr*`, crons `rodizio-processar-novos`,
`rodizio-corte-9h`, `rodizio-realocacao`, `ponto-vigia`; 0 leads com SDR, livro
intacto; 512 policies antigas com o mesmo hash (a única policy nova sem prefixo
`sdr_` é `notif_dedupe_so_servidor`, RESTRICTIVE, só o servidor grava
`dedupe_key`).

## Item 6 — Ligar o rodízio em modo sombra

- status: concluído em 2026-09-09 11:38 UTC (pela aba Equipe, como rizodentvca2)
- autorizado: sim

Modo `sombra` desde 09/09 08:38 (Bahia); Júlia, Fabíola e Bia dentro do
rodízio; 0 leads movidos. Prévia da distribuição inicial: 15 leads aguardando
resposta, revezando entre as três. O painel do motor está na aba Equipe
(`RodizioPainel`), com Desligar / Modo sombra / Ligar e a prévia.

## Item 7 — Ligar de verdade (modo `ligado`)

- status: pendente
- autorizado: não (só o dono manda; a rotina NUNCA muda `crm_rodizio_config.modo`)

Depois de alguns dias de sombra, o gestor clica "Ligar" na aba Equipe e depois
"Distribuir os leads sem resposta agora" (prévia → confirmar). Conferir no dia
seguinte: livro `crm_lead_atribuicoes` com fases `aplicacao`/`corte_9h`,
`leads_com_sdr` > 0, e nenhum lead com duas donas.

Quando o dono mandar: o gestor (rizodentvca2) chama `rodizio_definir_modo('sombra')`;
5 dias úteis + 1 sábado só anotando no livro (fase `sombra`) quem teria
recebido; depois `rodizio_definir_modo('ligado')`. A distribuição inicial dos
leads sem resposta é `rodizio_distribuir_sem_resposta_agora(true)` (dry-run)
e depois `(false)`. Desligar = `rodizio_definir_modo('desligado')` (cancela
reservas sem mover ninguém).

## Item 8 — Editar/excluir SDR pelo gestor + carência antes de entregar ao administrador

- status: concluído em 2026-09-09 16:10 UTC (migrations `20260909210000` e `20260909220000`
  aplicadas, `admin-manage-user` republicada pelo agente do Lovable, site `index-CbXHq__g.js` no ar)
- autorizado: sim

Conferido: `entrega_gestor_apos_min` = 1440; cron `sdr-entrega-ao-gestor` a cada 5 min;
8 funções novas presentes; `crm_entregas_gestor` sem policy para authenticated;
`equipe_excluir_previa` como gestor devolve a prévia certa (Bia: 1 lead, modo
desligado, elegíveis Júlia/Fabíola → destino automático = administrador); ensaio
de `equipe_redistribuir_leads` (com RAISE no fim) moveu 1 lead ao administrador e
foi desfeito sem rastro. Como SDR (sessão da Bia) a function responde 403 a
create/set_email — isolamento mantido. O caminho completo do gestor pela tela
(Editar / Excluir) ainda não foi exercitado por falta de sessão do gestor aberta;
o dono testa na aba Equipe.

Decisões do dono (09/09, noite): (a) o gestor edita nome/e-mail da SDR e
redefine a senha no mesmo diálogo — trocar de pessoa é só isso, a conta e o
histórico ficam; (b) excluir SDR redistribui os leads dela automaticamente
(rodízio ligado → outras SDRs; senão → administrador) antes de apagar a
conta; (c) depois do comparecimento o lead fica com a SDR por uma carência
(padrão 24 h, ajustável no painel do rodízio) antes de passar ao
administrador — cron `sdr-entrega-ao-gestor`.

Conferir depois de publicado: `SELECT entrega_gestor_apos_min FROM
crm_rodizio_config` = 1440; `cron.job` tem `sdr-entrega-ao-gestor`; as 5
funções `equipe_*` novas existem; `crm_entregas_gestor` sem policy para
authenticated. Nunca executar `equipe_redistribuir_leads` de verdade sem o
dono mandar (o ensaio com RAISE no fim, descrito na migration, é seguro).
