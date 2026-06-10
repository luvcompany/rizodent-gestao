## Contexto

O sistema já tem o gatilho `time_window` com modos `once` (data única) e `weekly` (semana fixa). Ele dispara um bot quando o lead manda mensagem dentro da janela. O que falta é o **inverso**: disparar quando o lead manda mensagem **fora** do horário comercial — sem precisar configurar manualmente cada bloco noturno + fim de semana.

A automação existente do bot de fim de semana **continua intocada** — ela é uma `time_window` separada com a sua própria janela e seu próprio dedup. A nova adição só introduz um modo extra.

## Solução

### 1. Novo modo `business_hours_off` no `time_window`
- `action_config` ganha:
  - `bh_days`: dias considerados "úteis" (ex.: `[1,2,3,4,5]` = seg-sex)
  - `bh_start`: início do expediente (ex.: `08:00`)
  - `bh_end`: fim do expediente (ex.: `18:00`)
  - `bot_id`: bot a disparar (igual aos outros modos)
- A janela "aberta" passa a ser: **qualquer momento que NÃO seja dia útil entre `bh_start` e `bh_end`**.
- Cada lead dispara o bot 1×por "ocorrência fora do expediente" (mesma lógica de dedup já existente em `crm_automation_executions`).

### 2. UI no modal de automação (CRM → Funil → ⚙️ etapa → Nova automação)
- No seletor "Modo da janela" adicionar a opção **"Fora do horário comercial"**.
- Quando selecionada, mostrar:
  - Toggle de dias úteis (Dom–Sáb), default seg-sex marcados
  - Início e fim do expediente (default 08:00 / 18:00)
  - Seletor de Bot a disparar
- Resumo textual abaixo: _"Vai disparar quando o lead mandar mensagem fora de Seg-Sex 08:00–18:00 (BR)"_.

### 3. Engine
- `automation-engine` e `whatsapp-webhook` ganham um pequeno helper `evalBusinessHoursOff(cfg)` que devolve `{ isOpen, justClosed }` invertendo a regra do expediente, reaproveitando 100% da infra atual:
  - Cleanup de bots cancelados quando o expediente abre (cron já roda a cada minuto)
  - Reset de `crm_automation_executions` na borda da reabertura (igual ao `weekly`)
- Bots existentes (`weekly`, `once`) **não mudam de comportamento** — o novo ramo só é exercido quando `window_mode === "business_hours_off"`.

### 4. Segurança contra travas
- Validação no UI: bloquear salvar com `bh_start >= bh_end` ou `bh_days` vazio.
- Aviso visual se a etapa já tiver outra `time_window` com `weekly` para o mesmo `bot_id` (para o usuário decidir se quer rodar os dois).
- Mantém o `getCommercialHours` do BR (UTC-3) já usado no engine.

## Detalhes técnicos
- Arquivos:
  - `src/components/automation/AutomationModal.tsx` — novo modo no select + bloco de configuração
  - `supabase/functions/automation-engine/index.ts` — adicionar `evalBusinessHoursOff` ao loop de cleanup
  - `supabase/functions/whatsapp-webhook/index.ts` — adicionar o mesmo helper no match de inbound
- Sem migração de banco — `action_config` é JSONB livre
- Sem alteração em cron jobs ou triggers de DB existentes