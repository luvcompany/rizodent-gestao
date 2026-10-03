# Endurecimento de segurança do banco (sem quebrar bots e automações)

## Por que nada vai travar — verificado antes de propor

Os bots, automações e regras do sistema rodam por caminhos que **não dependem** das permissões que este plano ajusta:

- **Gatilhos (triggers):** follow-up, rodízio, vínculo de paciente/lead, regra de orto — todos disparam como dono da tabela, sem precisar de permissão de execução. Confirmado: `cancel_followup_on_stage_exit`, `enqueue_followup_on_stage_entry`, `rodizio_processar_novos`, `pagamento_orto_regra`, `auto_link_paciente_to_lead_on_pagamento` etc. são SECURITY DEFINER e rodam pelo gatilho, não por chamada direta.
- **Rotinas agendadas (cron):** automation-engine, queue-worker, dontus-sync, limpezas — chamam as funções de borda com a chave de serviço, que passa por cima de qualquer permissão. Confirmado nos agendamentos ativos.
- **Telas do sistema:** continuam chamando só as funções que permanecem liberadas (relatórios, métricas, has_role).

Ou seja: o plano só fecha portas que **ninguém do sistema usa** — o acesso direto de fora (anon) a funções internas e tabelas de backup.

## O que será feito

1. **Tabela de backup sem proteção** (`_bkp_distribuido_em_20261003`): ativar RLS — fica inacessível pelo app, igual às outras tabelas `_bkp_`.
2. **Funções internas expostas:** revogar execução de `PUBLIC`/`anon` nas funções que só o banco usa (gatilhos, limpezas, cálculos de segundo plano). Manter `authenticated` apenas nas que o sistema realmente chama (relatórios, métricas, `has_role`, transferências).
3. **Nada muda em:** políticas de acesso das tabelas, gatilhos, crons, funções de borda, regras de negócio, dados.

## Validação antes de entregar

- Após a migração, rodar verificação confirmando que os gatilhos continuam ativos e os crons agendados.
- Testar um fluxo real: mover um lead de etapa (dispara follow-up) e conferir que a automação responde.

## Detalhes técnicos

- Uma única migração: `ALTER TABLE _bkp_distribuido_em_20261003 ENABLE ROW LEVEL SECURITY` + `REVOKE EXECUTE ... FROM PUBLIC, anon` nas funções internas (lista gerada a partir das 204 funções apontadas pelo linter, excluindo as chamadas pelo frontend).
- `SECURITY DEFINER` + `SET search_path` já existentes não são tocados; os alertas de "search_path mutável" que restarem serão avaliados função a função, sem mudança de comportamento.
- Nenhuma alteração em código do app nem em funções de borda.
