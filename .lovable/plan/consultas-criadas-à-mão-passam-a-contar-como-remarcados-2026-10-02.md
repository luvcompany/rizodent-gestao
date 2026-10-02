# Consultas criadas à mão passam a contar como Remarcados

## O que muda para você
- Hoje, uma consulta nova criada à mão para um lead que já tinha consulta antes não entra em Remarcados. Com a mudança, ela passa a contar lá, junto com as remarcações feitas pela opção de remarcar.
- Remarcados vai somar as duas coisas: as consultas remarcadas pelo botão e as consultas novas desse mesmo lead criadas depois.
- Exemplo: o JOÃO PHILLIPE faltou em 26/09 e alguém criou uma consulta nova para 01/10. Em outubro, ele passa a aparecer em Remarcados, como Compareceu. Assim, Primeiro agendamento + Remarcados batem com o Geral.
- O indicador "Outros agendamentos de leads com histórico" continua embaixo de Remarcados. Ele passa a dizer quantas das remarcações foram criadas à mão, para vocês continuarem vendo quando a equipe não usou a opção de remarcar.
- Primeiro agendamento, Geral e Relatório de Faltas continuam com as mesmas regras.

## Regra nova
- Primeiro agendamento: a primeira consulta do lead, na ordem das datas. Pode ter sido feita em qualquer mês.
- Remarcação: toda consulta do lead depois da primeira, tenha ou não sido feita pela opção de remarcar.
- Para decidir o mês, continua valendo a data marcada da consulta. Cada lead conta uma vez só em cada bloco.

## Conferência antes de entregar
- Refazer as contas de setembro e outubro direto no banco e confirmar que os resultados de Primeiro agendamento + Remarcados fecham com o Geral (cada lead conta uma vez).
- Conferir que, em outubro, o JOÃO PHILLIPE aparece em Remarcados como Compareceu.

## Detalhes técnicos
- Migration recriando `relatorio_agendamentos`: o bloco Remarcados filtra `a.id <> primeiro.id` (primeira consulta do lead por scheduled_date, created_at) em vez de `is_rescheduled = true`. A primeira consulta passa a ser escolhida sem o filtro `NOT is_rescheduled`. `outros_agendamentos` vira o subconjunto do bloco Remarcados com `is_rescheduled = false`.
- Em `faltas_det`, "falta_novamente" usa a mesma definição nova de remarcação.
- Na tela, só muda o texto de ajuda do indicador de auditoria, para "Já incluídos em Remarcados". Nada é removido.
