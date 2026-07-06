## Diagnóstico

Consultei todas as automações do CRM e **não existe nenhuma automação do tipo `before_scheduled` ("Antes de agendamento/tarefa") cadastrada no sistema**, em nenhuma etapa. Só existem 9 automações no total (mais recente de 23/06/2026), todas de outros tipos (`on_enter`, `on_create`, `no_response`, `time_window`).

Ou seja: o motor de automação (`automation-engine`) tem a lógica correta para disparar 2h antes de agendamentos confirmados — mas ele nunca dispara porque **não há regra ativa desse tipo para percorrer**.

Isso indica que o cadastro que você fez na tela **CRM → Automações** não foi persistido. Duas causas prováveis:

1. **Ação (`action_type`) não foi selecionada** antes de clicar "Salvar Automação". Hoje o modal permite salvar sem escolher a ação, e o backend aceita a linha, mas a automação fica inutilizável (ou o insert falha silenciosamente em alguns cenários).
2. Uma **mensagem de erro apareceu rápido** (toast) e foi ignorada — hoje o handler mostra o erro só num toast fugaz, sem log persistente.

## Plano

### 1. Reforçar a validação e o feedback do salvamento
Arquivo: `src/pages/CrmAutomacoes.tsx` (função `handleSaveAutomation`)
- Validar antes do insert que existem: `stage_id`, `trigger_type`, `action_type` e o mínimo esperado no `action_config` (para `before_scheduled`: `before_amount > 0`, `before_unit`, `scheduled_type`, e `template_id`/`bot_id`/`audio_url` conforme a ação).
- Se qualquer campo faltar, mostrar toast de erro claro em vez de silenciar.
- Manter `console.error` com o payload para debug futuro.

### 2. Reabrir o modal em caso de falha
Hoje o modal fecha antes de confirmar o insert em alguns caminhos. Ajustar para só fechar após `savedAutomation` estar preenchido, evitando perder a configuração digitada.

### 3. Verificar/afinar o motor `before_scheduled`
Arquivo: `supabase/functions/automation-engine/index.ts` (linhas 625‑730). A lógica atual já:
- Percorre `crm_automations` com `trigger_type='before_scheduled'` ativas.
- Filtra `crm_appointments` com `status='confirmed'` (conforme regra existente: pendentes/pré-agendados não disparam).
- Confere se o lead está na etapa configurada (`stage_id`).
- Usa janela `[fireAt, scheduledAt + 90s]`.
- Faz claim atômico via `crm_automation_queue (automation_id, appointment_id)` para evitar duplicidade.

Vou **adicionar logs adicionais** no início do bloco `before_scheduled` para deixar rastreável em produção: "0 automações before_scheduled ativas" — assim conseguimos rapidamente diagnosticar o mesmo problema se voltar.

### 4. Passo a passo para você recadastrar (após o deploy)
1. CRM → Automações → escolher a etapa **Agendado** correta (do funil onde os leads confirmados ficam).
2. "Nova automação" → Evento: **Antes de agendamento/tarefa**.
3. Tipo de evento: **Agendamento**. Antecedência: **2 / Horas**.
4. Ação: **Enviar template** (ou bot) e escolher o template de confirmação já aprovado.
5. Salvar. Confirmar que a automação aparece na listagem da etapa.
6. Confirmar um agendamento de teste com horário para daqui a ~2h e observar o disparo (o cron do `automation-engine` roda a cada minuto).

## Detalhes técnicos

- `crm_automations` não exige `action_type NOT NULL`, por isso o cadastro pode ter sido salvo "meio-vazio" antes; a validação de UI resolve isso na origem.
- O motor usa fuso `-03:00` e tolerância de 90s no fim da janela — isso não muda.
- A regra "só dispara para `appointments.status='confirmed'`" é intencional e permanece. Você confirmou que os agendamentos estavam confirmados, então esse filtro não é o bloqueio — o bloqueio é a ausência da regra.

## Fora de escopo
- Não vou mexer no comportamento do gatilho para pré-agendados (regra atual: só confirmados disparam).
- Sem mudanças de schema.
