import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  ArrowLeft, Save, Play, Plus, X, MessageSquare, Pause, Zap, GitBranch,
  CheckCircle2, Bot, StopCircle, Mic, Paperclip, Link2, ChevronDown,
  Heart, MessageCircle, Send, Smartphone, Shuffle, Square, RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

// ── Types ──

interface FlowStep {
  id: string;
  type: string;
  config: any;
  outputs: FlowOutput[];
}

interface FlowOutput {
  id: string;
  label: string;
  conditionType: string;
  conditionValue: string | null;
  nextSteps: FlowStep[];
}

interface Bot {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
}

interface Trigger {
  id: string;
  type: string;
  label: string;
}

const STEP_TYPES = [
  { type: "send_message", label: "Enviar mensagem", icon: MessageSquare, emoji: "🤖", category: "main" },
  { type: "reaction", label: "Reação", icon: Heart, emoji: "❤️", category: "main" },
  { type: "comment", label: "Comentário", icon: MessageCircle, emoji: "💬", category: "main" },
  { type: "internal_message", label: "Enviar mensagem interna", icon: Send, emoji: "💭", category: "main" },
  { type: "list_message", label: "List Message (WhatsApp)", icon: Smartphone, emoji: "📱", category: "main" },
  { type: "pause", label: "Pausar", icon: Pause, emoji: "⏸️", category: "main" },
  { type: "condition", label: "Condição", icon: GitBranch, emoji: "🟣", category: "logic" },
  { type: "validation", label: "Validação", icon: CheckCircle2, emoji: "✔️", category: "logic" },
  { type: "action", label: "Ação", icon: Zap, emoji: "✅", category: "action" },
  { type: "start_bot", label: "Iniciar outro bot", icon: Bot, emoji: "▶️", category: "action" },
  { type: "round_robin", label: "Round Robin", icon: Shuffle, emoji: "🔄", category: "action" },
  { type: "stop_bot", label: "Parar bot", icon: StopCircle, emoji: "⏹️", category: "action" },
];

const TRIGGER_OPTIONS = [
  { type: "stage_enter", label: "Quando lead entra na etapa" },
  { type: "lead_created", label: "Quando lead é criado" },
  { type: "tag_added", label: "Quando tag é adicionada" },
  { type: "message_received", label: "Quando mensagem é recebida" },
  { type: "no_response", label: "Quando lead não responde (timeout)" },
];

const uid = () => `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const CrmBotEditor = () => {
  const { id: botId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [bot, setBot] = useState<Bot | null>(null);
  const [botName, setBotName] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [saving, setSaving] = useState(false);
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [showTriggerMenu, setShowTriggerMenu] = useState(false);

  // The flow is a tree starting from a root
  const [rootOutputs, setRootOutputs] = useState<FlowOutput[]>([
    { id: uid(), label: "Início", conditionType: "start", conditionValue: null, nextSteps: [] },
  ]);

  const [pipelines, setPipelines] = useState<any[]>([]);
  const [stages, setStages] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [bots, setBots] = useState<any[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!botId) return;
    loadBot();
    loadExtras();
  }, [botId]);

  const loadBot = async () => {
    const { data: b } = await supabase.from("bots").select("*").eq("id", botId).single();
    if (!b) { toast.error("Bot não encontrado"); navigate("/crm/bots"); return; }
    setBot(b);
    setBotName(b.name);

    // Load nodes and rebuild tree
    const { data: nodes } = await supabase.from("bot_nodes").select("*").eq("bot_id", botId).order("created_at");
    if (!nodes || nodes.length === 0) return;

    const nodeIds = nodes.map((n: any) => n.id);
    const { data: outs } = await supabase.from("bot_node_outputs").select("*").in("node_id", nodeIds);

    // Rebuild tree from flat structure
    const tree = rebuildTree(nodes, outs || []);
    setRootOutputs(tree);
  };

  const rebuildTree = (nodes: any[], outs: any[]): FlowOutput[] => {
    const startNode = nodes.find((n: any) => n.is_start_node);
    if (!startNode) {
      return [{ id: uid(), label: "Início", conditionType: "start", conditionValue: null, nextSteps: [] }];
    }

    const buildStep = (nodeId: string, visited: Set<string>): FlowStep | null => {
      if (visited.has(nodeId)) return null;
      visited.add(nodeId);
      const node = nodes.find((n: any) => n.id === nodeId);
      if (!node) return null;

      const nodeOuts = outs.filter((o: any) => o.node_id === nodeId);
      const stepOutputs: FlowOutput[] = nodeOuts.map((o: any) => ({
        id: o.id,
        label: o.label,
        conditionType: o.condition_type,
        conditionValue: o.condition_value,
        nextSteps: o.next_node_id ? (() => {
          const child = buildStep(o.next_node_id, visited);
          return child ? [child] : [];
        })() : [],
      }));

      // If no outputs defined but node type should have them, create defaults
      if (stepOutputs.length === 0) {
        stepOutputs.push({ id: uid(), label: "Próximo", conditionType: "default", conditionValue: null, nextSteps: [] });
      }

      return {
        id: node.id,
        type: mapNodeType(node.type),
        config: node.config || {},
        outputs: stepOutputs,
      };
    };

    const firstStep = buildStep(startNode.id, new Set());
    return [{
      id: uid(),
      label: "Início",
      conditionType: "start",
      conditionValue: null,
      nextSteps: firstStep ? [firstStep] : [],
    }];
  };

  const mapNodeType = (dbType: string): string => {
    const map: Record<string, string> = {
      message_text: "send_message",
      message_template: "send_message",
      message_audio: "send_message",
      wait: "pause",
      condition: "condition",
      action_move_stage: "action",
      action_set_field: "action",
      action_add_tag: "action",
      action_end_bot: "stop_bot",
    };
    return map[dbType] || dbType;
  };

  const loadExtras = async () => {
    const [{ data: p }, { data: s }, { data: t }, { data: b }] = await Promise.all([
      supabase.from("crm_pipelines").select("*"),
      supabase.from("crm_stages").select("*").order("position"),
      supabase.from("crm_whatsapp_templates").select("*").eq("status", "APPROVED"),
      supabase.from("bots").select("id, name").neq("id", botId || ""),
    ]);
    setPipelines(p || []);
    setStages(s || []);
    setTemplates(t || []);
    setBots(b || []);
  };

  // ── Tree operations ──

  const addStepToOutput = (outputId: string, stepType: string) => {
    const newStep: FlowStep = {
      id: uid(),
      type: stepType,
      config: getDefaultConfig(stepType),
      outputs: getDefaultOutputs(stepType),
    };

    setRootOutputs(prev => addStepInTree(prev, outputId, newStep));
  };

  const addStepInTree = (outs: FlowOutput[], targetOutputId: string, newStep: FlowStep): FlowOutput[] => {
    return outs.map(o => {
      if (o.id === targetOutputId) {
        return { ...o, nextSteps: [...o.nextSteps, newStep] };
      }
      return {
        ...o,
        nextSteps: o.nextSteps.map(step => ({
          ...step,
          outputs: addStepInTree(step.outputs, targetOutputId, newStep),
        })),
      };
    });
  };

  const removeStep = (stepId: string) => {
    setRootOutputs(prev => removeStepInTree(prev, stepId));
  };

  const removeStepInTree = (outs: FlowOutput[]): FlowOutput[] => {
    return outs.map(o => ({
      ...o,
      nextSteps: o.nextSteps
        .filter(step => step.id !== stepId)
        .map(step => ({
          ...step,
          outputs: removeStepInTree(step.outputs),
        })),
    }));
  };

  const updateStepConfig = (stepId: string, config: any) => {
    setRootOutputs(prev => updateConfigInTree(prev, stepId, config));
  };

  const updateConfigInTree = (outs: FlowOutput[], stepId: string, config: any): FlowOutput[] => {
    return outs.map(o => ({
      ...o,
      nextSteps: o.nextSteps.map(step => {
        if (step.id === stepId) return { ...step, config };
        return { ...step, outputs: updateConfigInTree(step.outputs, stepId, config) };
      }),
    }));
  };

  const updateStepOutputs = (stepId: string, newOutputs: FlowOutput[]) => {
    setRootOutputs(prev => updateOutputsInTree(prev, stepId, newOutputs));
  };

  const updateOutputsInTree = (outs: FlowOutput[], stepId: string, newOutputs: FlowOutput[]): FlowOutput[] => {
    return outs.map(o => ({
      ...o,
      nextSteps: o.nextSteps.map(step => {
        if (step.id === stepId) return { ...step, outputs: newOutputs };
        return { ...step, outputs: updateOutputsInTree(step.outputs, stepId, newOutputs) };
      }),
    }));
  };

  const getDefaultConfig = (type: string): any => {
    switch (type) {
      case "send_message": return { message: "", channel: "whatsapp", buttons: [] };
      case "pause": return { conditions: [{ type: "message_received", hours: 0, minutes: 0, seconds: 0 }] };
      case "condition": return { field: "tags", operator: "equals", value: "" };
      case "action": return { actionType: "move_stage", pipeline_id: "", stage_id: "", field: "", value: "", tag: "", tagAction: "add" };
      case "stop_bot": return {};
      case "start_bot": return { bot_id: "" };
      case "reaction": return { emoji: "👍" };
      case "comment": return { text: "" };
      case "internal_message": return { message: "" };
      case "list_message": return { title: "", sections: [] };
      case "validation": return { field: "", rule: "not_empty" };
      case "round_robin": return { users: [] };
      default: return {};
    }
  };

  const getDefaultOutputs = (type: string): FlowOutput[] => {
    switch (type) {
      case "pause":
        return [
          { id: uid(), label: "Mensagem recebida", conditionType: "reply", conditionValue: null, nextSteps: [] },
          { id: uid(), label: "Cronômetro expirado", conditionType: "timeout", conditionValue: null, nextSteps: [] },
        ];
      case "condition":
        return [
          { id: uid(), label: "Sim", conditionType: "match", conditionValue: null, nextSteps: [] },
          { id: uid(), label: "Não", conditionType: "no_match", conditionValue: null, nextSteps: [] },
        ];
      case "send_message":
        return [
          { id: uid(), label: "Próximo", conditionType: "default", conditionValue: null, nextSteps: [] },
          { id: uid(), label: "Falha ao enviar", conditionType: "failure", conditionValue: null, nextSteps: [] },
        ];
      case "stop_bot":
        return [];
      default:
        return [{ id: uid(), label: "Próximo", conditionType: "default", conditionValue: null, nextSteps: [] }];
    }
  };

  // ── Save (flatten tree → DB) ──

  const saveBot = async () => {
    if (!botId) return;
    setSaving(true);
    try {
      await supabase.from("bots").update({ name: botName }).eq("id", botId);

      // Delete existing
      const { data: existingNodes } = await supabase.from("bot_nodes").select("id").eq("bot_id", botId);
      if (existingNodes?.length) {
        const existingIds = existingNodes.map((n: any) => n.id);
        await supabase.from("bot_node_outputs").delete().in("node_id", existingIds);
        await supabase.from("bot_nodes").delete().eq("bot_id", botId);
      }

      // Flatten tree to nodes + outputs
      const flatNodes: any[] = [];
      const flatOutputs: any[] = [];
      const idMap: Record<string, string> = {};
      let stepIndex = 0;

      const flattenStep = (step: FlowStep, isFirst: boolean) => {
        const realId = crypto.randomUUID();
        idMap[step.id] = realId;
        const dbType = mapToDbType(step.type, step.config);
        flatNodes.push({
          id: realId,
          bot_id: botId,
          type: dbType,
          config: step.config,
          position_x: stepIndex * 300,
          position_y: 0,
          is_start_node: isFirst,
        });
        stepIndex++;

        step.outputs.forEach(o => {
          const outId = crypto.randomUUID();
          const nextId = o.nextSteps.length > 0 ? o.nextSteps[0] : null;
          flatOutputs.push({
            id: outId,
            node_id: realId,
            label: o.label,
            condition_type: o.conditionType,
            condition_value: o.conditionValue,
            next_node_id: nextId ? "__pending__" + o.nextSteps[0].id : null,
          });
          o.nextSteps.forEach(child => flattenStep(child, false));
        });
      };

      rootOutputs.forEach(o => {
        o.nextSteps.forEach((step, i) => flattenStep(step, i === 0 && rootOutputs.indexOf(o) === 0));
      });

      // Resolve pending references
      flatOutputs.forEach(o => {
        if (o.next_node_id && o.next_node_id.startsWith("__pending__")) {
          const tempId = o.next_node_id.replace("__pending__", "");
          o.next_node_id = idMap[tempId] || null;
        }
      });

      if (flatNodes.length > 0) {
        const { error: nodesErr } = await supabase.from("bot_nodes").insert(flatNodes);
        if (nodesErr) throw nodesErr;
      }

      if (flatOutputs.length > 0) {
        const { error: outErr } = await supabase.from("bot_node_outputs").insert(flatOutputs);
        if (outErr) throw outErr;
      }

      toast.success("Bot salvo com sucesso!");
    } catch (err: any) {
      toast.error("Erro ao salvar: " + err.message);
    }
    setSaving(false);
  };

  const mapToDbType = (type: string, config: any): string => {
    switch (type) {
      case "send_message": return "message_text";
      case "pause": return "wait";
      case "condition": return "condition";
      case "action":
        if (config?.actionType === "move_stage") return "action_move_stage";
        if (config?.actionType === "set_field") return "action_set_field";
        if (config?.actionType === "add_tag") return "action_add_tag";
        return "action_move_stage";
      case "stop_bot": return "action_end_bot";
      default: return type;
    }
  };

  // ── Step count helper ──
  const countSteps = (outs: FlowOutput[]): number => {
    let count = 0;
    outs.forEach(o => {
      o.nextSteps.forEach(step => {
        count++;
        count += countSteps(step.outputs);
      });
    });
    return count;
  };

  if (!bot) return <div className="flex items-center justify-center h-64 text-muted-foreground">Carregando...</div>;

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] -m-6 bg-muted/30">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-card shrink-0 z-10">
        <Button variant="ghost" size="sm" onClick={() => navigate("/crm/bots")}>
          <ArrowLeft size={16} />
        </Button>
        {editingName ? (
          <Input
            value={botName}
            onChange={e => setBotName(e.target.value)}
            onBlur={() => setEditingName(false)}
            onKeyDown={e => e.key === "Enter" && setEditingName(false)}
            className="h-8 w-64"
            autoFocus
          />
        ) : (
          <button onClick={() => setEditingName(true)} className="text-sm font-semibold text-foreground hover:text-primary transition-colors">
            {botName}
          </button>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <div className="flex items-center gap-2 mr-3">
            <span className="text-xs text-muted-foreground">Ativo</span>
            <Switch checked={bot.active ?? true} onCheckedChange={async (v) => {
              await supabase.from("bots").update({ active: v }).eq("id", bot.id);
              setBot(prev => prev ? { ...prev, active: v } : prev);
            }} />
          </div>
          <Button size="sm" onClick={saveBot} disabled={saving} className="gap-1">
            <Save size={14} /> {saving ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </div>

      {/* Main area */}
      <div ref={scrollRef} className="flex-1 overflow-auto p-6">
        <div className="flex items-start gap-6 min-w-max">
          {/* Left: Triggers panel */}
          <div className="w-72 shrink-0">
            <div className="bg-card rounded-xl border border-border shadow-sm p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-foreground">Gatilhos</h3>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Defina quando este bot deve ser iniciado automaticamente.
              </p>
              {triggers.map(t => (
                <div key={t.id} className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2 mb-2 text-xs">
                  <span>{t.label}</span>
                  <button onClick={() => setTriggers(prev => prev.filter(tr => tr.id !== t.id))} className="text-muted-foreground hover:text-destructive">
                    <X size={12} />
                  </button>
                </div>
              ))}
              <div className="relative">
                <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => setShowTriggerMenu(!showTriggerMenu)}>
                  <Plus size={12} className="mr-1" /> Gatilho
                </Button>
                {showTriggerMenu && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-card rounded-lg border border-border shadow-lg z-20 py-1">
                    {TRIGGER_OPTIONS.map(opt => (
                      <button
                        key={opt.type}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-muted/80 transition-colors"
                        onClick={() => {
                          setTriggers(prev => [...prev, { id: uid(), type: opt.type, label: opt.label }]);
                          setShowTriggerMenu(false);
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Flow chain */}
          <div className="flex items-start">
            {/* Start card */}
            <div className="shrink-0">
              <StartCard />
            </div>

            {/* Flow outputs from root */}
            <div className="flex flex-col gap-4">
              {rootOutputs.map(output => (
                <FlowBranch
                  key={output.id}
                  output={output}
                  stepNumber={1}
                  onAddStep={addStepToOutput}
                  onRemoveStep={removeStep}
                  onUpdateConfig={updateStepConfig}
                  onUpdateOutputs={updateStepOutputs}
                  pipelines={pipelines}
                  stages={stages}
                  templates={templates}
                  allBots={bots}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Start Card ──

const StartCard = () => (
  <div className="flex items-center">
    <div className="bg-emerald-500 text-white rounded-xl px-5 py-3 flex items-center gap-2 shadow-sm border border-emerald-400">
      <Play size={16} fill="white" />
      <span className="text-sm font-semibold">Iniciar robô</span>
    </div>
  </div>
);

// ── Connector line ──

const ConnectorLine = () => (
  <div className="flex items-center shrink-0 mx-0">
    <div className="w-10 h-px bg-border" />
    <div className="w-2 h-2 rounded-full border-2 border-border bg-card -ml-1" />
  </div>
);

// ── Add Step Button ──

const AddStepButton = ({ outputId, onAdd }: { outputId: string; onAdd: (outputId: string, type: string) => void }) => {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative flex items-center" ref={menuRef}>
      <ConnectorLine />
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-dashed border-border bg-card text-xs text-muted-foreground hover:border-primary hover:text-primary transition-colors whitespace-nowrap shadow-sm"
      >
        <Plus size={12} /> Adicionar próximo passo
      </button>

      {open && (
        <div className="absolute left-12 top-full mt-1 bg-card rounded-xl border border-border shadow-xl z-30 py-2 w-64 max-h-80 overflow-y-auto">
          <div className="px-3 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Mensagens</div>
          {STEP_TYPES.filter(s => s.category === "main").map(st => (
            <button
              key={st.type}
              className="w-full text-left px-3 py-2 text-sm hover:bg-muted/80 transition-colors flex items-center gap-2"
              onClick={() => { onAdd(outputId, st.type); setOpen(false); }}
            >
              <span>{st.emoji}</span> {st.label}
            </button>
          ))}
          <div className="border-t border-border my-1" />
          <div className="px-3 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Lógica</div>
          {STEP_TYPES.filter(s => s.category === "logic").map(st => (
            <button
              key={st.type}
              className="w-full text-left px-3 py-2 text-sm hover:bg-muted/80 transition-colors flex items-center gap-2"
              onClick={() => { onAdd(outputId, st.type); setOpen(false); }}
            >
              <span>{st.emoji}</span> {st.label}
            </button>
          ))}
          <div className="border-t border-border my-1" />
          <div className="px-3 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Ações</div>
          {STEP_TYPES.filter(s => s.category === "action").map(st => (
            <button
              key={st.type}
              className="w-full text-left px-3 py-2 text-sm hover:bg-muted/80 transition-colors flex items-center gap-2"
              onClick={() => { onAdd(outputId, st.type); setOpen(false); }}
            >
              <span>{st.emoji}</span> {st.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Flow Branch (recursive) ──

interface FlowBranchProps {
  output: FlowOutput;
  stepNumber: number;
  onAddStep: (outputId: string, type: string) => void;
  onRemoveStep: (stepId: string) => void;
  onUpdateConfig: (stepId: string, config: any) => void;
  onUpdateOutputs: (stepId: string, outputs: FlowOutput[]) => void;
  pipelines: any[];
  stages: any[];
  templates: any[];
  allBots: any[];
  branchLabel?: string;
}

const FlowBranch = ({
  output, stepNumber, onAddStep, onRemoveStep, onUpdateConfig, onUpdateOutputs,
  pipelines, stages, templates, allBots, branchLabel,
}: FlowBranchProps) => {
  if (output.nextSteps.length === 0) {
    return (
      <div className="flex items-center">
        {branchLabel && (
          <>
            <ConnectorLine />
            <span className="text-[10px] text-muted-foreground bg-muted/50 px-2 py-0.5 rounded whitespace-nowrap mr-1">{branchLabel}</span>
          </>
        )}
        <AddStepButton outputId={output.id} onAdd={onAddStep} />
      </div>
    );
  }

  return (
    <>
      {output.nextSteps.map((step, idx) => {
        const currentNum = stepNumber + idx;
        const hasMultipleOutputs = step.outputs.length > 1;

        return (
          <div key={step.id} className="flex items-start">
            {/* Connector from previous */}
            {branchLabel ? (
              <>
                <ConnectorLine />
                <span className="text-[10px] text-muted-foreground bg-muted/50 px-2 py-0.5 rounded whitespace-nowrap mr-1 self-center">{branchLabel}</span>
                <ConnectorLine />
              </>
            ) : (
              <ConnectorLine />
            )}

            {/* Step card */}
            <div className="flex flex-col shrink-0">
              <StepCard
                step={step}
                number={currentNum}
                onRemove={() => onRemoveStep(step.id)}
                onUpdateConfig={(cfg) => onUpdateConfig(step.id, cfg)}
                onUpdateOutputs={(outs) => onUpdateOutputs(step.id, outs)}
                pipelines={pipelines}
                stages={stages}
                templates={templates}
                allBots={allBots}
              />
            </div>

            {/* Outputs */}
            {hasMultipleOutputs ? (
              <div className="flex flex-col gap-3 self-center">
                {step.outputs.map((o, oIdx) => (
                  <FlowBranch
                    key={o.id}
                    output={o}
                    stepNumber={currentNum + 1}
                    onAddStep={onAddStep}
                    onRemoveStep={onRemoveStep}
                    onUpdateConfig={onUpdateConfig}
                    onUpdateOutputs={onUpdateOutputs}
                    pipelines={pipelines}
                    stages={stages}
                    templates={templates}
                    allBots={allBots}
                    branchLabel={o.label}
                  />
                ))}
              </div>
            ) : step.outputs.length === 1 ? (
              <FlowBranch
                output={step.outputs[0]}
                stepNumber={currentNum + 1}
                onAddStep={onAddStep}
                onRemoveStep={onRemoveStep}
                onUpdateConfig={onUpdateConfig}
                onUpdateOutputs={onUpdateOutputs}
                pipelines={pipelines}
                stages={stages}
                templates={templates}
                allBots={allBots}
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
};

// ── Step Card ──

interface StepCardProps {
  step: FlowStep;
  number: number;
  onRemove: () => void;
  onUpdateConfig: (config: any) => void;
  onUpdateOutputs: (outputs: FlowOutput[]) => void;
  pipelines: any[];
  stages: any[];
  templates: any[];
  allBots: any[];
}

const StepCard = ({ step, number, onRemove, onUpdateConfig, onUpdateOutputs, pipelines, stages, templates, allBots }: StepCardProps) => {
  const stepInfo = STEP_TYPES.find(s => s.type === step.type);
  const config = step.config || {};

  const headerColors: Record<string, string> = {
    send_message: "bg-blue-500",
    pause: "bg-amber-500",
    condition: "bg-purple-500",
    action: "bg-emerald-500",
    stop_bot: "bg-red-500",
    start_bot: "bg-indigo-500",
    reaction: "bg-pink-500",
    comment: "bg-sky-500",
    internal_message: "bg-teal-500",
    list_message: "bg-cyan-500",
    validation: "bg-orange-500",
    round_robin: "bg-violet-500",
  };

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm w-80 overflow-hidden">
      {/* Header */}
      <div className={`${headerColors[step.type] || "bg-muted"} px-3 py-2 flex items-center justify-between`}>
        <div className="flex items-center gap-2 text-white">
          <span className="text-xs font-bold bg-white/20 rounded-full w-5 h-5 flex items-center justify-center">{number}</span>
          <span className="text-xs font-semibold">{stepInfo?.label || step.type}</span>
        </div>
        <button onClick={onRemove} className="text-white/70 hover:text-white">
          <X size={14} />
        </button>
      </div>

      {/* Body - inline config */}
      <div className="p-3 space-y-2">
        {step.type === "send_message" && (
          <SendMessageConfig config={config} onChange={onUpdateConfig} templates={templates} outputs={step.outputs} onUpdateOutputs={onUpdateOutputs} />
        )}
        {step.type === "pause" && (
          <PauseConfig config={config} onChange={onUpdateConfig} outputs={step.outputs} onUpdateOutputs={onUpdateOutputs} />
        )}
        {step.type === "condition" && (
          <ConditionConfig config={config} onChange={onUpdateConfig} />
        )}
        {step.type === "action" && (
          <ActionConfig config={config} onChange={onUpdateConfig} pipelines={pipelines} stages={stages} />
        )}
        {step.type === "stop_bot" && (
          <p className="text-xs text-muted-foreground">O bot será encerrado neste ponto.</p>
        )}
        {step.type === "start_bot" && (
          <div>
            <Label className="text-xs">Bot a iniciar</Label>
            <Select value={config.bot_id || ""} onValueChange={v => onUpdateConfig({ ...config, bot_id: v })}>
              <SelectTrigger className="h-8 text-xs mt-1"><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                {allBots.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        {step.type === "reaction" && (
          <div>
            <Label className="text-xs">Emoji</Label>
            <Input className="h-8 text-xs mt-1" value={config.emoji || ""} onChange={e => onUpdateConfig({ ...config, emoji: e.target.value })} placeholder="👍" />
          </div>
        )}
        {step.type === "comment" && (
          <div>
            <Label className="text-xs">Comentário</Label>
            <Textarea className="text-xs min-h-[60px] mt-1" value={config.text || ""} onChange={e => onUpdateConfig({ ...config, text: e.target.value })} placeholder="Escreva um comentário..." />
          </div>
        )}
        {step.type === "internal_message" && (
          <div>
            <Label className="text-xs">Mensagem interna</Label>
            <Textarea className="text-xs min-h-[60px] mt-1" value={config.message || ""} onChange={e => onUpdateConfig({ ...config, message: e.target.value })} placeholder="Escreva uma mensagem..." />
          </div>
        )}
        {step.type === "validation" && (
          <div className="space-y-2">
            <div>
              <Label className="text-xs">Campo</Label>
              <Input className="h-8 text-xs mt-1" value={config.field || ""} onChange={e => onUpdateConfig({ ...config, field: e.target.value })} placeholder="email, telefone..." />
            </div>
            <div>
              <Label className="text-xs">Regra</Label>
              <Select value={config.rule || "not_empty"} onValueChange={v => onUpdateConfig({ ...config, rule: v })}>
                <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="not_empty">Não está vazio</SelectItem>
                  <SelectItem value="is_email">É um email válido</SelectItem>
                  <SelectItem value="is_phone">É um telefone válido</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Inline Configs ──

const SendMessageConfig = ({ config, onChange, templates, outputs, onUpdateOutputs }: {
  config: any; onChange: (c: any) => void; templates: any[];
  outputs: FlowOutput[]; onUpdateOutputs: (o: FlowOutput[]) => void;
}) => {
  const buttons = config.buttons || [];

  const addButton = (type: "action" | "url") => {
    const newBtn = { id: uid(), type, label: type === "action" ? "Botão de ação" : "URL", value: "" };
    const newButtons = [...buttons, newBtn];
    onChange({ ...config, buttons: newButtons });

    // Add output for action buttons
    if (type === "action") {
      const newOutput: FlowOutput = {
        id: uid(), label: newBtn.label, conditionType: "button_click", conditionValue: newBtn.id, nextSteps: [],
      };
      onUpdateOutputs([...outputs, newOutput]);
    }
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
      <Textarea
        className="text-xs min-h-[60px]"
        value={config.message || ""}
        onChange={e => onChange({ ...config, message: e.target.value })}
        placeholder="Escreva algo ou escolha um modelo..."
      />
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
    </div>
  );
};

const PauseConfig = ({ config, onChange, outputs, onUpdateOutputs }: {
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

    // Ensure matching output exists
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

    // Remove matching output
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

const ConditionConfig = ({ config, onChange }: { config: any; onChange: (c: any) => void }) => (
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

const ActionConfig = ({ config, onChange, pipelines, stages }: { config: any; onChange: (c: any) => void; pipelines: any[]; stages: any[] }) => (
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

export default CrmBotEditor;
