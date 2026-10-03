# Corrigir erro ao salvar lead, notas e edição de nome

## Causa (confirmada no banco)
No endurecimento de segurança anterior, foi retirada a permissão dos usuários logados de executar as funções automáticas (gatilhos) que rodam ao salvar um lead ou uma nota. Confirmado: 26 funções ligadas a leads e notas (ex.: preencher clínica, histórico de etapa, rodízio, follow-up) estão bloqueadas para usuários logados. Como o banco precisa rodar essas funções a cada gravação, criar lead, salvar nota e editar nome falham.

## Correção
Uma migration que devolve aos usuários logados a permissão de executar **todas as funções de gatilho** do sistema (não só as de leads e notas, para evitar o mesmo erro em pagamentos, agendamentos, tarefas, mensagens etc.).
- Visitantes não logados continuam sem acesso.
- Nenhuma tabela, regra de acesso por clínica ou código do app muda.

## Verificação
- Conferir no banco que nenhuma função de gatilho fica sem permissão para usuários logados.
- Testar logado: criar lead, salvar nota e renomear lead.

## Detalhes técnicos
`GRANT EXECUTE` para `authenticated` em todas as funções de `public` com `prorettype = 'trigger'::regtype`, via bloco `DO` iterando `pg_proc`. Sem `anon`.
