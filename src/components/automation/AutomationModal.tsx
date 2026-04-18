import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2, Zap } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandItem, CommandGroup } from "@/components/ui/command";
import { cleanTemplateName } from "@/lib/templateUtils";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

type Stage = { id: string; name: string; color: string };
type Template = { id: string; name: string; status: string };
type BotEntry = { id: string; name: string };

interface AutoFormState {
  stage_id: string;
  trigger_type: string;
  action_type: string;
  action_config: Record<string, unknown>;
  editId: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  autoForm: AutoFormState;
  setAutoForm: React.Dispatch<React.SetStateAction<AutoFormState>>;
  stages: Stage[];
  templates: Template[];
  publishedBots: BotEntry[];
  onSave: () => void;
}

const TRIGGER_DESCRIPTIONS: Record<string, string> = {
  on_create: "Dispara quando um novo lead é criado diretamente nesta etapa.",
  on_enter: "Dispara quando um lead existente é movido para esta etapa.",
  on_create_or_enter: "Dispara tanto na criação quanto na movimentação para esta etapa.",
  no_response: "Dispara quando o lead não responde após um tempo definido.",
  before_scheduled: "Dispara X tempo antes de um agendamento ou tarefa marcada. Ideal para lembretes automáticos.",
  time_window: "Dispara quando o lead enviar uma mensagem dentro de uma janela de data/hora específica. Cada lead recebe a ação apenas uma vez.",
};

function TemplateCombobox({
  templates,
  value,
  onValueChange,
}: {
  templates: Template[];
  value: string;
  onValueChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = templates.find(t => t.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between h-8 text-xs font-normal">
          {selected ? cleanTemplateName(selected.name) : "Selecionar template"}
          <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Pesquisar template..." className="h-8 text-xs" />
          <CommandList>
            <CommandEmpty className="py-3 text-xs text-center">Nenhum template encontrado</CommandEmpty>
            <CommandGroup>
              {templates.map(t => (
                <CommandItem
                  key={t.id}
                  value={t.name}
                  onSelect={() => { onValueChange(t.id); setOpen(false); }}
                  className="text-xs"
                >
                  <Check className={cn("mr-2 h-3 w-3", value === t.id ? "opacity-100" : "opacity-0")} />
                  {cleanTemplateName(t.name)}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

const DAYS_OF_WEEK = [
  { value: "mon", label: "Seg" },
  { value: "tue", label: "Ter" },
  { value: "wed", label: "Qua" },
  { value: "thu", label: "Qui" },
  { value: "fri", label: "Sex" },
  { value: "sat", label: "Sáb" },
  { value: "sun", label: "Dom" },
];

// Reusable single action config renderer
function ActionConfigFields({
  actionType,
  config,
  onChange,
  templates,
  publishedBots,
  stages,
  prefix = "",
}: {
  actionType: string;
  config: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
  templates: Template[];
  publishedBots: BotEntry[];
  stages: Stage[];
  prefix?: string;
}) {
  const key = (k: string) => prefix ? `${prefix}_${k}` : k;

  if (actionType === "send_template") {
    const selectedId = (config[key("template_id")] as string) || "";
    const selectedTemplate = templates.find(t => t.id === selectedId);
    return (
      <div>
        <Label className="text-xs">Template</Label>
        <TemplateCombobox
          templates={templates}
          value={selectedId}
          onValueChange={v => onChange({ [key("template_id")]: v })}
        />
      </div>
    );
  }
  if (actionType === "send_bot") {
    return (
      <div>
        <Label className="text-xs">Bot</Label>
        <Select value={(config[key("bot_id")] as string) || undefined} onValueChange={v => onChange({ [key("bot_id")]: v })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar bot" /></SelectTrigger>
          <SelectContent>
            {publishedBots.length === 0 && <SelectItem value="none" disabled>Nenhum bot publicado</SelectItem>}
            {publishedBots.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    );
  }
  if (actionType === "send_audio") {
    return (
      <div>
        <Label className="text-xs">URL do áudio</Label>
        <Input className="h-8 text-xs" placeholder="https://..." value={(config[key("audio_url")] as string) || ""} onChange={e => onChange({ [key("audio_url")]: e.target.value })} />
      </div>
    );
  }
  if (actionType === "send_file") {
    return (
      <div>
        <Label className="text-xs">URL do arquivo</Label>
        <Input className="h-8 text-xs" placeholder="https://..." value={(config[key("file_url")] as string) || ""} onChange={e => onChange({ [key("file_url")]: e.target.value })} />
      </div>
    );
  }
  if (actionType === "add_tag") {
    return (
      <div>
        <Label className="text-xs">Nome da tag</Label>
        <Input className="h-8 text-xs" placeholder="Ex: interessado" value={(config[key("tag_name")] as string) || ""} onChange={e => onChange({ [key("tag_name")]: e.target.value })} />
      </div>
    );
  }
  if (actionType === "move_stage") {
    return (
      <div>
        <Label className="text-xs">Mover para</Label>
        <Select value={(config[key("target_stage_id")] as string) || undefined} onValueChange={v => onChange({ [key("target_stage_id")]: v })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar etapa" /></SelectTrigger>
          <SelectContent>
            {stages.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    );
  }
  if (actionType === "notify_assignee") {
    return (
      <div>
        <Label className="text-xs">Mensagem da notificação</Label>
        <Input className="h-8 text-xs" placeholder="Ex: Lead precisa de atenção" value={(config[key("notify_message")] as string) || ""} onChange={e => onChange({ [key("notify_message")]: e.target.value })} />
      </div>
    );
  }
  if (actionType === "webhook") {
    return (
      <div>
        <Label className="text-xs">URL do Webhook</Label>
        <Input className="h-8 text-xs" placeholder="https://..." value={(config[key("url")] as string) || ""} onChange={e => onChange({ [key("url")]: e.target.value })} />
      </div>
    );
  }
  return null;
}

function ActionSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="send_template">Enviar template WhatsApp</SelectItem>
        <SelectItem value="send_bot">Enviar Bot</SelectItem>
        <SelectItem value="send_audio">Enviar áudio</SelectItem>
        <SelectItem value="send_file">Enviar arquivo</SelectItem>
        <SelectItem value="add_tag">Criar tag no lead</SelectItem>
        <SelectItem value="move_stage">Mover para etapa</SelectItem>
        <SelectItem value="notify_assignee">Notificar responsável</SelectItem>
        <SelectItem value="webhook">Chamar webhook</SelectItem>
      </SelectContent>
    </Select>
  );
}

// Combo actions sub-component
function ComboActions({
  config,
  setConfig,
  templates,
  publishedBots,
  stages,
}: {
  config: Record<string, unknown>;
  setConfig: (c: Record<string, unknown>) => void;
  templates: Template[];
  publishedBots: BotEntry[];
  stages: Stage[];
}) {
  const actions = (config.combo_actions as Array<{ type: string; config: Record<string, unknown> }>) || [];

  const addAction = () => {
    setConfig({ ...config, combo_actions: [...actions, { type: "send_template", config: {} }] });
  };
  const removeAction = (idx: number) => {
    setConfig({ ...config, combo_actions: actions.filter((_, i) => i !== idx) });
  };
  const updateAction = (idx: number, patch: Partial<{ type: string; config: Record<string, unknown> }>) => {
    const updated = actions.map((a, i) => i === idx ? { ...a, ...patch } : a);
    setConfig({ ...config, combo_actions: updated });
  };

  return (
    <div className="space-y-2">
      {actions.map((action, idx) => (
        <div key={idx} className="p-2 bg-secondary/50 rounded-lg border border-border space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground font-medium">Ação {idx + 1}</span>
            <button onClick={() => removeAction(idx)} className="text-destructive/70 hover:text-destructive"><Trash2 size={12} /></button>
          </div>
          <ActionSelect value={action.type} onChange={v => updateAction(idx, { type: v, config: {} })} />
          <ActionConfigFields
            actionType={action.type}
            config={action.config}
            onChange={patch => updateAction(idx, { config: { ...action.config, ...patch } })}
            templates={templates}
            publishedBots={publishedBots}
            stages={stages}
          />
        </div>
      ))}
      <button onClick={addAction} className="w-full text-xs text-primary bg-primary/10 hover:bg-primary/20 rounded py-1.5 flex items-center justify-center gap-1 transition-colors">
        <Plus size={12} /> Adicionar ação
      </button>
    </div>
  );
}

// Sequence steps sub-component (for appointment confirmed / no-show)
function SequenceSteps({
  config,
  setConfig,
  templates,
  publishedBots,
  stages,
}: {
  config: Record<string, unknown>;
  setConfig: (c: Record<string, unknown>) => void;
  templates: Template[];
  publishedBots: BotEntry[];
  stages: Stage[];
}) {
  const steps = (config.sequence_steps as Array<{ delay_amount: number; delay_unit: string; action_type: string; action_config: Record<string, unknown> }>) || [];

  const addStep = () => {
    setConfig({ ...config, sequence_steps: [...steps, { delay_amount: 1, delay_unit: "hours", action_type: "send_template", action_config: {} }] });
  };
  const removeStep = (idx: number) => {
    setConfig({ ...config, sequence_steps: steps.filter((_, i) => i !== idx) });
  };
  const updateStep = (idx: number, patch: Record<string, unknown>) => {
    const updated = steps.map((s, i) => i === idx ? { ...s, ...patch } : s);
    setConfig({ ...config, sequence_steps: updated });
  };

  return (
    <div className="space-y-2">
      <Label className="text-xs font-semibold">Passos da sequência</Label>
      {steps.map((step, idx) => (
        <div key={idx} className="p-2 bg-secondary/50 rounded-lg border border-border space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground font-medium">Passo {idx + 1}</span>
            <button onClick={() => removeStep(idx)} className="text-destructive/70 hover:text-destructive"><Trash2 size={12} /></button>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-[10px] text-muted-foreground whitespace-nowrap">Após</Label>
            <Input type="number" min={0} className="h-7 text-xs w-16" value={step.delay_amount}
              onChange={e => updateStep(idx, { delay_amount: parseInt(e.target.value) || 0 })} />
            <Select value={step.delay_unit} onValueChange={v => updateStep(idx, { delay_unit: v })}>
              <SelectTrigger className="h-7 text-xs w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="minutes">Min</SelectItem>
                <SelectItem value="hours">Horas</SelectItem>
                <SelectItem value="days">Dias</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <ActionSelect value={step.action_type} onChange={v => updateStep(idx, { action_type: v, action_config: {} })} />
          <ActionConfigFields
            actionType={step.action_type}
            config={step.action_config}
            onChange={patch => updateStep(idx, { action_config: { ...step.action_config, ...patch } })}
            templates={templates}
            publishedBots={publishedBots}
            stages={stages}
          />
        </div>
      ))}
      <button onClick={addStep} className="w-full text-xs text-primary bg-primary/10 hover:bg-primary/20 rounded py-1.5 flex items-center justify-center gap-1 transition-colors">
        <Plus size={12} /> Adicionar passo
      </button>
    </div>
  );
}

// Progressive reengagement layers
function ReengagementLayers({
  config,
  setConfig,
  templates,
  publishedBots,
  stages,
}: {
  config: Record<string, unknown>;
  setConfig: (c: Record<string, unknown>) => void;
  templates: Template[];
  publishedBots: BotEntry[];
  stages: Stage[];
}) {
  const layers = (config.layers as Array<{ delay_amount: number; delay_unit: string; action_type: string; action_config: Record<string, unknown> }>) || [];

  const addLayer = () => {
    setConfig({ ...config, layers: [...layers, { delay_amount: 1, delay_unit: "hours", action_type: "send_template", action_config: {} }] });
  };
  const removeLayer = (idx: number) => {
    setConfig({ ...config, layers: layers.filter((_, i) => i !== idx) });
  };
  const updateLayer = (idx: number, patch: Record<string, unknown>) => {
    const updated = layers.map((l, i) => i === idx ? { ...l, ...patch } : l);
    setConfig({ ...config, layers: updated });
  };

  return (
    <div className="space-y-2 p-3 bg-secondary/50 rounded-lg border border-border">
      <Label className="text-xs font-semibold">Camadas de reengajamento</Label>
      <p className="text-[10px] text-muted-foreground">Cada camada dispara após o tempo sem resposta do lead. Se o lead responder, a sequência é interrompida.</p>
      {layers.map((layer, idx) => (
        <div key={idx} className="p-2 bg-card rounded-lg border border-border space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground font-medium">Camada {idx + 1}</span>
            <button onClick={() => removeLayer(idx)} className="text-destructive/70 hover:text-destructive"><Trash2 size={12} /></button>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-[10px] text-muted-foreground whitespace-nowrap">Após</Label>
            <Input type="number" min={1} className="h-7 text-xs w-16" value={layer.delay_amount}
              onChange={e => updateLayer(idx, { delay_amount: parseInt(e.target.value) || 1 })} />
            <Select value={layer.delay_unit} onValueChange={v => updateLayer(idx, { delay_unit: v })}>
              <SelectTrigger className="h-7 text-xs w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="minutes">Min</SelectItem>
                <SelectItem value="hours">Horas</SelectItem>
                <SelectItem value="days">Dias</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <ActionSelect value={layer.action_type} onChange={v => updateLayer(idx, { action_type: v, action_config: {} })} />
          <ActionConfigFields
            actionType={layer.action_type}
            config={layer.action_config}
            onChange={patch => updateLayer(idx, { action_config: { ...layer.action_config, ...patch } })}
            templates={templates}
            publishedBots={publishedBots}
            stages={stages}
          />
        </div>
      ))}
      <button onClick={addLayer} className="w-full text-xs text-primary bg-primary/10 hover:bg-primary/20 rounded py-1.5 flex items-center justify-center gap-1 transition-colors">
        <Plus size={12} /> Adicionar camada
      </button>
    </div>
  );
}

export default function AutomationModal({ open, onOpenChange, autoForm, setAutoForm, stages, templates, publishedBots, onSave }: Props) {
  const updateConfig = (patch: Record<string, unknown>) => {
    setAutoForm(p => ({ ...p, action_config: { ...p.action_config, ...patch } }));
  };
  const setConfig = (c: Record<string, unknown>) => {
    setAutoForm(p => ({ ...p, action_config: c }));
  };

  const isCombo = autoForm.action_type === "combo";
  const isSequenceTrigger = false; // simplified - no more sequence triggers in main list
  const isReengagement = false; // simplified

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap size={16} className="text-primary" />
            Configurar Automação
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {/* EVENTO */}
          <div>
            <Label>Evento</Label>
            <Select value={autoForm.trigger_type} onValueChange={v => setAutoForm(p => ({ ...p, trigger_type: v, action_config: {} }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="on_create">Quando criado nesta etapa</SelectItem>
                <SelectItem value="on_enter">Quando movido para esta etapa</SelectItem>
                <SelectItem value="on_create_or_enter">Quando movido ou criado nesta etapa</SelectItem>
                <SelectItem value="no_response">Leads sem resposta há X tempo</SelectItem>
                <SelectItem value="before_scheduled">Antes de agendamento/tarefa</SelectItem>
                <SelectItem value="time_window">Janela de data/hora (mensagem recebida)</SelectItem>
              </SelectContent>
            </Select>
            {TRIGGER_DESCRIPTIONS[autoForm.trigger_type] && (
              <p className="text-[10px] text-muted-foreground mt-1">{TRIGGER_DESCRIPTIONS[autoForm.trigger_type]}</p>
            )}
          </div>

          {/* TRIGGER-SPECIFIC CONFIGS */}
          {autoForm.trigger_type === "no_response" && (
            <div className="space-y-2 p-3 bg-secondary/50 rounded-lg border border-border">
              <Label className="text-xs">Lead sem resposta há</Label>
              <div className="flex items-center gap-2">
                <Input type="number" min={1} value={(autoForm.action_config.no_response_amount as number) || 1}
                  onChange={e => updateConfig({ no_response_amount: parseInt(e.target.value) || 1 })} className="h-8 text-xs w-20" />
                <Select value={(autoForm.action_config.no_response_unit as string) || "hours"} onValueChange={v => updateConfig({ no_response_unit: v })}>
                  <SelectTrigger className="h-8 text-xs w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minutes">Minutos</SelectItem>
                    <SelectItem value="hours">Horas</SelectItem>
                    <SelectItem value="days">Dias</SelectItem>
                    <SelectItem value="weeks">Semanas</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {autoForm.trigger_type === "before_scheduled" && (
            <div className="space-y-2 p-3 bg-secondary/50 rounded-lg border border-border">
              <Label className="text-xs">Tipo de evento</Label>
              <Select value={(autoForm.action_config.scheduled_type as string) || "appointment"} onValueChange={v => updateConfig({ scheduled_type: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="appointment">Agendamento</SelectItem>
                  <SelectItem value="task">Tarefa</SelectItem>
                  <SelectItem value="both">Ambos</SelectItem>
                </SelectContent>
              </Select>
              <Label className="text-xs">Disparar com antecedência de</Label>
              <div className="flex items-center gap-2">
                <Input type="number" min={0} value={(autoForm.action_config.before_amount as number) ?? 1}
                  onChange={e => updateConfig({ before_amount: parseInt(e.target.value) || 0 })} className="h-8 text-xs w-16" />
                <Select value={(autoForm.action_config.before_unit as string) || "hours"} onValueChange={v => updateConfig({ before_unit: v })}>
                  <SelectTrigger className="h-8 text-xs w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="seconds">Segundos</SelectItem>
                    <SelectItem value="minutes">Minutos</SelectItem>
                    <SelectItem value="hours">Horas</SelectItem>
                    <SelectItem value="days">Dias</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="text-[10px] text-muted-foreground">
                A ação será disparada automaticamente antes da data/hora marcada. Ex: 1 hora antes do agendamento, 1 dia antes da tarefa.
              </p>
            </div>
          )}

          {autoForm.trigger_type === "time_window" && (() => {
            const mode = (autoForm.action_config.window_mode as string) || "once";
            const WEEK_DAYS = [
              { value: "0", label: "Domingo" },
              { value: "1", label: "Segunda" },
              { value: "2", label: "Terça" },
              { value: "3", label: "Quarta" },
              { value: "4", label: "Quinta" },
              { value: "5", label: "Sexta" },
              { value: "6", label: "Sábado" },
            ];
            return (
              <div className="space-y-2 p-3 bg-secondary/50 rounded-lg border border-border">
                <Label className="text-xs">Tipo de janela</Label>
                <Select
                  value={mode}
                  onValueChange={v => updateConfig({ window_mode: v })}
                >
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="once">Janela única (data/hora específica)</SelectItem>
                    <SelectItem value="weekly">Janela recorrente semanal (dia/hora)</SelectItem>
                  </SelectContent>
                </Select>

                {mode === "once" ? (
                  <>
                    <Label className="text-xs">Início da janela</Label>
                    <Input
                      type="datetime-local"
                      className="h-8 text-xs"
                      value={(autoForm.action_config.window_start as string) || ""}
                      onChange={e => updateConfig({ window_start: e.target.value })}
                    />
                    <Label className="text-xs">Fim da janela</Label>
                    <Input
                      type="datetime-local"
                      className="h-8 text-xs"
                      value={(autoForm.action_config.window_end as string) || ""}
                      onChange={e => updateConfig({ window_end: e.target.value })}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Todo lead desta etapa que enviar uma mensagem entre essas duas datas/horas receberá a ação. Cada lead recebe apenas uma vez.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs">Dia inicial</Label>
                        <Select
                          value={(autoForm.action_config.start_day as string) ?? "6"}
                          onValueChange={v => updateConfig({ start_day: v })}
                        >
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {WEEK_DAYS.map(d => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">Hora inicial</Label>
                        <Input
                          type="time"
                          className="h-8 text-xs"
                          value={(autoForm.action_config.start_time as string) || "08:00"}
                          onChange={e => updateConfig({ start_time: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs">Dia final</Label>
                        <Select
                          value={(autoForm.action_config.end_day as string) ?? "1"}
                          onValueChange={v => updateConfig({ end_day: v })}
                        >
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {WEEK_DAYS.map(d => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">Hora final</Label>
                        <Input
                          type="time"
                          className="h-8 text-xs"
                          value={(autoForm.action_config.end_time as string) || "08:00"}
                          onChange={e => updateConfig({ end_time: e.target.value })}
                        />
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      A janela abre e fecha toda semana nos dias/horas escolhidos (fuso de Brasília). Cada lead recebe a ação 1x por ocorrência semanal. Quando a janela fechar, bots ativos serão automaticamente cancelados.
                    </p>
                  </>
                )}
              </div>
            );
          })()}

          {/* AÇÃO - only show for non-sequence triggers (sequences have their own actions) */}
          {!isSequenceTrigger && !isReengagement && (
            <>
              <div>
                <Label>Ação</Label>
                <Select value={autoForm.action_type} onValueChange={v => setAutoForm(p => ({ ...p, action_type: v, action_config: { ...p.action_config } }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="send_template">Enviar template WhatsApp</SelectItem>
                    <SelectItem value="send_bot">Enviar Bot</SelectItem>
                    <SelectItem value="send_audio">Enviar áudio</SelectItem>
                    <SelectItem value="send_file">Enviar arquivo</SelectItem>
                    <SelectItem value="add_tag">Criar tag no lead</SelectItem>
                    <SelectItem value="move_stage">Mover para etapa</SelectItem>
                    <SelectItem value="notify_assignee">Notificar responsável</SelectItem>
                    <SelectItem value="webhook">Chamar webhook</SelectItem>
                    <SelectItem value="combo">Combinação de ações</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {isCombo ? (
                <ComboActions config={autoForm.action_config} setConfig={setConfig} templates={templates} publishedBots={publishedBots} stages={stages} />
              ) : (
                <ActionConfigFields
                  actionType={autoForm.action_type}
                  config={autoForm.action_config}
                  onChange={updateConfig}
                  templates={templates}
                  publishedBots={publishedBots}
                  stages={stages}
                />
              )}
            </>
          )}

          {/* Checkbox: send to all existing */}
          <div className="flex items-center gap-3">
            <Checkbox
              id="send-to-all-modal"
              checked={!!(autoForm.action_config.send_to_all_existing)}
              onCheckedChange={v => updateConfig({ send_to_all_existing: !!v })}
            />
            <label htmlFor="send-to-all-modal" className="text-sm text-foreground cursor-pointer">
              Enviar para todos os leads que já estão nesta etapa
            </label>
          </div>

          <Button className="w-full" onClick={onSave}>Salvar Automação</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
