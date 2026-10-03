# Leads recebidos de um mês fechado não podem mudar

## O que já foi verificado
- O número "Leads recebidos" é calculado na hora, toda vez que a tela abre. Ele não é guardado.
- A conta usa duas fontes:
  1. O **responsável atual** do lead, com a data em que ele foi distribuído. Se o lead não tem essa data, entra a data em que ele chegou.
  2. O histórico de entregas do rodízio.
- Pela primeira fonte, quando um lead que chegou em setembro sem passar pelo rodízio é passado hoje para uma SDR, ele entra em setembro como recebido por ela. Isso faz um mês fechado crescer.
- Hoje há 60 leads de setembro nessa situação: estão com uma SDR e não têm a data de distribuição. 8 deles foram mexidos hoje.
- As mudanças de velocidade de hoje não alteram contagem nenhuma. Elas só mudaram a ordem em que a permissão é conferida.

## Etapas
1. **Achar os 21 leads.** Listar os leads que fazem setembro passar de 1.480 para 1.501, com nome, SDR, data de chegada e quando passaram para ela. Assim fica confirmado se a causa é essa.
2. **Corrigir a regra.** O lead conta só no mês em que realmente chegou à SDR: pela distribuição, por uma transferência ou pelo histórico do rodízio. Vale para o total da equipe e para cada SDR. Se ele só chegou no mês seguinte, conta só no mês seguinte. A data em que o lead entrou no CRM não é mais usada para essa conta. Assim, um mês já fechado não muda mais.
3. **Quando não houver data de entrega:** usar a data em que o lead foi passado para a SDR. Se essa data também não existir, o lead fica de fora dos meses fechados.
4. **Conferir:** recalcular setembro antes e depois da correção, mostrar a diferença lead a lead e confirmar que o total não muda ao reabrir a tela.

## O que não muda
Respondidos, tempo de 1ª resposta e os blocos de agendamentos continuam com a mesma regra. Nenhum lead nem responsável é alterado.

## Detalhes técnicos
- Na função do relatório das SDRs (CTE `recebidos_bruto`), o primeiro ramo usa `COALESCE(l.distribuido_em, l.created_at)` com o `assigned_to` atual. Trocar por `l.distribuido_em` (sem o fallback para `created_at`) ou pelo registro da transferência. Manter o ramo de `crm_lead_atribuicoes` como está.
- Antes de mudar, rodar um SELECT de diagnóstico que compara a contagem com e sem o fallback para setembro.
