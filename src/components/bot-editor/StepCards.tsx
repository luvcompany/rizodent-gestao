import { useState } from "react";
import {
  X, Mic, Paperclip, FileText,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const uid = () => `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export interface FlowOutput {
  id: string;
  label: string;
  conditionType: string;
  conditionValue: string | null;
  nextSteps: FlowStep[];
}

export interface FlowStep {
  id: string;
  type: string;
  config: any;
  outputs: FlowOutput[];
}

// ── Reaction Config ──

export const ReactionConfig = ({ config, onChange }: { config: any; onChange: (c: any) => void }) => {
  const WHATSAPP_REACTIONS = ["❤️", "😂", "😮", "😢", "😡", "👍"];
  const selected = config.emoji || "👍";

  return (
    <div className="space-y-2">
      <Label className="text-xs">Reagir à última mensagem recebida</Label>
      <div className="flex items-center gap-2">
        {WHATSAPP_REACTIONS.map(emoji => (
          <button
            key={emoji}
            onClick={() => onChange({ ...config, emoji })}
            className={`text-xl w-9 h-9 rounded-lg flex items-center justify-center transition-all ${
              selected === emoji
                ? "bg-primary/20 ring-2 ring-primary scale-110"
                : "bg-muted/50 hover:bg-muted hover:scale-105"
            }`}
          >
            {emoji}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground">
        Reage automaticamente à última mensagem inbound do lead via WhatsApp API.
      </p>
    </div>
  );
};

// ── Send Message Config ──

export const SendMessageConfig = ({ config, onChange, templates, outputs, onUpdateOutputs }: {
  config: any; onChange: (c: any) => void; templates: any[];
  outputs: FlowOutput[]; onUpdateOutputs: (o: FlowOutput[]) => void;
}) => {
  const buttons = config.buttons || [];
  const [showTemplateModal, setShowTemplateModal] = useState(false);

  const addButton = (type: "action" | "url") => {
    const newBtn = { id: uid(), type, label: type === "action" ? "Botão de ação" : "URL", value: "" };
    const newButtons = [...buttons, newBtn];
    onChange({ ...config, buttons: newButtons });

    if (type === "action") {
      const newOutput: FlowOutput = {
        id: uid(), label: newBtn.label, conditionType: "button_click", conditionValue: newBtn.id, nextSteps: [],
      };
      onUpdateOutputs([...outputs, newOutput]);
    }
  };

  const selectTemplate = (tpl: any) => {
    const tplButtons = Array.isArray(tpl.buttons) ? tpl.buttons : [];
    const newButtons = tplButtons.map((b: any, i: number) => ({
      id: uid(), type: b.type === "URL" ? "url" : "action", label: b.text || `Botão ${i + 1}`, value: b.url || "",
    }));

    onChange({
      ...config,
      message: tpl.body_text || "",
      template_name: tpl.name,
      template_id: tpl.id,
      buttons: newButtons,
      useTemplate: true,
    });

    // Create outputs for action buttons
    const actionOutputs = newButtons
      .filter((b: any) => b.type === "action")
      .map((b: any) => ({
        id: uid(), label: `${b.label} clicado`, conditionType: "button_click", conditionValue: b.id, nextSteps: [],
      }));

    const baseOutputs = outputs.filter(o => o.conditionType !== "button_click");
    onUpdateOutputs([...baseOutputs, ...actionOutputs]);
    setShowTemplateModal(false);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Select value={config.channel || "whatsapp"} onValueChange={v => onChange({ ...config, channel: v })}>
          <SelectTrigger className="h-7 text-xs w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="whatsapp">WhatsApp</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {config.useTemplate && config.template_name ? (
        <div className="bg-primary/5 border border-primary/20 rounded-lg p-2 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-primary flex items-center gap-1">
              <FileText size={10} /> Template: {config.template_name}
            </span>
            <button onClick={() => onChange({ ...config, useTemplate: false, template_name: "", template_id: "" })} className="text-muted-foreground hover:text-destructive">
              <X size={10} />
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground line-clamp-2">{config.message}</p>
        </div>
      ) : (
        <Textarea
          className="text-xs min-h-[60px]"
          value={config.message || ""}
          onChange={e => onChange({ ...config, message: e.target.value })}
          placeholder="Escreva algo ou escolha um modelo..."
        />
      )}

      <div className="flex items-center gap-1 flex-wrap">
        {["{{nome}}", "{{telefone}}", "{{email}}"].map(v => (
          <button
            key={v}
            className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded hover:bg-primary/20 transition-colors"
            onClick={() => onChange({ ...config, message: (config.message || "") + " " + v })}
          >
            {v}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button className="text-muted-foreground hover:text-foreground"><Mic size={14} /></button>
        <button className="text-muted-foreground hover:text-foreground"><Paperclip size={14} /></button>
        <button
          onClick={() => setShowTemplateModal(true)}
          className="text-[10px] text-primary hover:underline flex items-center gap-1"
        >
          <FileText size={10} /> Escolher modelo
        </button>
      </div>

      {buttons.map((btn: any, i: number) => (
        <div key={btn.id} className="flex items-center gap-1 bg-muted/50 rounded px-2 py-1">
          <span className="text-[10px] text-muted-foreground">{btn.type === "action" ? "🔘" : "🔗"}</span>
          <Input
            className="h-6 text-xs flex-1 bg-transparent border-0 p-0"
            value={btn.label}
            onChange={e => {
              const newBtns = [...buttons];
              newBtns[i] = { ...btn, label: e.target.value };
              onChange({ ...config, buttons: newBtns });
            }}
          />
          <button onClick={() => {
            onChange({ ...config, buttons: buttons.filter((_: any, j: number) => j !== i) });
          }} className="text-muted-foreground hover:text-destructive"><X size={10} /></button>
        </div>
      ))}

      <div className="flex items-center gap-2">
        <button onClick={() => addButton("action")} className="text-[10px] text-primary hover:underline">+ Botão de ação</button>
        <button onClick={() => addButton("url")} className="text-[10px] text-primary hover:underline">+ Botão de URL</button>
      </div>

      {/* Template Selection Modal */}
      <Dialog open={showTemplateModal} onOpenChange={setShowTemplateModal}>
        <DialogContent className="max-w-md max-h-[70vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm">Selecionar Template Aprovado</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {templates.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">Nenhum template aprovado encontrado.</p>
            )}
            {templates.map(tpl => (
              <button
                key={tpl.id}
                onClick={() => selectTemplate(tpl)}
                className="w-full text-left p-3 rounded-lg border border-border hover:border-primary hover:bg-primary/5 transition-colors"
              >
                <p className="text-xs font-semibold">{tpl.name}</p>
                <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{tpl.body_text}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[9px] bg-muted px-1.5 py-0.5 rounded">{tpl.category}</span>
                  <span className="text-[9px] bg-muted px-1.5 py-0.5 rounded">{tpl.language}</span>
                </div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ── List Message Config ──

export const ListMessageConfig = ({ config, onChange, outputs, onUpdateOutputs }: {
  config: any; onChange: (c: any) => void;
  outputs: FlowOutput[]; onUpdateOutputs: (o: FlowOutput[]) => void;
}) => {
  const sections = config.sections || [{ title: "", rows: [{ id: "opcao_1", title: "", description: "" }] }];

  const updateSections = (newSections: any[]) => {
    onChange({ ...config, sections: newSections });

    // Rebuild outputs based on all row options
    const optionOutputs: FlowOutput[] = [];
    newSections.forEach((sec: any) => {
      (sec.rows || []).forEach((row: any) => {
        if (row.title) {
          optionOutputs.push({
            id: uid(), label: row.title || row.id, conditionType: "list_reply", conditionValue: row.id, nextSteps: [],
          });
        }
      });
    });
    // Keep "other" and "no_response" outputs
    const otherOut = outputs.find(o => o.conditionType === "other_reply") ||
      { id: uid(), label: "Outra resposta", conditionType: "other_reply", conditionValue: null, nextSteps: [] };
    const noRespOut = outputs.find(o => o.conditionType === "no_response") ||
      { id: uid(), label: "Sem resposta", conditionType: "no_response", conditionValue: null, nextSteps: [] };

    onUpdateOutputs([...optionOutputs, otherOut, noRespOut]);
  };

  const addRow = (sectionIdx: number) => {
    const newSections = [...sections];
    const rowCount = newSections.reduce((acc: number, s: any) => acc + (s.rows?.length || 0), 0);
    newSections[sectionIdx].rows = [
      ...(newSections[sectionIdx].rows || []),
      { id: `opcao_${rowCount + 1}`, title: "", description: "" },
    ];
    updateSections(newSections);
  };

  const addSection = () => {
    updateSections([...sections, { title: "", rows: [{ id: `opcao_${Date.now()}`, title: "", description: "" }] }]);
  };

  const updateRow = (sIdx: number, rIdx: number, field: string, value: string) => {
    const newSections = JSON.parse(JSON.stringify(sections));
    newSections[sIdx].rows[rIdx][field] = value;
    if (field === "title") {
      updateSections(newSections);
    } else {
      onChange({ ...config, sections: newSections });
    }
  };

  const removeRow = (sIdx: number, rIdx: number) => {
    const newSections = JSON.parse(JSON.stringify(sections));
    newSections[sIdx].rows.splice(rIdx, 1);
    if (newSections[sIdx].rows.length === 0) {
      newSections.splice(sIdx, 1);
    }
    updateSections(newSections.length > 0 ? newSections : [{ title: "", rows: [{ id: "opcao_1", title: "", description: "" }] }]);
  };

  return (
    <div className="space-y-2">
      {/* Header area */}
      <div className="bg-sky-50 dark:bg-sky-950/30 rounded-lg p-2 space-y-1.5 border border-sky-200 dark:border-sky-800">
        <Input
          className="h-7 text-xs bg-white/80 dark:bg-background"
          value={config.header || ""}
          onChange={e => onChange({ ...config, header: e.target.value })}
          placeholder="Título da mensagem..."
        />
        <Textarea
          className="text-xs min-h-[40px] bg-white/80 dark:bg-background"
          value={config.body || ""}
          onChange={e => onChange({ ...config, body: e.target.value })}
          placeholder="Mensagem..."
        />
        <Input
          className="h-7 text-xs bg-white/80 dark:bg-background"
          value={config.footer || ""}
          onChange={e => onChange({ ...config, footer: e.target.value })}
          placeholder="Rodapé..."
        />
        <div className="flex items-center gap-2">
          <Input
            className="h-7 text-xs bg-white/80 dark:bg-background flex-1"
            value={config.buttonText || ""}
            onChange={e => onChange({ ...config, buttonText: e.target.value })}
            placeholder="Nome do botão..."
          />
          <span className="text-muted-foreground text-xs">☰</span>
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground italic">
        O cliente pode clicar no botão para visualizar a lista abaixo
      </p>

      {/* Sections area */}
      <div className="bg-sky-50 dark:bg-sky-950/30 rounded-lg p-2 space-y-2 border border-sky-200 dark:border-sky-800">
        {sections.map((sec: any, sIdx: number) => (
          <div key={sIdx} className="space-y-1.5">
            <Input
              className="h-7 text-xs bg-white/80 dark:bg-background font-semibold"
              value={sec.title || ""}
              onChange={e => {
                const ns = JSON.parse(JSON.stringify(sections));
                ns[sIdx].title = e.target.value;
                onChange({ ...config, sections: ns });
              }}
              placeholder="Título da seção..."
            />
            {(sec.rows || []).map((row: any, rIdx: number) => (
              <div key={rIdx} className="flex items-start gap-1 pl-2">
                <div className="flex-1 space-y-1">
                  <Input
                    className="h-6 text-xs bg-white/80 dark:bg-background"
                    value={row.title || ""}
                    onChange={e => updateRow(sIdx, rIdx, "title", e.target.value)}
                    placeholder="Título da opção..."
                  />
                  <Input
                    className="h-6 text-xs bg-white/80 dark:bg-background"
                    value={row.description || ""}
                    onChange={e => updateRow(sIdx, rIdx, "description", e.target.value)}
                    placeholder="Descrição..."
                  />
                </div>
                <button onClick={() => removeRow(sIdx, rIdx)} className="text-muted-foreground hover:text-destructive mt-1">
                  <X size={10} />
                </button>
              </div>
            ))}
            <button onClick={() => addRow(sIdx)} className="text-[10px] text-primary hover:underline pl-2">
              Adicionar opção
            </button>
          </div>
        ))}
        <button onClick={addSection} className="text-[10px] text-primary hover:underline font-semibold">
          + Adicionar seção
        </button>
      </div>

      <p className="text-[9px] text-muted-foreground">
        Para iniciar nova conversa após 24h, use um template aprovado.
      </p>
    </div>
  );
};

// ── Pause Config ──

export const PauseConfig = ({ config, onChange, outputs, onUpdateOutputs }: {
  config: any; onChange: (c: any) => void;
  outputs: FlowOutput[]; onUpdateOutputs: (o: FlowOutput[]) => void;
}) => {
  const conditions = config.conditions || [{ type: "message_received" }];

  const addCondition = () => {
    const types = ["message_received", "timer"];
    const existing = conditions.map((c: any) => c.type);
    const next = types.find((t: string) => !existing.includes(t));
    if (!next) return;
    const newConds = [...conditions, { type: next, hours: 1, minutes: 0, seconds: 0 }];
    onChange({ ...config, conditions: newConds });

    if (next === "message_received" && !outputs.find(o => o.conditionType === "reply")) {
      onUpdateOutputs([...outputs, { id: uid(), label: "Mensagem recebida", conditionType: "reply", conditionValue: null, nextSteps: [] }]);
    }
    if (next === "timer" && !outputs.find(o => o.conditionType === "timeout")) {
      onUpdateOutputs([...outputs, { id: uid(), label: "Cronômetro expirado", conditionType: "timeout", conditionValue: null, nextSteps: [] }]);
    }
  };

  const removeCondition = (idx: number) => {
    const removed = conditions[idx];
    const newConds = conditions.filter((_: any, i: number) => i !== idx);
    onChange({ ...config, conditions: newConds });

    if (removed.type === "message_received") {
      onUpdateOutputs(outputs.filter(o => o.conditionType !== "reply"));
    }
    if (removed.type === "timer") {
      onUpdateOutputs(outputs.filter(o => o.conditionType !== "timeout"));
    }
  };

  return (
    <div className="space-y-2">
      {conditions.map((cond: any, i: number) => (
        <div key={i} className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2">
          <span className="text-xs flex-1">
            {cond.type === "message_received" ? "Até a mensagem recebida" :
              `Cronômetro: ${cond.hours || 0}h ${cond.minutes || 0}min ${cond.seconds || 0}seg`}
          </span>
          {cond.type === "timer" && (
            <div className="flex items-center gap-1">
              <Input className="h-6 w-10 text-xs text-center p-0" type="number" value={cond.hours || 0}
                onChange={e => {
                  const c = [...conditions]; c[i] = { ...cond, hours: +e.target.value };
                  onChange({ ...config, conditions: c });
                }} />
              <span className="text-[10px]">h</span>
              <Input className="h-6 w-10 text-xs text-center p-0" type="number" value={cond.minutes || 0}
                onChange={e => {
                  const c = [...conditions]; c[i] = { ...cond, minutes: +e.target.value };
                  onChange({ ...config, conditions: c });
                }} />
              <span className="text-[10px]">m</span>
            </div>
          )}
          {conditions.length > 1 && (
            <button onClick={() => removeCondition(i)} className="text-muted-foreground hover:text-destructive"><X size={12} /></button>
          )}
        </div>
      ))}
      {conditions.length < 2 && (
        <button onClick={addCondition} className="text-[10px] text-primary hover:underline">+ Adicionar próxima condição</button>
      )}
    </div>
  );
};

// ── Condition Config ──

export const ConditionConfig = ({ config, onChange }: { config: any; onChange: (c: any) => void }) => (
  <div className="space-y-2">
    <div>
      <Label className="text-xs">Campo</Label>
      <Select value={config.field || "tags"} onValueChange={v => onChange({ ...config, field: v })}>
        <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="tags">Tags</SelectItem>
          <SelectItem value="name">Nome</SelectItem>
          <SelectItem value="phone">Telefone</SelectItem>
          <SelectItem value="source">Origem</SelectItem>
          <SelectItem value="stage">Etapa</SelectItem>
        </SelectContent>
      </Select>
    </div>
    <div>
      <Label className="text-xs">Operador</Label>
      <Select value={config.operator || "equals"} onValueChange={v => onChange({ ...config, operator: v })}>
        <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="equals">É igual a</SelectItem>
          <SelectItem value="contains">Contém</SelectItem>
          <SelectItem value="not_empty">Está preenchido</SelectItem>
          <SelectItem value="is_empty">Está vazio</SelectItem>
        </SelectContent>
      </Select>
    </div>
    <div>
      <Label className="text-xs">Valor</Label>
      <Input className="h-8 text-xs mt-1" value={config.value || ""} onChange={e => onChange({ ...config, value: e.target.value })} placeholder="Valor..." />
    </div>
  </div>
);

// ── Action Config ──

export const ActionConfig = ({ config, onChange, pipelines, stages }: { config: any; onChange: (c: any) => void; pipelines: any[]; stages: any[] }) => (
  <div className="space-y-2">
    <div>
      <Label className="text-xs">Tipo de ação</Label>
      <Select value={config.actionType || "move_stage"} onValueChange={v => onChange({ ...config, actionType: v })}>
        <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="move_stage">Mover etapa</SelectItem>
          <SelectItem value="set_field">Definir campo</SelectItem>
          <SelectItem value="add_tag">Adicionar/remover tag</SelectItem>
        </SelectContent>
      </Select>
    </div>
    {config.actionType === "move_stage" && (
      <>
        <Select value={config.pipeline_id || ""} onValueChange={v => onChange({ ...config, pipeline_id: v })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Funil..." /></SelectTrigger>
          <SelectContent>
            {pipelines.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={config.stage_id || ""} onValueChange={v => onChange({ ...config, stage_id: v })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Etapa..." /></SelectTrigger>
          <SelectContent>
            {stages.filter(s => s.pipeline_id === config.pipeline_id).map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </>
    )}
    {config.actionType === "set_field" && (
      <>
        <Input className="h-8 text-xs" value={config.field || ""} onChange={e => onChange({ ...config, field: e.target.value })} placeholder="Campo..." />
        <Input className="h-8 text-xs" value={config.value || ""} onChange={e => onChange({ ...config, value: e.target.value })} placeholder="Valor..." />
      </>
    )}
    {config.actionType === "add_tag" && (
      <>
        <Input className="h-8 text-xs" value={config.tag || ""} onChange={e => onChange({ ...config, tag: e.target.value })} placeholder="Nome da tag..." />
        <Select value={config.tagAction || "add"} onValueChange={v => onChange({ ...config, tagAction: v })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="add">Adicionar</SelectItem>
            <SelectItem value="remove">Remover</SelectItem>
          </SelectContent>
        </Select>
      </>
    )}
  </div>
);
