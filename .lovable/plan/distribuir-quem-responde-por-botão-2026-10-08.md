# Distribuir quem responde por botão

## Causa
A distribuição ignora respostas por botão. Os 104 leads que responderam ao disparo clicando em "Ainda tenho interesse" ou "Já resolvi" ficaram com a RizoDent.

## O que vou fazer
1. Passar a distribuir também quem responde por botão, seja qual for o botão. As outras regras continuam iguais: lead que já é de uma SDR continua com ela, e a resposta da pesquisa de satisfação não distribui.
2. Distribuir agora os leads da RizoDent que responderam por botão hoje, revezando entre Bia e Kelly como o rodízio faz.
3. Conferir que sobra só o que deve ficar com a RizoDent: leads do closer, do pós-venda e os Desqualificados antigos.

## Detalhes técnicos
- Migration: recriar `rodizio_on_mensagem` sem a exclusão de `NEW.type IN ('button','interactive')`, mantendo `rodizio_lead_na_fila`, o filtro da pesquisa e o tratamento de erro. Manter os GRANTs EXECUTE e não tocar em `trg_normalize_lead_phone`.
- Dados: chamar `rodizio_processar_lead(lead_id, 'mensagem recebida em lead do administrador (botão)')` para cada lead do gestor com conversa aberta e última mensagem recebida do tipo button nas últimas 24h.
