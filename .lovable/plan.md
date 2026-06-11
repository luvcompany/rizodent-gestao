## Objetivo

Separar todos os leads originados de anúncios de **Zigomático** que ainda **não agendaram nem contrataram** para o funil **Zigomático**, preservando o estágio em que cada um está hoje.

## 1. Criar estágios no funil Zigomático

O funil Zigomático (`13809677-…`) hoje tem só "Novo Lead". Vou completar com os mesmos estágios do Funil Principal, mantendo nomes, posições e cores:

| Posição | Estágio | Cor |
|---|---|---|
| 0 | Novo Lead (já existe) | #3b82f6 (ajustar) |
| 1 | Conversando | #f59e0b |
| 2 | Relacionamento | #8b5cf6 |
| 3 | Follow - Up | #f59e0b |
| 4 | Recuperado | #8b5cf6 |
| 5 | Pré - Agendado | #bff075 |
| 6 | Agendado | #c0ee1b |
| 7 | Não compareceu | #eab308 |
| 8 | Reagendado | #6366f1 |
| 9 | Contratado | #84cc16 |
| 10 | Desqualificado | #ef4444 |

Crio os 10 estágios faltantes e ajusto a cor do "Novo Lead" existente para casar com o padrão.

## 2. Critério de detecção (anúncios Zigomático)

Um lead é considerado de Zigomático quando **qualquer** um destes campos contém `zigom` (case-insensitive, com/sem acento):

- `nome_anuncio`
- `titulo_anuncio`
- `descricao_anuncio`
- `servico_interesse`

## 3. Critério de status (ainda não agendou/contratou)

Mover apenas leads cujo estágio atual (em **qualquer funil** do tenant Rizodent) tenha um destes nomes:

- Novo Lead
- Conversando
- Relacionamento
- Follow - Up
- Recuperado
- Não compareceu

**Não** serão movidos: Pré-Agendado, Agendado, Reagendado, Contratado, Desqualificado (e qualquer outro estágio fora da lista acima).

## 4. Migração dos leads

Para cada lead elegível:

1. Identifica o estágio atual pelo **nome**.
2. Mapeia para o estágio de mesmo nome no funil Zigomático.
3. Atualiza `pipeline_id` → Zigomático e `stage_id` → estágio espelho.

O trigger existente `sync_lead_stage_history` registra automaticamente a transição no histórico, então o rastro fica preservado. O `enforce_lead_tenant_consistency` continua válido porque o novo pipeline/stage é do mesmo tenant.

Pré-visualização atual (Funil Principal Rizodent):

- Novo Lead: 3 · Conversando: 1 · Relacionamento: 8 · Follow-Up: 13 · Recuperado: 55 · Não compareceu: 12 → **~92 leads**

Se houver leads de Zigomático em outros funis do mesmo tenant nos mesmos estágios, eles também serão movidos.

## 5. Validação pós-migração

Depois da execução, rodo uma contagem por estágio no funil Zigomático para confirmar a distribuição e te mostro o total movido.

## Notas técnicas

- Tudo feito em migration única e idempotente (verifica existência dos estágios antes de criar).
- O `UPDATE` em `crm_leads` é uma operação de dados; será feito dentro da mesma migration (lícito porque vem logo após a criação dos estágios e depende deles).
- Bots/automação/follow-up vinculados aos estágios antigos continuam disparando para os leads que **permaneceram** no Funil Principal. Os leads movidos passarão a depender de automações configuradas no funil Zigomático — hoje ele não tem nenhuma, então **eles ficarão sem follow-up automático até você configurar**. Posso, em um passo seguinte, copiar os follow-ups/automações do Funil Principal para o Zigomático se quiser.
