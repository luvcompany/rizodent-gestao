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

## Item 9 — Bateria de testes do sistema da SDR + correções

- status: concluído em 2026-09-09 18:05 UTC (migrations `20260909230000_sdr_correcoes_pos_teste.sql`
  e `20260909240000_entrega_reconfere_consulta.sql` aplicadas; site `index-BpRIlCnt.js`)
- autorizado: sim

Ensaios no banco de produção em transações desfeitas (motor, ponto, conversa/pesquisa,
propriedade, carência, equipe, RLS como SDR) + 2 revisores de código. Onze defeitos
corrigidos (ver cabeçalho da migration 230000): ciclo encerrado voltava à fila
(rodizio_limpa_reserva zerava distribuido_em e a régua aceitava etapas do
administrador), realocação durante a carência, carência 0 recusada pelo gatilho
da SDR, reservas presas ao bloquear/tirar do rodízio, varredura por toque em
botão, falha/ligação não atendida contadas como resposta humana, reserva contada
como lead recebido no relatório, entrega agendada sem reconferir o desfecho,
pós-venda morto no seletor da SDR, "Compareceu" da SDR sem mover etapa (e
reexecutando automações da etapa atual), lead criado à mão distribuído na hora.
Pendentes de decisão do dono: dontus-sync não promove not_contracted→contracted
quando o pagamento aparece depois de a SDR marcar; ramal Api4Com por SDR sem tela
(api4com_extensions nunca é gravada); "mover para etapa atual" do Kanban falha
para lead de SDR; varredura de telas no Chrome não rodou (aba da Bia travada).

## Item 10 — Horário por SDR, corte relativo, funis por procedimento, ordem dos funis, reagendamentos, Dontus promove contrato

- status: concluído em 2026-09-09 ~20:40 UTC (migrations `20260910000000` e `20260910001000`,
  `dontus-sync` republicada, site `index-y-4f0fTb.js`)
- autorizado: sim

Decisões do dono (09/09, noite): horário de trabalho por SDR (entrada, saída,
almoço, sábado) na aba Equipe → Editar; corte das reservas = entrada da SDR +
tolerância (`crm_rodizio_config.corte_tolerancia_min`, padrão 60, no painel);
quem não trabalha no dia tem as reservas passadas na hora; domingo/feriado nada
se move. Funis Prótese, Implante, Zigomático, Faceta, Protocolo e Aparelho
criados com as 15 etapas do Funil Principal; todo funil novo nasce assim
(`trg_zz_pipeline_etapas_padrao`) e etapas do administrador nascem ocultas
para a SDR (`trg_zz_stage_regras_padrao`). Ordem dos funis em Configuração do
Funil → menu ⋮ → Ordem dos funis (`crm_pipelines.position`). Reagendamentos,
"reagendou e faltou" e leads com 2+ faltas no Relatório das SDRs e em Meu
desempenho (`relatorio_sdr_reagendamentos`). Fim da carência sem contrato →
"Não contratado" com o administrador (`sdr_pos_entrega_etapa`); comparecimento
marcado pelo Dontus/CRC em lead de SDR reflete no funil (Compareceu/Contratado).
`dontus-sync` (modo comparecimento) promove consulta not_contracted → contracted
quando acha pagamento que conta (45 dias) e move o lead para Contratado.

Incidente do mesmo dia: ao mover 96 leads de Arraiá/Indicação/Não contratados
para o Funil Principal (backup em `crm_leads_funil_backup_20260909`), a regra
por tempo "sem resposta" de Conversando/Novo Lead moveu 68 para Follow-Up e o
bot de entrada mandou o template follow_up_0 para 46 leads. Dono decidiu deixar
no Follow-Up. Lição: antes de mover lote de leads para etapas com automação,
desligar TAMBÉM as automações por tempo (no_response) das etapas de destino ou
mover para etapa sem automação. Os funis vazios (Arraiá, Indicação, Não
contratados, Não Compareceu) sumiram em seguida — provavelmente apagados pelo
dono na tela.

## Item 11 — Aba "Comparar funis" nos Relatórios

- status: concluído em 2026-09-09 ~21:10 UTC (migration `20260910002000_relatorio_funis.sql`, site)
- autorizado: sim

RPC `relatorio_funis(p_de, p_ate)` (gestão): por funil, base (leads hoje), novos
no período, agendamentos/compareceram/faltas/contratados por data agendada,
leads na etapa Contratado, receita e pagantes (pagamentos no período de
pacientes ligados por `crm_lead_pacientes`, vínculo principal, sem orto
recorrente e sem "não marketing"). Aba em Relatórios → Comparar funis
(`src/components/relatorios/CompararFunisTab.tsx`): ordenação por conversão /
receita, cartões de melhor conversão e maior receita, barras comparativas.

## Item 12 — Expediente encerra sozinho + reset final da Bia + teste real em 10/09

- status: concluído em 2026-09-09 ~22:00 UTC (migration `20260910003000_expediente_encerra_sozinho.sql`, site `index-CXgZeNmy.js`)
- autorizado: sim

`ponto_vigia` (cron 5 min) encerra a sessão aberta antes da saída de hoje da SDR
(horário dela ou comercial) quando passa da saída + 1 min, salvo adiamento
(`crm_rodizio_membros.encerramento_adiado_ate`); sessão aberta depois da saída
(hora extra) fica para a regra das 23:59. Cartão da SDR: `ponto_fim_expediente`
diz a hora; ao chegar, aviso com 15 s → "Encerrar agora" ou "Continuar por mais
5 min" (`ponto_adiar_encerramento`), que reaparece ao fim dos 5 min. PEGADINHA:
o agente do Lovable aplicou `ponto_vigia` com `r.user_id` na lista de colunas
do INSERT (texto mangled) — recriei a função direto pelo query_database; ao
aplicar migration grande pelo agente, conferir a definição no banco depois.
Reset da Bia (22:00 UTC): 1 lead devolvido (Vitor Santos → administrador, etapa
Relacionamento), 2 consultas de teste apagadas, 1 consulta real (RUBENILSON
11/09) mantida sem o crédito dela, livro/ponto/pesquisa/mensagens de sistema
limpos. O dono vai testar de verdade em 10/09: cadastrar horários das SDRs na
aba Equipe (Editar) e ligar o rodízio no painel.

## Item 13 — Auditoria de 09/09 (28 achados) corrigida, aplicada e ensaiada

- status: concluído em 2026-09-10 ~05:40 UTC
- autorizado: sim ("corrija tudo")
- commit `356a6f0e`; site no ar com `assets/index-TGxm-py5.js`
- migrations aplicadas em produção, nesta ordem:
  `20260910010000_fechar_funcoes_abertas.sql`,
  `20260910011000_motor_multifunil_e_relogio.sql`,
  `20260910012000_ciclo_carencia_e_relatorios.sql`,
  `20260910013000_gatilhos_desfecho_e_etapas.sql`
- edge functions reimplantadas: `admin-manage-user`, `dontus-sync`

O que mudou, por tema:

1. Superfície fechada. REVOKE de EXECUTE em 8 funções que estavam abertas a
   `authenticated`/`anon` (`watchdog_reenqueue_missing_bots`,
   `recover_stuck_bot_executions`, `backup_list_tables`,
   `ensure_instagram_pipeline`, `recalculate_all_lead_scores()` sem argumento,
   `notify_dashboard_event`, `dono_restrito_do_numero` para anon) e guarda de
   superadmin em `generate_tenant_invoices`. A chave do Rizodent Vision saiu do
   corpo de `notify_dashboard_event` e passou a ser lida de
   `public._internal_secrets` (deny-all); falta a chave ser ROTACIONADA pelo
   dono, porque esteve em texto no banco e em todos os backups.
2. Motor multi-funil. `crm_rodizio_config.funis_ids` + `rodizio_funis`,
   `rodizio_definir_funis` (recusa Instagram, pós-venda e qualquer funil com
   `allowed_roles` preenchido — closer/recepção). Hoje a coluna está NULL, ou
   seja, o rodízio segue só no Funil Principal até o dono escolher na tela.
3. Relógio útil. `rodizio_minutos_uteis` mede silêncio em minutos de
   expediente (madrugada e domingo não contam); `rodizio_em_almoco` tira a SDR
   do pool "aberta" durante o almoço sem marcá-la ausente para o corte.
4. Ciclo da carência. `sdr_marcar_comparecimento` não mexe mais na etapa e
   devolve o campo `entrega`; quem move a etapa é `sdr_entrega_lead_ao_gestor`,
   na hora da entrega. Com o motor desligado a linha ainda entra na fila (o
   ciclo não se perde) e o chat diz "EM ESPERA" em vez de prometer hora.
5. Entrega que falha não some. `crm_entregas_gestor.tentativas` + recuo de
   30 min × tentativa; acima de 5 tentativas desiste, escreve no livro e
   notifica o administrador.
6. Relatórios. `relatorio_funis` sem o funil de pós-venda e recortado por
   tenant; `relatorio_sdr_reagendamentos` sem dupla contagem no total da equipe.

Ensaios em produção (todos dentro de transação desfeita, 10/09 ~05:00-05:40 UTC):

- relógio útil: madrugada 0, dentro 60, atravessando a noite 180, sábado 90,
  domingo 0, mais de 30 dias 999999 — todos batem
- régua multi-funil: lead de Prótese fica fora com `funis_ids` NULL e entra com
  a lista preenchida; comparecimento de 5 dias segura o lead, de 60 dias não;
  entrega pendente segura
- `rodizio_definir_funis`: recusou Instagram, Pós-venda e Padrão Closer;
  aceitou Principal+Prótese+Implante na ordem de exibição
- carência: etapa não mudou, dona continuou a SDR, consulta virou
  `not_contracted`/`outcome_source='sdr'`, fila com +24 h e consulta vinculada
- entrega: motor desligado não entrega e mantém a linha; motor ligado entrega,
  move para "Não contratado" (etapa invisível para a SDR) e o dono vira o CRC
- falha: tentativas 1 e 2 com recuo 30 e 60 min, lead segue com a SDR;
  desistência em 6 tentativas com aviso ao administrador e registro no livro
- almoço: `aberta=false` e `presente=true` durante o almoço; sem horário
  cadastrado o almoço não vale
- teto por SDR: rodízio circular Júlia→Fabíola→Bia, parada exata no teto com
  `para_nome` nulo. Havia 29 leads elegíveis aguardando no dia do ensaio
- corte relativo: entrada 08:00 + 60 min não corta às 05:31; entrada 03:00
  corta e a mensagem diz o limite e a entrada
- expediente: adiamento de 5 min segura o `ponto_vigia`; vencido, ele encerra
- relatórios: `relatorio_funis` traz os 6 funis novos e não traz pós-venda;
  reagendamentos com 2 remarcações, 1 falta depois de remarcar e 1 lead com
  2 faltas, sem dupla contagem no total

Pendências que ficam para o dono:

- rotacionar a chave do Rizodent Vision
- escolher os funis do rodízio na tela (hoje só o Funil Principal)
- a etapa "Não contratado " está gravada com um espaço no fim do nome

## Item 14 — Automações copiadas para os 7 funis de procedimento

- status: concluído em 2026-09-10 ~11:30 UTC (só banco de produção, sem migration e sem publish)
- autorizado: sim ("copie as automações/gatilhos para todos os funis novos", "menos
  para o funil instagram e o funil nutrição", "faça no funil outros também",
  "só o audio inicial que não deve ser copiado")

Destino: Prótese, Implante, Zigomático, Faceta, Protocolo, Aparelho e Outros.
Instagram e Nutrição ficaram intactos, como pedido.

O Funil Principal tinha 15 automações. Foram copiadas 14 para cada funil, 98 no
total. A que ficou de fora é a da etapa "Novo Lead" com gatilho de criação que
dispara o bot "Áudio Inicial" — o dono pediu exatamente isso, porque mover um
lead para a etapa Novo Lead de um funil faria o áudio tocar de novo para quem já
tinha ouvido.

Ajustes feitos em cada cópia, porque copiar cru levaria o lead de volta ao
Funil Principal:

1. `target_stage_id` do `move_stage` repontado para a etapa "Follow - Up" DO
   PRÓPRIO funil (era a do Principal).
2. `pipeline_id` do `assign_lead` repontado para o próprio funil. Essa automação
   continua inativa, como está no Principal.
3. A chave `send_to_all_existing` foi REMOVIDA da cópia. Ela não descreve
   comportamento contínuo: é o "enviar para todos que já estão na etapa", e é o
   caminho que em 09/09 mandou template para 46 pessoas. Inserir automação por SQL
   não dispara esse caminho (ele só roda pela tela, em
   `enqueue-stage-automation`), mas deixar a chave gravada seria uma bomba para o
   próximo que abrisse e salvasse a automação na tela.

### Os bots também precisaram ser clonados

Descoberta no meio do caminho: os bots têm `stageId` FIXO dentro do fluxo, e o
`bot-engine` move o lead levando o `pipeline_id` da etapa de destino junto
(`case "move_stage"`, comentário "pipeline_id acompanha a etapa"). Ou seja, um
lead de Prótese que recebesse o bot "Follow - UP" e clicasse num botão seria
movido para "Recuperado" do FUNIL PRINCIPAL — saindo do funil de procedimento e
esvaziando o relatório de conversão por procedimento, que é o objetivo de tudo
isso.

Por isso foram criados 14 bots, dois por funil: `Follow - UP (<funil>)` e
`Agendamento (<funil>)`, com os nós de etapa apontando para o próprio funil:

- `Follow - UP`: nó `move_recuperado` → "Recuperado" do próprio funil. O nó
  `move_nutricao` ficou como estava, porque ir para o funil Nutrição é intencional.
- `Agendamento`: nó `move-1` → "Pré - Agendado" do próprio funil; nó
  `move_stage-1776523980304` → "Conversando" do próprio funil, com o
  `pipelineId` também trocado.

As 21 automações que usam bot (2 de `time_window` e 1 de `on_create_or_enter` por
funil) foram repontadas para os clones. Os clones nascem com
`current_version = 0` de propósito: com versão zero o `bot-engine` usa sempre o
`flow_json` do próprio bot e nunca procura em `bot_versions`, que não tem linha
para eles.

Não foi mexido no bot original nem no `bot-engine`. Consequência conhecida: o
funil Instagram continua com o comportamento antigo (o bot leva o lead dele para
o Funil Principal). Instagram estava fora do pedido.

### Por que ninguém recebeu mensagem indevida

Medições feitas antes de aplicar, com a régua real de cada gatilho lida no
`automation-engine`:

- `no_response` exige que o lead tenha escrito, que a clínica tenha respondido
  depois, e que tenha passado o prazo. Quando `no_response_amount` está ausente o
  motor assume 1 (linha 141), então a automação de "Conversando" é 1 dia. Os 24
  leads que estavam em "Conversando" nesses funis tinham no máximo 3,1 h sem
  resposta — nenhum elegível.
- `time_window` e `on_create_or_enter` só têm automação nas etapas "Novo Lead",
  "Recuperado" e "Follow - Up", e nenhum lead desses funis estava nessas etapas.
- `manual_bulk_send` só roda por clique humano com confirmação.
- `before_scheduled` tinha UM caso na janela: MATHEUS SOUZA LIMA, consulta hoje
  13:00, lembrete de 2 h antes já vencido às 11:00. Para não mandar lembrete
  retroativo, a mesma transação gravou o claim em `crm_automation_queue` com
  status `sent` e a razão no `error_message`, usando o UNIQUE
  `(automation_id, appointment_id)` que o motor respeita. Os outros quatro
  agendamentos estavam fora da janela ou em etapa sem automação.

Quatro minutos de observação depois de aplicar: só conversa humana no ar, nenhum
template, nenhum bot, nenhuma mudança de etapa automática.

### Como desfazer, se precisar

```sql
-- apaga as 98 automações copiadas e os 14 bots clonados
DELETE FROM public.crm_automations a USING public.crm_stages s
 WHERE s.id = a.stage_id AND s.pipeline_id IN (
   '0d939ab5-acd3-436d-9485-bcaef0127484','32cf10d0-f766-4b4c-9f1d-eddd99384876',
   '68aca303-e832-490b-872d-4cbf6870c498','26f9b40e-336e-44c0-a6a4-331fd36205c3',
   'f88daf77-aec8-42b2-a95e-40219963c6ae','5d21ddd4-2125-43b0-84a4-594a1f6def0f',
   'c29d501a-2b3f-41c6-a966-b758a2766fb7');
DELETE FROM public.bots
 WHERE name ~ '\((Prótese|Implante|Zigomático|Faceta|Protocolo|Aparelho|Outros)\)$';
```

### O que ainda falta neste tema

O gatilho `trg_zz_pipeline_etapas_padrao` clona as ETAPAS de todo funil novo, mas
não clona automações nem bots. Funil criado de agora em diante nasce com as
etapas certas e sem automação. Copiar automação e bot no mesmo gatilho é o passo
que falta para o pedido "todo funil novo já deve nascer assim" valer inteiro.

### Achado colateral: o watchdog reenfileira bot sem trava de "já executou"

Não é regressão da cópia, é anterior e vale para o Funil Principal. Registrado
aqui porque apareceu ao medir o risco.

`watchdog_reenqueue_missing_bots()` roda todo dia às 03:00 UTC, ou seja meia-noite
na Bahia (cron `watchdog-reenqueue-missing-bots-daily`). Ela enfileira um
`send_bot` para TODO lead cuja etapa tenha automação `on_enter` ou
`on_create_or_enter` ativa com `send_bot`. As duas únicas condições são: não
existir execução do bot em `active`/`waiting_reply` e não existir item `pending`
na fila. Execução que já terminou em `completed` não impede nova rodada.

Números medidos em 10/09/2026, só para o bot "Follow - UP":

| medida | valor |
| --- | --- |
| execuções totais | 22.569 |
| leads distintos | 6.112 |
| média por lead | 3,69 |
| leads com 1 execução | 2.071 |
| leads com 5 ou mais | 1.975 |
| maior repetição num único lead | 16 |
| leads hoje na etapa exposta | 181 |
| envios de bot enfileirados e entregues em 7 dias | 237 |

Parte da repetição é legítima: o lead volta para a etapa e o ciclo recomeça. Mas
16 execuções no mesmo lead e um terço dos leads com 5 ou mais são sinal de que a
régua do watchdog merece revisão. Nada foi alterado — é preciso primeiro
distinguir reentrada legítima na etapa de reenfileiramento cego, cruzando
`bot_executions.started_at` com `crm_lead_stage_history`.

Os 7 funis novos ficam sujeitos à mesma régua quando tiverem lead em
"Follow - Up". Hoje não têm nenhum.

## Item 15 — Sete pedidos do dono de 10/09, aplicados e publicados

- status: em produção em 2026-09-11 ~00:55 UTC
- autorizado: sim ("Aplique logo")
- commit `84b457a5`; site no ar com `assets/index-DCYeIUj0.js`
- migrations aplicadas nesta ordem: `20260910130000_sdr_desfecho_e_autonomia.sql`,
  `20260910140000_relogio_justo_do_silencio.sql`,
  `20260910160000_sdr_autonomia_nos_funis_dela.sql`
- edge function reimplantada: `enqueue-stage-automation`
- 618 policies em public + storage (eram 609; as 9 novas são da SDR e nenhuma
  antiga saiu)

O que entrou:

1. **Corrigir e excluir desfecho.** `sdr_corrigir_desfecho(uuid, boolean)` troca
   entre compareceu e não compareceu; `sdr_excluir_agendamento(uuid, text)` marca
   `cancelled` (a trilha fica, e todo relatório já ignora cancelado) e pede
   motivo. As duas recusam quando o desfecho veio do Dontus: ali quem decide é o
   pagamento. Provado em produção no caso real do dono — o lead Vitor Santos, da
   Fabíola, tinha DOIS agendamentos idênticos de 10/09 09:00, criados às 12:02 e
   12:21, porque ela não conseguia corrigir o primeiro.
2. **Etapa "Compareceu" é da SDR.** Visível nos 9 funis que a têm; marcar
   comparecido move o lead para lá na hora. Contratado, Não contratado e
   Compareceu e agendou seguem ocultos (29 etapas).
3. **A SDR nunca lê contrato.** Helper único `src/lib/desfechoLabel.ts` decide por
   NEGAÇÃO: só papel positivamente reconhecido como gestão vê "Contratado" /
   "Não contratado"; papel nulo ou desconhecido lê "Compareceu". Antes decidia por
   afirmação e a janela do boot vazava.
4. **Botão AUTOMATIZE.** `/crm/automacoes` entrou em `SDR_PREFIXES` e no menu.
5. **A SDR cria estrutura — nos funis dela.** Decisão do dono entre três opções.
   Régua = autoria (`created_by` em `crm_pipelines` e `crm_stages`). O que já
   existia fica sem autor e é intocável: 13 funis e 160 etapas protegidos sem
   depender de comparar nome.
6. **Relógio justo da realocação.** `rodizio_minutos_da_sdr` conta só o tempo em
   que ela está com o expediente aberto e sem pausa. Mais
   `realocar_carencia_abertura_min` (60) para a fila da manhã, e teto de ausência
   para quem não abriu o ponto no dia.
7. **Disparo em massa para a SDR** com filtro por `assigned_to`.

Ensaios em produção (transação desfeita): correção e exclusão 10/10 no caso real;
relógio 5/5 (almoço 0 min, pós-almoço 40, noite 0, dia 540, fechamento 18:00);
autonomia 8/8 (clínica recusa apagar, renomear, tornar visível e criar automação;
funil dela cria com autoria e 15 etapas clonadas, aceita etapa e automação,
recusa apagar etapa com lead).

### A revisão adversarial reprovou duas rodadas, e valeu

39 defeitos na segunda rodada, 5 bloqueantes. O pior: a primeira versão liberava
escrita nos funis da clínica, e apagar etapa leva os leads por
`ON DELETE CASCADE` — a SDR mandaria excluir o Funil Principal e iria embora com
os 3.582 leads, com mensagens e agendamentos, porque o contador de leads da tela
roda sob a RLS dela e mostra zero quando os leads são das colegas.

Os outros quatro: automação criada por ela em etapa compartilhada dispara para o
lead de qualquer colega (o gatilho de entrada não filtra dono); etapa com nome
parecido sequestra o ciclo, porque o front casa etapa por pedaço do nome e pega a
primeira por position; criar funil nem funcionava, porque o `INSERT ... RETURNING`
avalia a policy de SELECT na linha nova e nenhuma passava para SDR pura; e o
front disparava as automações de entrada por cima da fila do banco, o que mandaria
a mensagem DUAS vezes ao paciente.

A partir da terceira rodada o conserto foi à mão, com Postgres descartável para
provar cada caso. Foi mais rápido e mais preciso que outra rodada de agentes.

### O que fica para o dono

- O motor do rodízio continua DESLIGADO. Ligar é na aba Equipe.
- Horários hoje: a Bia tem entrada 08:00 e saída 18:00, sem almoço e sem sábado;
  Júlia e Fabíola sem horário nenhum, então caem no horário da clínica. A regra do
  almoço funciona pelo botão de pausa mesmo sem o almoço cadastrado.
- Ainda não implementado, dos pedidos de 10/09: fechar a conversa automaticamente
  nas etapas Agendado, Reagendado e Relacionamento; e o botão Reagendar caindo
  direto no seletor de data e hora, movendo para "Reagendado" ao confirmar.
