# Cancelou e marcou de novo = remarcação

## Problema
Em outubro, a INGRID teve a primeira consulta (06/10) **cancelada**, e o operador criou uma consulta nova para 07/10 em vez de usar a opção de remarcar. O bloco Agendados conta ela como cancelamento (3), mas o Geral conta como pendente (2 cancelamentos). Na prática foi uma remarcação.

## Regra nova (só no relatório)
Uma consulta **cancelada** conta como **remarcada** quando o mesmo lead tem outra consulta marcada para depois dela. Ela passa a ser tratada igual a uma consulta remarcada pela opção de remarcar:
- Não conta mais em **Cancelamentos** em nenhum bloco.
- A consulta nova entra em **Remarcados**, com o resultado dela (compareceu, faltou, cancelou ou pendente).
- Cancelamento passa a ser só quem cancelou e **não** marcou outra consulta depois.

Para o primeiro agendamento, vale a mesma regra das remarcações feitas pela opção de remarcar.

## Resultado esperado em outubro
- Agendados: Cancelamentos cai de 3 para **2**. A INGRID sai desse bloco do mesmo jeito que sai um lead remarcado pela opção de remarcar.
- Remarcados: a INGRID continua lá, como pendente.
- Geral: continua com 2 cancelamentos (ALLAN e NILTON).
- Os três blocos passam a ter o mesmo número de cancelamentos para o mesmo caso.

O indicador de auditoria "Outros agendamentos de leads com histórico" continua mostrando esses casos, para a equipe ver quando alguém deixou de usar a opção de remarcar.

## O que não muda
- Nenhum lead, consulta ou etapa do funil é alterado. Muda só a forma de contar.
- O visual da tela continua igual.

## Conferência
Depois da mudança, vou refazer as contas de setembro e outubro direto no banco. Vou conferir que em cada bloco a soma fecha (compareceram + faltas + cancelamentos + pendentes = total). Também vou conferir que os cancelamentos do Geral e do Agendados não divergem mais por esse motivo. Passo os números novos de setembro.

## Detalhes técnicos
- Reescrever `relatorio_agendamentos` (e o detalhe das listas, quando depender disso). Antes de escolher a primeira consulta e os resultados, marcar como "remarcada" toda consulta `cancelled` que tenha outra consulta do mesmo lead com `scheduled_date` posterior. Essa consulta segue o mesmo tratamento que `status='rescheduled'` já recebe hoje.
- O cálculo continua SECURITY DEFINER, preso à clínica de quem está logado. Nenhuma alteração de dados.
