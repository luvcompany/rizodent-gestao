import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  ArrowLeft, Save, Plus, X, MessageSquare, Pause, Zap, GitBranch,
  CheckCircle2, Bot, StopCircle, Heart, MessageCircle, Send, Smartphone,
  Shuffle, ZoomIn, ZoomOut, Maximize2, Settings, MoreVertical, Play,
  Tag, ArrowRightLeft, Timer, Clock, Webhook, Code2, Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  FlowStep, FlowOutput,
  ReactionConfig, SendMessageConfig, ListMessageConfig,
  PauseConfig, ConditionConfig, ActionConfig,
} from "@/components/bot-editor/StepCards";

// ── Types ──

interface BotData {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
}

interface Trigger {
  id: string;
  type: string;
  label: string;
  config?: { pipeline_id?: string; stage_id?: string };
}

const STEP_TYPES = [
  { type: "send_message", label: "Enviar mensagem", icon: MessageSquare, color: "text-rose-500", bg: "bg-rose-50 dark:bg-rose-950/30", category: "mensagem" },
  { type: "send_message_template", label: "Enviar modelo de mensagem", icon: MessageSquare, color: "text-rose-500", bg: "bg-rose-50 dark:bg-rose-950/30", category: "mensagem" },
  { type: "list_message", label: "Enviar menu", icon: Smartphone, color: "text-rose-500", bg: "bg-rose-50 dark:bg-rose-950/30", category: "mensagem" },
  { type: "reaction", label: "Reação", icon: Heart, color: "text-rose-500", bg: "bg-rose-50 dark:bg-rose-950/30", category: "mensagem" },
  { type: "comment", label: "Comentário interno", icon: MessageCircle, color: "text-rose-500", bg: "bg-rose-50 dark:bg-rose-950/30", category: "mensagem" },

  { type: "action", label: "Adicionar/remover etiquetas", icon: Tag, color: "text-cyan-500", bg: "bg-cyan-50 dark:bg-cyan-950/30", category: "contato", defaultConfig: { actionType: "add_tag" } },

  { type: "action_transfer", label: "Transferir atendimento", icon: ArrowRightLeft, color: "text-amber-500", bg: "bg-amber-50 dark:bg-amber-950/30", category: "atendimento" },
  { type: "stop_bot", label: "Concluir atendimento", icon: CheckCircle2, color: "text-amber-500", bg: "bg-amber-50 dark:bg-amber-950/30", category: "atendimento" },

  { type: "action_move", label: "Mover card", icon: Zap, color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-950/30", category: "crm", defaultConfig: { actionType: "move_stage" } },
  { type: "action_field", label: "Alterar campos do card", icon: Zap, color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-950/30", category: "crm", defaultConfig: { actionType: "set_field" } },

  { type: "pause", label: "Aguardar mensagens do contato", icon: Timer, color: "text-violet-500", bg: "bg-violet-50 dark:bg-violet-950/30", category: "tempo" },
  { type: "pause_timer", label: "Esperar alguns segundos", icon: Clock, color: "text-violet-500", bg: "bg-violet-50 dark:bg-violet-950/30", category: "tempo" },

  { type: "condition", label: "Enviar condicional", icon: GitBranch, color: "text-violet-600", bg: "bg-violet-50 dark:bg-violet-950/30", category: "fluxo" },
  { type: "start_bot", label: "Direcionar para outro chatbot", icon: Bot, color: "text-violet-600", bg: "bg-violet-50 dark:bg-violet-950/30", category: "fluxo" },

  { type: "round_robin", label: "Round Robin", icon: Shuffle, color: "text-gray-500", bg: "bg-gray-50 dark:bg-gray-950/30", category: "avancado" },
];

const ACTION_CATEGORIES = [
  { key: "mensagem", label: "MENSAGEM" },
  { key: "contato", label: "CONTATO" },
  { key: "atendimento", label: "ATENDIMENTO" },
  { key: "crm", label: "CRM" },
  { key: "tempo", label: "TEMPO" },
  { key: "fluxo", label: "FLUXO" },
  { key: "avancado", label: "AVANÇADO" },
];

const TRIGGER_OPTIONS = [
  { type: "stage_enter", label: "Quando lead é movido para esta etapa", needsStage: true },
  { type: "lead_created", label: "Quando lead é criado nesta etapa", needsStage: true },
  { type: "tag_added", label: "Quando tag é adicionada", needsStage: false },
  { type: "message_received", label: "Quando mensagem é recebida", needsStage: false },
  { type: "no_response", label: "Quando lead não responde (timeout)", needsStage: false },
];

const uid = () => `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const CrmBotEditor = () => {
  const { id: botId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [bot, setBot] = useState<BotData | null>(null);
  const [botName, setBotName] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [saving, setSaving] = useState(false);
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [showTriggerMenu, setShowTriggerMenu] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [activeOutputId, setActiveOutputId] = useState<string | null>(null);

  const [rootOutputs, setRootOutputs] = useState<FlowOutput[]>([
    { id: uid(), label: "Início", conditionType: "start", conditionValue: null, nextSteps: [] },
  ]);

  const [pipelines, setPipelines] = useState<any[]>([]);
  const [stages, setStages] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [bots, setBots] = useState<any[]>([]);

  // Pan & Zoom
  const canvasRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 60, y: 60 });
  const [zoom, setZoom] = useState(1);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // Editing step
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [showGeneralSettings, setShowGeneralSettings] = useState(false);
  const [generalSettings, setGeneralSettings] = useState({
    responseDelayEnabled: false,
    responseDelaySeconds: 5,
    inactivityTimeoutEnabled: false,
    inactivityTimeoutMinutes: 30,
  });

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

    const { data: nodes } = await supabase.from("bot_nodes").select("*").eq("bot_id", botId).order("created_at");
    if (!nodes || nodes.length === 0) return;

    const nodeIds = nodes.map((n: any) => n.id);
    const { data: outs } = await supabase.from("bot_node_outputs").select("*").in("node_id", nodeIds);
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
        id: o.id, label: o.label, conditionType: o.condition_type, conditionValue: o.condition_value,
        nextSteps: o.next_node_id ? (() => { const child = buildStep(o.next_node_id, visited); return child ? [child] : []; })() : [],
      }));
      if (stepOutputs.length === 0) {
        stepOutputs.push({ id: uid(), label: "Próximo", conditionType: "default", conditionValue: null, nextSteps: [] });
      }
      return { id: node.id, type: mapNodeType(node.type), config: node.config || {}, outputs: stepOutputs };
    };
    const firstStep = buildStep(startNode.id, new Set());
    return [{ id: uid(), label: "Início", conditionType: "start", conditionValue: null, nextSteps: firstStep ? [firstStep] : [] }];
  };

  const mapNodeType = (dbType: string): string => {
    const map: Record<string, string> = {
      message_text: "send_message", message_template: "send_message", message_audio: "send_message",
      wait: "pause", condition: "condition",
      action_move_stage: "action_move", action_set_field: "action_field", action_add_tag: "action",
      action_end_bot: "stop_bot", set_field: "action_field", move_stage: "action_move",
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
    setPipelines(p || []); setStages(s || []); setTemplates(t || []); setBots(b || []);
  };

  // ── Tree ops ──

  const addStepToOutput = (outputId: string, stepType: string) => {
    const stepDef = STEP_TYPES.find(s => s.type === stepType);
    const config = (stepDef as any)?.defaultConfig || getDefaultConfig(stepType);
    const outputs = getDefaultOutputs(stepType);
    const newStep: FlowStep = { id: uid(), type: stepType, config, outputs };
    setRootOutputs(prev => addStepInTree(prev, outputId, newStep));
    setActionsOpen(false);
    setActiveOutputId(null);
  };

  const addStepInTree = (outs: FlowOutput[], targetOutputId: string, newStep: FlowStep): FlowOutput[] => {
    return outs.map(o => {
      if (o.id === targetOutputId) return { ...o, nextSteps: [...o.nextSteps, newStep] };
      return { ...o, nextSteps: o.nextSteps.map(step => ({ ...step, outputs: addStepInTree(step.outputs, targetOutputId, newStep) })) };
    });
  };

  const removeStep = (targetId: string) => {
    const removeInTree = (outs: FlowOutput[]): FlowOutput[] => {
      return outs.map(o => ({
        ...o, nextSteps: o.nextSteps.filter(step => step.id !== targetId).map(step => ({ ...step, outputs: removeInTree(step.outputs) })),
      }));
    };
    setRootOutputs(prev => removeInTree(prev));
    if (editingStepId === targetId) setEditingStepId(null);
  };

  const updateStepConfig = (stepId: string, config: any) => {
    setRootOutputs(prev => updateConfigInTree(prev, stepId, config));
  };

  const updateConfigInTree = (outs: FlowOutput[], stepId: string, config: any): FlowOutput[] => {
    return outs.map(o => ({
      ...o, nextSteps: o.nextSteps.map(step => {
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
      ...o, nextSteps: o.nextSteps.map(step => {
        if (step.id === stepId) return { ...step, outputs: newOutputs };
        return { ...step, outputs: updateOutputsInTree(step.outputs, stepId, newOutputs) };
      }),
    }));
  };

  const getDefaultConfig = (type: string): any => {
    switch (type) {
      case "send_message": case "send_message_template": return { message: "", channel: "whatsapp", buttons: [] };
      case "pause": return { conditions: [{ type: "message_received", hours: 0, minutes: 0, seconds: 0 }] };
      case "pause_timer": return { conditions: [{ type: "timer", hours: 0, minutes: 5, seconds: 0 }] };
      case "condition": return { field: "tags", operator: "equals", value: "" };
      case "action": return { actionType: "add_tag", tag: "", tagAction: "add" };
      case "action_move": return { actionType: "move_stage", pipeline_id: "", stage_id: "" };
      case "action_field": return { actionType: "set_field", field: "", value: "" };
      case "action_transfer": return { actionType: "transfer", team: "" };
      case "stop_bot": return {};
      case "start_bot": return { bot_id: "" };
      case "reaction": return { emoji: "👍" };
      case "comment": return { text: "" };
      case "list_message": return { header: "", body: "", footer: "", buttonText: "Ver opções", sections: [{ title: "", rows: [{ id: "opcao_1", title: "", description: "" }] }] };
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
      case "pause_timer":
        return [{ id: uid(), label: "Tempo expirado", conditionType: "timeout", conditionValue: null, nextSteps: [] }];
      case "condition":
        return [
          { id: uid(), label: "Sim", conditionType: "match", conditionValue: null, nextSteps: [] },
          { id: uid(), label: "Não", conditionType: "no_match", conditionValue: null, nextSteps: [] },
        ];
      case "send_message": case "send_message_template":
        return [{ id: uid(), label: "Próximo", conditionType: "default", conditionValue: null, nextSteps: [] }];
      case "list_message":
        return [
          { id: uid(), label: "Outra resposta", conditionType: "other_reply", conditionValue: null, nextSteps: [] },
          { id: uid(), label: "Sem resposta", conditionType: "no_response", conditionValue: null, nextSteps: [] },
        ];
      case "stop_bot": return [];
      default:
        return [{ id: uid(), label: "Próximo", conditionType: "default", conditionValue: null, nextSteps: [] }];
    }
  };

  // ── Save ──

  const saveBot = async () => {
    if (!botId) return;
    setSaving(true);
    try {
      await supabase.from("bots").update({ name: botName }).eq("id", botId);
      const { data: existingNodes } = await supabase.from("bot_nodes").select("id").eq("bot_id", botId);
      if (existingNodes?.length) {
        const existingIds = existingNodes.map((n: any) => n.id);
        await supabase.from("bot_node_outputs").delete().in("node_id", existingIds);
        await supabase.from("bot_nodes").delete().eq("bot_id", botId);
      }
      const flatNodes: any[] = [];
      const flatOutputs: any[] = [];
      const idMap: Record<string, string> = {};
      let stepIndex = 0;

      const flattenStep = (step: FlowStep, isFirst: boolean) => {
        const realId = crypto.randomUUID();
        idMap[step.id] = realId;
        const dbType = mapToDbType(step.type, step.config);
        flatNodes.push({ id: realId, bot_id: botId, type: dbType, config: step.config, position_x: stepIndex * 300, position_y: 0, is_start_node: isFirst });
        stepIndex++;
        step.outputs.forEach(o => {
          const outId = crypto.randomUUID();
          const nextId = o.nextSteps.length > 0 ? o.nextSteps[0] : null;
          flatOutputs.push({ id: outId, node_id: realId, label: o.label, condition_type: o.conditionType, condition_value: o.conditionValue, next_node_id: nextId ? "__pending__" + o.nextSteps[0].id : null });
          o.nextSteps.forEach(child => flattenStep(child, false));
        });
      };

      rootOutputs.forEach(o => {
        o.nextSteps.forEach((step, i) => flattenStep(step, i === 0 && rootOutputs.indexOf(o) === 0));
      });

      flatOutputs.forEach(o => {
        if (o.next_node_id?.startsWith("__pending__")) {
          o.next_node_id = idMap[o.next_node_id.replace("__pending__", "")] || null;
        }
      });

      if (flatNodes.length > 0) await supabase.from("bot_nodes").insert(flatNodes);
      if (flatOutputs.length > 0) await supabase.from("bot_node_outputs").insert(flatOutputs);
      toast.success("Bot salvo com sucesso!");
    } catch (err: any) {
      toast.error("Erro ao salvar: " + err.message);
    }
    setSaving(false);
  };

  const mapToDbType = (type: string, config: any): string => {
    switch (type) {
      case "send_message": return config?.useTemplate ? "message_template" : "message_text";
      case "send_message_template": return "message_template";
      case "pause": case "pause_timer": return "wait";
      case "condition": return "condition";
      case "action": return "action_add_tag";
      case "action_move": return "action_move_stage";
      case "action_field": return "action_set_field";
      case "action_transfer": return "action_move_stage";
      case "stop_bot": return "action_end_bot";
      default: return type;
    }
  };

  // ── Pan & Zoom ──

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.target !== canvasRef.current) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    isPanningRef.current = true;
    panStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  }, [pan]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanningRef.current) return;
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    setPan({ x: panStartRef.current.panX + dx, y: panStartRef.current.panY + dy });
  }, []);

  const handlePointerUp = useCallback(() => {
    isPanningRef.current = false;
  }, []);

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.05 : 0.05;
    setZoom(prev => Math.min(2, Math.max(0.3, prev + delta)));
  }, []);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  const zoomIn = () => setZoom(prev => Math.min(2, prev + 0.1));
  const zoomOut = () => setZoom(prev => Math.max(0.3, prev - 0.1));
  const zoomFit = () => { setZoom(1); setPan({ x: 60, y: 60 }); };

  const getStagesForPipeline = (pipelineId: string) => stages.filter(s => s.pipeline_id === pipelineId);

  const updateTriggerConfig = (triggerId: string, config: Partial<Trigger["config"]>) => {
    setTriggers(prev => prev.map(t => t.id === triggerId ? { ...t, config: { ...t.config, ...config } } : t));
  };

  // Open actions panel for a specific output
  const openActionsForOutput = (outputId: string) => {
    setActiveOutputId(outputId);
    setActionsOpen(true);
  };

  // Find step in tree
  const findStep = (outs: FlowOutput[], stepId: string): FlowStep | null => {
    for (const o of outs) {
      for (const s of o.nextSteps) {
        if (s.id === stepId) return s;
        const found = findStep(s.outputs, stepId);
        if (found) return found;
      }
    }
    return null;
  };

  const editingStep = editingStepId ? findStep(rootOutputs, editingStepId) : null;

  if (!bot) return <div className="flex items-center justify-center h-64 text-muted-foreground">Carregando...</div>;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] -m-6 bg-background" style={{ touchAction: "none" }}>
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-card shrink-0 z-20">
        <Button variant="ghost" size="sm" onClick={() => navigate("/crm/bots")}>
          <ArrowLeft size={16} />
        </Button>
        {editingName ? (
          <Input value={botName} onChange={e => setBotName(e.target.value)} onBlur={() => setEditingName(false)} onKeyDown={e => e.key === "Enter" && setEditingName(false)} className="h-8 w-64" autoFocus />
        ) : (
          <h1 className="text-lg font-bold text-foreground cursor-pointer hover:text-primary transition-colors" onClick={() => setEditingName(true)}>{botName}</h1>
        )}
        <span className="text-[10px] font-semibold bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400 px-2 py-0.5 rounded-full">Rascunho</span>
        <div className="flex items-center gap-2 ml-auto">
          <div className="flex items-center gap-2 mr-2">
            <span className="text-xs text-muted-foreground">Ativo</span>
            <Switch checked={bot.active ?? true} onCheckedChange={async (v) => {
              await supabase.from("bots").update({ active: v }).eq("id", bot.id);
              setBot(prev => prev ? { ...prev, active: v } : prev);
            }} />
          </div>
          <Button variant="outline" size="sm" onClick={saveBot} disabled={saving} className="gap-1.5">
            <Save size={14} /> {saving ? "Salvando..." : "Salvar alterações"}
          </Button>
        </div>
      </div>

      <div className="flex-1 flex relative overflow-hidden">
        {/* ── Canvas ── */}
        <div className="flex-1 relative overflow-hidden">
          <div
            ref={canvasRef}
            className="absolute inset-0"
            style={{ cursor: isPanningRef.current ? "grabbing" : "grab", touchAction: "none" }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            {/* Dot grid background */}
            <svg className="absolute inset-0 w-full h-full opacity-20 pointer-events-none">
              <defs>
                <pattern id="dotgrid" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
                  <circle cx="1" cy="1" r="1" fill="currentColor" className="text-muted-foreground" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#dotgrid)" />
            </svg>

            {/* Transformed content */}
            <div style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "0 0" }}>
              <div className="flex items-start gap-8 min-w-max p-4" onPointerDown={e => e.stopPropagation()}>
                {/* ── Trigger Card (Início) ── */}
                <div className="w-72 shrink-0">
                  <div className="rounded-xl overflow-hidden shadow-lg border-2 border-indigo-200 dark:border-indigo-800 bg-card">
                    <div className="bg-indigo-500 px-4 py-3 flex items-center justify-between">
                      <span className="text-white text-sm font-bold">Início</span>
                      <button onClick={() => { setShowGeneralSettings(true); setEditingStepId(null); setActionsOpen(false); }}>
                        <Settings size={16} className="text-white/70 hover:text-white transition-colors cursor-pointer" />
                      </button>
                    </div>
                    <div className="p-3 space-y-2">
                      {triggers.length === 0 && (
                        <div className="text-xs text-muted-foreground space-y-1.5">
                          <div className="flex justify-between py-1 border-b border-border/50">
                            <span>Limite de espera:</span><span className="font-semibold text-foreground">Sem limite</span>
                          </div>
                          <div className="flex justify-between py-1">
                            <span>Tolerância:</span><span className="font-semibold text-foreground">Imediatamente</span>
                          </div>
                        </div>
                      )}
                      {triggers.map(t => {
                        const opt = TRIGGER_OPTIONS.find(o => o.type === t.type);
                        return (
                          <div key={t.id} className="bg-muted/50 rounded-lg px-3 py-2 space-y-1.5">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-medium">{t.label}</span>
                              <button onClick={() => setTriggers(prev => prev.filter(tr => tr.id !== t.id))} className="text-muted-foreground hover:text-destructive"><X size={12} /></button>
                            </div>
                            {opt?.needsStage && (
                              <div className="space-y-1">
                                <Select value={t.config?.pipeline_id || ""} onValueChange={v => updateTriggerConfig(t.id, { pipeline_id: v, stage_id: "" })}>
                                  <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Funil" /></SelectTrigger>
                                  <SelectContent>{pipelines.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                                </Select>
                                {t.config?.pipeline_id && (
                                  <Select value={t.config?.stage_id || ""} onValueChange={v => updateTriggerConfig(t.id, { stage_id: v })}>
                                    <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Etapa" /></SelectTrigger>
                                    <SelectContent>{getStagesForPipeline(t.config.pipeline_id!).map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                                  </Select>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      <div className="relative">
                        <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => setShowTriggerMenu(!showTriggerMenu)}>
                          <Plus size={12} className="mr-1" /> Gatilho
                        </Button>
                        {showTriggerMenu && (
                          <div className="absolute top-full left-0 right-0 mt-1 bg-card rounded-lg border border-border shadow-lg z-30 py-1">
                            {TRIGGER_OPTIONS.map(opt => (
                              <button key={opt.type} className="w-full text-left px-3 py-2 text-xs hover:bg-muted/80 transition-colors"
                                onClick={() => {
                                  setTriggers(prev => [...prev, { id: uid(), type: opt.type, label: opt.label, config: opt.needsStage ? { pipeline_id: "", stage_id: "" } : undefined }]);
                                  setShowTriggerMenu(false);
                                }}>
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* ── Connector from trigger to flow ── */}
                <div className="flex items-center self-center shrink-0">
                  <div className="w-6 h-px bg-border" />
                  <div className="w-1.5 h-1.5 rounded-full bg-border -ml-0.5" />
                  <div className="w-6 h-px bg-border" />
                </div>

                {/* ── Flow Groups ── */}
                <div className="flex items-start gap-8">
                  {rootOutputs.map(output => (
                    <FlowGroupRenderer
                      key={output.id}
                      output={output}
                      onAddStep={openActionsForOutput}
                      onRemoveStep={removeStep}
                      onEditStep={setEditingStepId}
                      editingStepId={editingStepId}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Zoom controls */}
          <div className="absolute bottom-4 left-4 flex items-center gap-1 bg-card rounded-lg border border-border shadow-md p-1 z-20">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={zoomIn}><ZoomIn size={14} /></Button>
            <span className="text-xs font-mono w-10 text-center text-muted-foreground">{Math.round(zoom * 100)}%</span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={zoomOut}><ZoomOut size={14} /></Button>
            <div className="w-px h-5 bg-border mx-0.5" />
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={zoomFit}><Maximize2 size={14} /></Button>
          </div>
        </div>

        {/* ── Actions Sidebar ── */}
        {actionsOpen && (
          <div className="w-80 border-l border-border bg-card shrink-0 overflow-y-auto z-20" onPointerDown={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="text-sm font-bold text-foreground">Ações disponíveis</h2>
              <button onClick={() => { setActionsOpen(false); setActiveOutputId(null); }} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
            </div>
            <div className="p-2">
              {ACTION_CATEGORIES.map(cat => {
                const items = STEP_TYPES.filter(s => s.category === cat.key);
                if (items.length === 0) return null;
                return (
                  <div key={cat.key} className="mb-3">
                    <div className="px-3 py-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{cat.label}</div>
                    {items.map(st => {
                      const Icon = st.icon;
                      return (
                        <button
                          key={st.type}
                          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-foreground hover:bg-muted/80 transition-colors"
                          onClick={() => activeOutputId && addStepToOutput(activeOutputId, st.type)}
                        >
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${st.bg}`}>
                            <Icon size={16} className={st.color} />
                          </div>
                          <span className="font-medium">{st.label}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Step Editor Sidebar ── */}
        {editingStep && !actionsOpen && (
          <div className="w-80 border-l border-border bg-card shrink-0 overflow-y-auto z-20" onPointerDown={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="text-sm font-bold text-foreground">Editar passo</h2>
              <button onClick={() => setEditingStepId(null)} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
            </div>
            <div className="p-4 space-y-3">
              {(editingStep.type === "send_message" || editingStep.type === "send_message_template") && (
                <SendMessageConfig config={editingStep.config} onChange={c => updateStepConfig(editingStep.id, c)} templates={templates} outputs={editingStep.outputs} onUpdateOutputs={o => updateStepOutputs(editingStep.id, o)} />
              )}
              {(editingStep.type === "pause" || editingStep.type === "pause_timer") && (
                <PauseConfig config={editingStep.config} onChange={c => updateStepConfig(editingStep.id, c)} outputs={editingStep.outputs} onUpdateOutputs={o => updateStepOutputs(editingStep.id, o)} />
              )}
              {editingStep.type === "condition" && <ConditionConfig config={editingStep.config} onChange={c => updateStepConfig(editingStep.id, c)} />}
              {(editingStep.type === "action" || editingStep.type === "action_move" || editingStep.type === "action_field" || editingStep.type === "action_transfer") && (
                <ActionConfig config={editingStep.config} onChange={c => updateStepConfig(editingStep.id, c)} pipelines={pipelines} stages={stages} />
              )}
              {editingStep.type === "stop_bot" && <p className="text-xs text-muted-foreground">O bot será encerrado neste ponto.</p>}
              {editingStep.type === "start_bot" && (
                <div>
                  <Label className="text-xs">Bot a iniciar</Label>
                  <Select value={editingStep.config.bot_id || ""} onValueChange={v => updateStepConfig(editingStep.id, { ...editingStep.config, bot_id: v })}>
                    <SelectTrigger className="h-8 text-xs mt-1"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                    <SelectContent>{bots.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
              {editingStep.type === "reaction" && <ReactionConfig config={editingStep.config} onChange={c => updateStepConfig(editingStep.id, c)} />}
              {editingStep.type === "comment" && (
                <div>
                  <Label className="text-xs">Comentário</Label>
                  <Textarea className="text-xs min-h-[60px] mt-1" value={editingStep.config.text || ""} onChange={e => updateStepConfig(editingStep.id, { ...editingStep.config, text: e.target.value })} placeholder="Escreva..." />
                </div>
              )}
              {editingStep.type === "list_message" && (
                <ListMessageConfig config={editingStep.config} onChange={c => updateStepConfig(editingStep.id, c)} outputs={editingStep.outputs} onUpdateOutputs={o => updateStepOutputs(editingStep.id, o)} />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Flow Group Renderer (Kommo-style grouped card) ──

interface FlowGroupRendererProps {
  output: FlowOutput;
  onAddStep: (outputId: string) => void;
  onRemoveStep: (stepId: string) => void;
  onEditStep: (stepId: string) => void;
  editingStepId: string | null;
}

const FlowGroupRenderer = ({ output, onAddStep, onRemoveStep, onEditStep, editingStepId }: FlowGroupRendererProps) => {
  // Collect all steps in the main branch (linear chain)
  const collectLinearSteps = (o: FlowOutput): { steps: FlowStep[]; branches: { output: FlowOutput; afterStepIdx: number }[] } => {
    const steps: FlowStep[] = [];
    const branches: { output: FlowOutput; afterStepIdx: number }[] = [];

    let current = o;
    while (current.nextSteps.length > 0) {
      const step = current.nextSteps[0];
      steps.push(step);

      // If this step has multiple outputs, register branches
      if (step.outputs.length > 1) {
        step.outputs.forEach(out => {
          branches.push({ output: out, afterStepIdx: steps.length - 1 });
        });
        break; // Branching stops linear collection
      }

      // Single output → continue chain
      if (step.outputs.length === 1) {
        current = step.outputs[0];
      } else {
        break;
      }
    }

    return { steps, branches };
  };

  const { steps, branches } = collectLinearSteps(output);

  // Get the last output for adding new steps
  const getLastOutputId = (): string => {
    if (steps.length === 0) return output.id;
    const lastStep = steps[steps.length - 1];
    if (lastStep.outputs.length === 1) return lastStep.outputs[0].id;
    return output.id;
  };

  const stepColors: Record<string, { icon: string; bg: string }> = {
    send_message: { icon: "text-rose-500", bg: "bg-rose-50 dark:bg-rose-950/20" },
    send_message_template: { icon: "text-rose-500", bg: "bg-rose-50 dark:bg-rose-950/20" },
    list_message: { icon: "text-rose-500", bg: "bg-rose-50 dark:bg-rose-950/20" },
    reaction: { icon: "text-pink-500", bg: "bg-pink-50 dark:bg-pink-950/20" },
    comment: { icon: "text-blue-500", bg: "bg-blue-50 dark:bg-blue-950/20" },
    pause: { icon: "text-violet-500", bg: "bg-violet-50 dark:bg-violet-950/20" },
    pause_timer: { icon: "text-violet-500", bg: "bg-violet-50 dark:bg-violet-950/20" },
    condition: { icon: "text-purple-500", bg: "bg-purple-50 dark:bg-purple-950/20" },
    action: { icon: "text-cyan-500", bg: "bg-cyan-50 dark:bg-cyan-950/20" },
    action_move: { icon: "text-amber-500", bg: "bg-amber-50 dark:bg-amber-950/20" },
    action_field: { icon: "text-amber-500", bg: "bg-amber-50 dark:bg-amber-950/20" },
    action_transfer: { icon: "text-amber-500", bg: "bg-amber-50 dark:bg-amber-950/20" },
    stop_bot: { icon: "text-red-500", bg: "bg-red-50 dark:bg-red-950/20" },
    start_bot: { icon: "text-indigo-500", bg: "bg-indigo-50 dark:bg-indigo-950/20" },
    round_robin: { icon: "text-gray-500", bg: "bg-gray-50 dark:bg-gray-950/20" },
  };

  const getStepLabel = (step: FlowStep): string => {
    const def = STEP_TYPES.find(s => s.type === step.type);
    return def?.label || step.type;
  };

  const getStepPreview = (step: FlowStep): string | null => {
    if (step.type === "send_message" || step.type === "send_message_template") {
      if (step.config?.useTemplate) return `Template: ${step.config.template_name}`;
      return step.config?.message?.substring(0, 60) || null;
    }
    if (step.type === "action" || step.type === "action_move" || step.type === "action_field") {
      if (step.config?.actionType === "add_tag") return `Tag: ${step.config.tag || "..."}`;
      if (step.config?.actionType === "move_stage") return "Mover etapa";
      return step.config?.actionType || null;
    }
    if (step.type === "action_transfer") return `Equipe: ${step.config?.team || "Atendimento"}`;
    if (step.type === "pause" || step.type === "pause_timer") {
      const cond = step.config?.conditions?.[0];
      if (cond?.type === "timer") return `${cond.hours || 0}h ${cond.minutes || 0}min`;
      return "Aguardar resposta";
    }
    if (step.type === "reaction") return step.config?.emoji || "👍";
    if (step.type === "comment") return step.config?.text?.substring(0, 40) || null;
    return null;
  };

  const getStepIcon = (type: string) => {
    const def = STEP_TYPES.find(s => s.type === type);
    return def?.icon || MessageSquare;
  };

  const hasBranches = branches.length > 0;

  return (
    <div className="flex items-start gap-8">
      {/* Main group card */}
      <div className={`rounded-xl border-2 shadow-lg bg-card min-w-[300px] overflow-hidden transition-all ${
        editingStepId && steps.some(s => s.id === editingStepId) ? "border-indigo-400 dark:border-indigo-600" : "border-blue-200 dark:border-blue-800"
      }`}>
        {/* Card header */}
        <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/30 border-b border-border">
          <div className="w-7 h-7 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
            <Bot size={14} className="text-indigo-500" />
          </div>
          <span className="text-sm font-semibold text-foreground flex-1">{output.label}</span>
          <button className="text-muted-foreground hover:text-foreground"><MoreVertical size={14} /></button>
        </div>

        {/* Steps list */}
        <div className="p-2 space-y-1.5">
          {steps.map((step) => {
            const Icon = getStepIcon(step.type);
            const colors = stepColors[step.type] || { icon: "text-gray-500", bg: "bg-gray-50 dark:bg-gray-950/20" };
            const preview = getStepPreview(step);
            const isEditing = editingStepId === step.id;

            return (
              <div
                key={step.id}
                onClick={() => onEditStep(step.id)}
                className={`rounded-lg p-3 cursor-pointer transition-all group ${colors.bg} ${
                  isEditing ? "ring-2 ring-indigo-400" : "hover:ring-1 hover:ring-border"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Icon size={14} className={colors.icon} />
                  <span className="text-xs font-semibold text-foreground flex-1">{getStepLabel(step)}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); onRemoveStep(step.id); }}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                  >
                    <X size={12} />
                  </button>
                </div>
                {preview && (
                  <p className="text-[11px] text-muted-foreground mt-1 ml-5 truncate">{preview}</p>
                )}
              </div>
            );
          })}
        </div>

        {/* Add step button inside card */}
        {!hasBranches && (
          <div className="px-2 pb-2">
            <button
              onClick={() => onAddStep(getLastOutputId())}
              className="w-full flex items-center justify-center gap-1 py-2 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:border-primary hover:text-primary hover:bg-primary/5 transition-all"
            >
              <Plus size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Branch connectors + child groups */}
      {hasBranches && (
        <div className="flex flex-col gap-4 self-center">
          {branches.map(({ output: branchOutput }) => (
            <div key={branchOutput.id} className="flex items-center gap-2">
              {/* Connector */}
              <div className="flex items-center shrink-0">
                <div className="w-8 h-px bg-border" />
                <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded whitespace-nowrap border border-border">{branchOutput.label}</span>
                <div className="w-8 h-px bg-border" />
                <div className="w-1.5 h-1.5 rounded-full bg-border" />
              </div>

              {/* Child group or add button */}
              {branchOutput.nextSteps.length > 0 ? (
                <FlowGroupRenderer
                  output={branchOutput}
                  onAddStep={onAddStep}
                  onRemoveStep={onRemoveStep}
                  onEditStep={onEditStep}
                  editingStepId={editingStepId}
                />
              ) : (
                <button
                  onClick={() => onAddStep(branchOutput.id)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-dashed border-border bg-card text-xs text-muted-foreground hover:border-primary hover:text-primary transition-colors shadow-sm"
                >
                  <Plus size={12} /> Adicionar passo
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Single output connector to next group */}
      {!hasBranches && steps.length > 0 && steps[steps.length - 1].outputs.length === 1 && steps[steps.length - 1].outputs[0].nextSteps.length > 0 && (
        <div className="flex items-center gap-2 self-center">
          <div className="flex items-center shrink-0">
            <div className="w-8 h-px bg-border" />
            <div className="w-1.5 h-1.5 rounded-full bg-border" />
          </div>
          <FlowGroupRenderer
            output={steps[steps.length - 1].outputs[0]}
            onAddStep={onAddStep}
            onRemoveStep={onRemoveStep}
            onEditStep={onEditStep}
            editingStepId={editingStepId}
          />
        </div>
      )}
    </div>
  );
};

export default CrmBotEditor;
