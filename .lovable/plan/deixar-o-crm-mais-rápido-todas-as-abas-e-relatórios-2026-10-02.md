# Deixar o CRM mais rápido (todas as abas e relatórios)

## O que já foi medido
- O servidor está folgado: 31% de memória, poucas conexões, disco em 2%. Aumentar o servidor não resolve.
- As consultas mais lentas são leituras simples que levam de 1 a 7 segundos:
  - Tarefas (Calendário/Kanban): cerca de 1,9 s cada, até 7 s.
  - Colunas do Kanban (leads por etapa, com contagem): cerca de 0,3 a 0,4 s, até 7 s, e chamadas milhares de vezes.
  - Contador "leads da SDR" (responsável + bloqueado): cerca de 0,4 s, chamado 1.546 vezes.
  - Lista de Conversas do Instagram (mensagens com conta Instagram): cerca de 1,1 s.
  - Leads com pagamento (Pagamentos/Kanban): cerca de 0,8 s.
  - Agenda do período: cerca de 1,5 s. Busca por nome: cerca de 2,7 s.
  - Etiquetas, etapas e lista de nomes por id: 0,2 a 0,8 s, em tabelas pequenas.
- A causa mais provável, ainda não confirmada, é a conferência de permissão linha a linha, junto com a falta de índices nos filtros usados. Foi o mesmo motivo da lentidão do relatório de agendamentos, que já foi resolvida.

## Etapas
1. **Confirmar a causa.** Rodar o plano de execução de cada consulta acima com um usuário real (SDR e gestor) e separar o tempo gasto na permissão do tempo gasto na busca.
2. **Índices nos filtros usados:** etapa + bloqueado + posição/data no Kanban, responsável + bloqueado, tarefas por data e status, agenda por data, mensagens por clínica + conta Instagram, busca de nome por trecho (trigram) e última mensagem/entrada nas conversas.
3. **Permissões mais leves, com as mesmas regras.** Nas tabelas mais acessadas (leads, tarefas, agenda, mensagens, etiquetas, etapas), as funções de permissão passam a ser calculadas uma vez por consulta, e não uma vez por linha. Ninguém passa a ver mais nem menos do que vê hoje.
4. **Menos idas ao banco nas telas:**
   - Tarefas e etiquetas são carregadas só do período ou dos leads visíveis, em vez de tudo.
   - A contagem das colunas do Kanban usa a função de contadores que já existe, sem uma contagem completa por coluna.
   - Os contadores repetidos do menu e das abas passam a ficar guardados por alguns segundos, para não serem pedidos de novo a cada troca de tela.
   - Dados fixos, como etapas, funis, cidades e usuários, ficam guardados durante a sessão.
5. **Relatórios:** conferir o tempo do Dashboard, do Relatório das SDRs, de Pagamentos e de Anúncios. O que passar de 1 s ganha o mesmo tratamento do relatório de agendamentos: a conta passa a ser feita direto no banco, sempre limitada à clínica de quem está logado.
6. **Medir de novo:** repetir a lista de consultas lentas e abrir na prévia Conversas, Kanban, Calendário, Pagamentos e os relatórios. O objetivo é que cada tela carregue em menos de 1 s.

## O que não muda
Visual, números, regras, permissões, botões e filtros continuam iguais.

## Detalhes técnicos
- Migrations com `CREATE INDEX IF NOT EXISTS` (sem CONCURRENTLY) e `pg_trgm` para o ilike de nome.
- Nas políticas de RLS, trocar `has_role(auth.uid(), …)` e `current_tenant_id()` por `(select …)` para o resultado ser calculado uma vez por consulta (initPlan), sem mudar a lógica.
- No frontend, usar `staleTime` no React Query para os dados fixos e os contadores, filtrar `crm_tasks` e `crm_lead_label_assignments` e ler as contagens do Kanban pela RPC `kanban_contadores`.
