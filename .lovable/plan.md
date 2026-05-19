Diagnóstico do que mudou e deixou lento:

- A principal mudança foi transformar quase todas as páginas em `React.lazy()` dentro de `src/App.tsx`. Isso reduziu o pacote inicial, mas criou um efeito ruim no CRM: ao trocar de aba, o componente da nova rota ainda não foi baixado/avaliado e o `Suspense` sem fallback renderiza `null`, gerando a tela branca.
- O carregamento do Kanban ficou mais pesado porque ele busca a primeira página de leads e, em seguida, continua carregando o restante em segundo plano. Esse carregamento dispara cálculos adicionais de pagamentos por lead sempre que a lista cresce.
- A aba Conversas está buscando 500 leads com muitas colunas e filtros de permissão por usuário/pipeline/número. No teste, essa query específica levou cerca de 1,3s; o backend está saudável, então o gargalo é combinação de volume, RLS/permissões e excesso de dados trazidos para a tela.
- A pesquisa de conversa/lead filtra localmente a lista inteira e ainda dispara busca no banco depois de digitar, com debounce de 350ms. Isso pode parecer “travado” quando a lista e os cálculos estão atualizando ao mesmo tempo.
- Há também chamadas repetidas de autenticação/perfil/roles no início, o que aumenta a sensação de demora ao trocar de rotas.

Plano de correção:

1. Remover tela branca na troca de abas do CRM
   - Desfazer o lazy loading apenas das rotas principais do CRM que precisam ser instantâneas: Kanban, Conversas, Dashboard, Calendário, Follow Ups, Relatórios, Configurações e Pós-Venda.
   - Manter lazy loading só em telas pesadas/menos acessadas, como editor de bot, painéis laterais e páginas administrativas.
   - Resultado esperado: clicar em abas do CRM não deve mostrar tela branca nem “Carregando”; a rota renderiza imediatamente.

2. Acelerar o Kanban
   - Manter uma cache global por pipeline para `pipelines`, `stages`, `profiles` e primeira página de leads, reaproveitando os dados quando o usuário volta para o Kanban.
   - Reduzir a primeira carga visual para o necessário e preservar dados antigos enquanto uma atualização em segundo plano acontece.
   - Mover o cálculo de pagamentos/vendas do mês para uma função de banco agregada, em vez de fazer várias consultas em lotes no navegador.
   - Evitar recalcular pagamentos toda vez que entram mais leads do carregamento progressivo; atualizar esse resumo de forma separada e leve.

3. Acelerar Conversas e pesquisa
   - Dividir a busca inicial: carregar lista enxuta de conversas primeiro, sem colunas pesadas/raramente usadas; carregar detalhes completos só quando uma conversa for selecionada ou quando abrir filtros avançados.
   - Trocar a pesquisa por uma função otimizada no banco para nome/telefone, com limite pequeno e normalização de telefone, em vez de filtrar grandes listas no navegador.
   - Usar `useDeferredValue`/debounce maior para a digitação não travar a UI enquanto a busca acontece.
   - Preservar a lista anterior na tela durante atualização, sem limpar para branco.

4. Reduzir chamadas repetidas de autenticação e perfil
   - Reaproveitar o `user` e `profile` já carregados no `AuthContext` no `ProtectedRoute` e no `CrmLayout`, evitando novas chamadas para `getUser`, `profiles` e `user_roles` em cada entrada de rota.
   - Manter apenas validações realmente necessárias em segundo plano.

5. Ajustar layout de Conversas
   - Corrigir os tamanhos do `ResizablePanelGroup`, pois o console mostra aviso de layout inválido (`24% + 46%`). Isso causa normalização/re-render e piora a sensação de instabilidade.
   - Definir tamanhos que sempre somem 100% conforme o painel direito esteja aberto ou fechado.

Validação após implementar:

- Testar navegação entre Kanban, Conversas e Follow Ups sem tela branca.
- Medir novamente as requisições principais no browser: a primeira query de conversas deve ficar menor e a troca de abas deve renderizar imediatamente.
- Testar digitação na busca de Conversas e Kanban para confirmar que a UI continua responsiva.
- Conferir que o Pós-Venda continua respeitando permissões e pipelines liberados.