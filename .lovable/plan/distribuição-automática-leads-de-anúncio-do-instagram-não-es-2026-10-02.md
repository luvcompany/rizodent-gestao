# Distribuição automática: leads de anúncio do Instagram não estão sendo distribuídos

## O que aconteceu
O lead "Vivendo o agora" chegou às 10:27 pelo WhatsApp, vindo de um anúncio do Instagram. Ficou com a Rizodent (administrador) até às 11:13, quando foi passado à mão para a Kelly. No mesmo minuto, o lead "Leonardo Ferreira Santos", vindo do Google, foi distribuído na hora — então o rodízio está ligado e as SDRs estavam disponíveis.

## Causa
O rodízio tem uma regra que deixa de fora todo lead cuja origem começa com "Instagram". Ela foi feita para não distribuir as mensagens diretas do Instagram (Direct / Instagram Lite). Só que, desde a correção das etiquetas de anúncio, os leads que chegam no **WhatsApp** por anúncio do Instagram passaram a ter a origem "anúncio do Instagram" — e a regra começou a barrá-los também.

Hoje há **6 leads de anúncio do Instagram** dos últimos 2 dias parados com o administrador por causa disso.

## O que vou fazer
1. Ajustar a regra para deixar de fora só as mensagens diretas do Instagram, e não os leads de anúncio do Instagram que chegam pelo WhatsApp.
2. Os 6 leads parados entram sozinhos na próxima varredura automática do rodízio (que roda a cada 5 minutos) e vão para as SDRs ativas, seguindo a vez normal.
3. Conferir depois que eles foram distribuídos.

Nada muda nas telas. Os leads do Instagram Direct / Instagram Lite continuam fora do rodízio, como hoje.

## Detalhes técnicos
- Migration: `rodizio_fonte_excluida(p_source)` passa a tratar `instagram_ad` como fonte válida (exclui `instagram%` exceto `instagram_ad`); demais exclusões (kommo, import, dontus_agenda, retroativo) mantidas. Direct do Instagram continua barrado também por `ig_account_uuid IS NOT NULL` em `rodizio_lead_na_fila`.
- `rodizio_processar_novos` (cron a cada 5 min, janela de 2 dias) recolhe os 6 pendentes sem ação manual.
- Verificação: consultar `crm_lead_atribuicoes` e `distribuido_em` dos leads `instagram_ad` recentes.
