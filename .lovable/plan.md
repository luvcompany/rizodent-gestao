# Relatório das SDRs: "marcou no dia" x "consulta do dia"

## O que muda para você
Na tela Relatório das SDRs, usando o mesmo filtro de período (hoje, semana, mês, personalizado), cada SDR passa a ter duas visões separadas:

1. **Agendamentos feitos (produção)**: quantas consultas ela marcou em cada dia, pela data em que marcou. Mostra o total do período e a média por dia.
2. **Consultas do dia (resultado)**: as consultas dela marcadas para acontecer em cada dia, com o que aconteceu. Exemplo de hoje: 5 marcadas, 2 compareceram, 1 remarcou, 1 pendente, 1 faltou/cancelou.

## Como aparece
- No cartão de cada SDR, os dois blocos lado a lado com os totais do período.
- Abaixo, uma tabela **dia a dia** (rola dentro do cartão no celular), uma linha por dia, com colunas:
  Marcou no dia | Consultas do dia | Compareceram | Faltas | Cancelamentos | Remarcados | Pendentes.
- Linha de total no fim. No bloco "Equipe no período", os mesmos dois números somados da equipe.
- Clicar num número abre a lista dos leads com o botão "Ver conversa", como no relatório geral.

## Regras de contagem (iguais ao relatório geral)
- Crédito da consulta vai para a SDR carimbada no agendamento (mesma regra de hoje).
- "Consultas do dia" usa a data marcada da consulta; "Marcou no dia" usa o dia em que foi criada.
- Compareceu = contratou ou não contratou; falta; cancelada sem nova consulta = cancelamento; cancelada com nova consulta ou remarcada = remarcado; sem resultado = pendente.
- Em cada dia, compareceram + faltas + cancelamentos + remarcados + pendentes = consultas do dia; se não fechar, aviso vermelho.
- Dias e horários no fuso da Bahia.

Os números atuais da tela não mudam.

## Detalhes técnicos
- Nova função no banco `relatorio_sdr_diario(p_de, p_ate)` (SECURITY DEFINER, restrita ao tenant de quem chama; gestor vê todas, SDR só a si) agrupando `crm_appointments` por `responsavel_credito_id` e dia (`created_at` em America/Bahia e `scheduled_date`), com os ids para as listas.
- Listas reaproveitam `relatorio_agendamentos_detalhe`.
- Front: `src/lib/relatorioSdr.ts` (tipo + chamada) e `src/pages/CrmRelatorioSdr.tsx` (novos blocos e tabela diária); a tela "Meu desempenho" da SDR recebe o mesmo bloco só com ela.
- Conferir com os dados de hoje da Bia e da Kelly no banco antes de concluir.
