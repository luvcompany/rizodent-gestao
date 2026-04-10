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
  lead_created_date: "Selecione um intervalo de datas para disparar a ação em leads criados nesse período.",
  no_response: "Dispara quando o lead não responde após um tempo definido.",
  progressive_reengagement: "Crie múltiplas camadas de tentativa com tempos crescentes. Se o lead responder, a sequência para.",
  lead_stale: "Dispara quando o lead fica parado sem nenhuma movimentação ou mensagem por N dias.",
  time_window: "Define uma janela de horário e dias da semana. Fora dela, as automações ficam em fila.",
  keyword_response: "Dispara quando o lead responde com palavras ou frases específicas que você definir.",
  after_appointment_confirmed: "Inicia uma sequência automática após a confirmação de um agendamento (ex: lembretes e follow-up).",
  no_show: "Dispara quando o paciente não comparece à consulta. Permite sequência de reagendamento.",
  cold_lead_return: "Dispara quando um lead frio ou arquivado envia qualquer mensagem nova.",
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
  const isSequenceTrigger = ["after_appointment_confirmed", "no_show"].includes(autoForm.trigger_type);
  const isReengagement = autoForm.trigger_type === "progressive_reengagement";

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
                <SelectItem value="on_create_or_enter">Quando movido para ou criado nesta etapa</SelectItem>
                <SelectItem value="lead_created_date">Leads de determinada data</SelectItem>
                <SelectItem value="no_response">Leads sem resposta há X tempo</SelectItem>
                <SelectItem value="progressive_reengagement">Reengajamento progressivo</SelectItem>
                <SelectItem value="lead_stale">Lead parado há X dias</SelectItem>
                <SelectItem value="time_window">Gatilho por janela de horário</SelectItem>
                <SelectItem value="keyword_response">Palavra-chave na resposta</SelectItem>
                <SelectItem value="after_appointment_confirmed">Após agendamento confirmado</SelectItem>
                <SelectItem value="no_show">Lead não compareceu (no-show)</SelectItem>
                <SelectItem value="cold_lead_return">Retorno de lead frio</SelectItem>
              </SelectContent>
            </Select>
            {TRIGGER_DESCRIPTIONS[autoForm.trigger_type] && (
              <p className="text-[10px] text-muted-foreground mt-1">{TRIGGER_DESCRIPTIONS[autoForm.trigger_type]}</p>
            )}
          </div>

          {/* TRIGGER-SPECIFIC CONFIGS */}
          {autoForm.trigger_type === "lead_created_date" && (
            <div className="space-y-2 p-3 bg-secondary/50 rounded-lg border border-border">
              <Label className="text-xs">Data de criação do lead</Label>
              <div className="flex gap-2">
                <div className="flex-1">
                  <Label className="text-[10px] text-muted-foreground">De</Label>
                  <Input type="date" value={(autoForm.action_config.date_from as string) || ""} onChange={e => updateConfig({ date_from: e.target.value })} className="h-8 text-xs" />
                </div>
                <div className="flex-1">
                  <Label className="text-[10px] text-muted-foreground">Até</Label>
                  <Input type="date" value={(autoForm.action_config.date_to as string) || ""} onChange={e => updateConfig({ date_to: e.target.value })} className="h-8 text-xs" />
                </div>
              </div>
            </div>
          )}

          {autoForm.trigger_type === "no_response" && (
            <div className="space-y-2 p-3 bg-secondary/50 rounded-lg border border-border">
              <Label className="text-xs">Lead sem resposta há</Label>
              <div className="flex items-center gap-2">
                <Input type="number" min={1} value={(autoForm.action_config.no_response_amount as number) || 1}
                  onChange={e => updateConfig({ no_response_amount: parseInt(e.target.value) || 1 })} className="h-8 text-xs w-20" />
                <Select value={(autoForm.action_config.no_response_unit as string) || "hours"} onValueChange={v => updateConfig({ no_response_unit: v })}>
                  <SelectTrigger className="h-8 text-xs w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hours">Horas</SelectItem>
                    <SelectItem value="days">Dias</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {isReengagement && (
            <ReengagementLayers config={autoForm.action_config} setConfig={setConfig} templates={templates} publishedBots={publishedBots} stages={stages} />
          )}

          {autoForm.trigger_type === "lead_stale" && (
            <div className="space-y-2 p-3 bg-secondary/50 rounded-lg border border-border">
              <Label className="text-xs">Lead sem movimentação há</Label>
              <div className="flex items-center gap-2">
                <Input type="number" min={1} value={(autoForm.action_config.stale_days as number) || 7}
                  onChange={e => updateConfig({ stale_days: parseInt(e.target.value) || 1 })} className="h-8 text-xs w-20" />
                <span className="text-xs text-muted-foreground">dias</span>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Checkbox id="stale-move" checked={!!(autoForm.action_config.stale_auto_move)}
                  onCheckedChange={v => updateConfig({ stale_auto_move: !!v })} />
                <label htmlFor="stale-move" className="text-xs text-foreground cursor-pointer">Mover lead automaticamente para outra etapa</label>
              </div>
              {autoForm.action_config.stale_auto_move && (
                <Select value={(autoForm.action_config.stale_target_stage_id as string) || ""} onValueChange={v => updateConfig({ stale_target_stage_id: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar etapa destino" /></SelectTrigger>
                  <SelectContent>
                    {stages.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              <p className="text-[10px] text-muted-foreground">Dispara quando o lead não teve nenhuma mudança de etapa ou mensagem no período.</p>
            </div>
          )}

          {autoForm.trigger_type === "time_window" && (
            <div className="space-y-2 p-3 bg-secondary/50 rounded-lg border border-border">
              <Label className="text-xs">Janela de envio</Label>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <Label className="text-[10px] text-muted-foreground">Hora início</Label>
                  <Input type="time" value={(autoForm.action_config.window_start as string) || "08:00"} onChange={e => updateConfig({ window_start: e.target.value })} className="h-8 text-xs" />
                </div>
                <div className="flex-1">
                  <Label className="text-[10px] text-muted-foreground">Hora fim</Label>
                  <Input type="time" value={(autoForm.action_config.window_end as string) || "18:00"} onChange={e => updateConfig({ window_end: e.target.value })} className="h-8 text-xs" />
                </div>
              </div>
              <Label className="text-[10px] text-muted-foreground">Dias da semana</Label>
              <div className="flex flex-wrap gap-1">
                {DAYS_OF_WEEK.map(d => {
                  const selected = ((autoForm.action_config.window_days as string[]) || ["mon", "tue", "wed", "thu", "fri"]).includes(d.value);
                  return (
                    <button
                      key={d.value}
                      onClick={() => {
                        const current = (autoForm.action_config.window_days as string[]) || ["mon", "tue", "wed", "thu", "fri"];
                        const updated = selected ? current.filter(x => x !== d.value) : [...current, d.value];
                        updateConfig({ window_days: updated });
                      }}
                      className={`px-2 py-1 rounded text-[10px] font-medium border transition-colors ${selected ? "bg-primary text-primary-foreground border-primary" : "bg-secondary text-muted-foreground border-border"}`}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted-foreground">Fora dessa janela, as automações ficam em fila e disparam quando o horário permitido chegar.</p>
            </div>
          )}

          {autoForm.trigger_type === "keyword_response" && (
            <div className="space-y-2 p-3 bg-secondary/50 rounded-lg border border-border">
              <Label className="text-xs">Palavras-chave (uma por linha)</Label>
              <Textarea
                className="text-xs min-h-[80px]"
                placeholder={"quanto custa\nquero agendar\nnão tenho interesse"}
                value={(autoForm.action_config.keywords as string) || ""}
                onChange={e => updateConfig({ keywords: e.target.value })}
              />
              <div className="flex items-center gap-2">
                <Checkbox id="kw-exact" checked={!!(autoForm.action_config.keyword_exact_match)}
                  onCheckedChange={v => updateConfig({ keyword_exact_match: !!v })} />
                <label htmlFor="kw-exact" className="text-[10px] text-foreground cursor-pointer">Correspondência exata (não buscar dentro da frase)</label>
              </div>
              <p className="text-[10px] text-muted-foreground">A automação dispara quando o lead responde com uma dessas palavras/frases.</p>
            </div>
          )}

          {autoForm.trigger_type === "after_appointment_confirmed" && (
            <div className="space-y-2 p-3 bg-secondary/50 rounded-lg border border-border">
              <p className="text-[10px] text-muted-foreground">Configure a sequência que será disparada após a confirmação do agendamento. Ex: confirmação imediata → lembrete 24h antes → lembrete 2h antes → follow-up pós-consulta.</p>
              <SequenceSteps config={autoForm.action_config} setConfig={setConfig} templates={templates} publishedBots={publishedBots} stages={stages} />
            </div>
          )}

          {autoForm.trigger_type === "no_show" && (
            <div className="space-y-2 p-3 bg-secondary/50 rounded-lg border border-border">
              <Label className="text-xs">Janela de resposta para reagendamento</Label>
              <div className="flex items-center gap-2">
                <Input type="number" min={1} value={(autoForm.action_config.response_window_hours as number) || 24}
                  onChange={e => updateConfig({ response_window_hours: parseInt(e.target.value) || 1 })} className="h-8 text-xs w-20" />
                <span className="text-xs text-muted-foreground">horas</span>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Checkbox id="noshow-move" checked={!!(autoForm.action_config.noshow_auto_move)}
                  onCheckedChange={v => updateConfig({ noshow_auto_move: !!v })} />
                <label htmlFor="noshow-move" className="text-xs text-foreground cursor-pointer">Mover para etapa de no-show se não responder</label>
              </div>
              {autoForm.action_config.noshow_auto_move && (
                <Select value={(autoForm.action_config.noshow_target_stage_id as string) || ""} onValueChange={v => updateConfig({ noshow_target_stage_id: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Etapa de no-show" /></SelectTrigger>
                  <SelectContent>
                    {stages.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              <p className="text-[10px] text-muted-foreground">Configure a sequência de reagendamento abaixo:</p>
              <SequenceSteps config={autoForm.action_config} setConfig={setConfig} templates={templates} publishedBots={publishedBots} stages={stages} />
            </div>
          )}

          {autoForm.trigger_type === "cold_lead_return" && (
            <div className="space-y-2 p-3 bg-secondary/50 rounded-lg border border-border">
              <p className="text-[10px] text-muted-foreground">Quando um lead arquivado ou em etapa fria enviar qualquer mensagem, a automação dispara alerta e pode mover o lead para uma etapa ativa.</p>
              <div className="flex items-center gap-2">
                <Checkbox id="cold-move" checked={!!(autoForm.action_config.cold_auto_move)}
                  onCheckedChange={v => updateConfig({ cold_auto_move: !!v })} />
                <label htmlFor="cold-move" className="text-xs text-foreground cursor-pointer">Mover automaticamente para etapa ativa</label>
              </div>
              {autoForm.action_config.cold_auto_move && (
                <Select value={(autoForm.action_config.cold_target_stage_id as string) || ""} onValueChange={v => updateConfig({ cold_target_stage_id: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar etapa destino" /></SelectTrigger>
                  <SelectContent>
                    {stages.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              <div className="flex items-center gap-2 pt-1">
                <Checkbox id="cold-notify" checked={autoForm.action_config.cold_notify !== false}
                  onCheckedChange={v => updateConfig({ cold_notify: !!v })} />
                <label htmlFor="cold-notify" className="text-xs text-foreground cursor-pointer">Notificar responsável</label>
              </div>
            </div>
          )}

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
