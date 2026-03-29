import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  ArrowLeft, Save, Play, Plus, X, MessageSquare, Pause, Zap, GitBranch,
  CheckCircle2, Bot, StopCircle, Heart, MessageCircle, Send, Smartphone,
  Shuffle, ZoomIn, ZoomOut, Maximize2,
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

  const [rootOutputs, setRootOutputs] = useState<FlowOutput[]>([
    { id: uid(), label: "Início", conditionType: "start", conditionValue: null, nextSteps: [] },
  ]);

  const [pipelines, setPipelines] = useState<any[]>([]);
  const [stages, setStages] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [bots, setBots] = useState<any[]>([]);

  // Node positions (draggable offsets)
  const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number }>>({});

  const updateNodePosition = useCallback((nodeId: string, pos: { x: number; y: number }) => {
    setNodePositions(prev => ({ ...prev, [nodeId]: pos }));
  }, []);

  // Pan & Zoom state
  const canvasRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // Load/save canvas state from localStorage
  const storageKey = `bot-canvas-${botId}`;
  const positionsKey = `bot-positions-${botId}`;

  useEffect(() => {
    if (!botId) return;
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        const { pan: sp, zoom: sz } = JSON.parse(saved);
        if (sp) setPan(sp);
        if (sz) setZoom(sz);
      } catch {}
    }
    const savedPos = localStorage.getItem(positionsKey);
    if (savedPos) {
      try { setNodePositions(JSON.parse(savedPos)); } catch {}
    }
  }, [botId]);

  useEffect(() => {
    if (!botId) return;
    localStorage.setItem(storageKey, JSON.stringify({ pan, zoom }));
  }, [pan, zoom, botId]);

  useEffect(() => {
    if (!botId) return;
    localStorage.setItem(positionsKey, JSON.stringify(nodePositions));
  }, [nodePositions, botId]);

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
        id: o.id,
        label: o.label,
        conditionType: o.condition_type,
        conditionValue: o.condition_value,
        nextSteps: o.next_node_id ? (() => {
          const child = buildStep(o.next_node_id, visited);
          return child ? [child] : [];
        })() : [],
      }));

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
      id: uid(), label: "Início", conditionType: "start", conditionValue: null,
      nextSteps: firstStep ? [firstStep] : [],
    }];
  };

  const mapNodeType = (dbType: string): string => {
    const map: Record<string, string> = {
      message_text: "send_message", message_template: "send_message", message_audio: "send_message",
      wait: "pause", condition: "condition",
      action_move_stage: "action", action_set_field: "action", action_add_tag: "action",
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
    setPipelines(p || []); setStages(s || []); setTemplates(t || []); setBots(b || []);
  };

  // ── Tree operations ──

  const addStepToOutput = (outputId: string, stepType: string) => {
    // Check if this output is a "no_response" type - if so, pause should only have timer
    const isNoResponse = findOutputConditionType(rootOutputs, outputId) === "no_response";
    const config = stepType === "pause" && isNoResponse
      ? { conditions: [{ type: "timer", hours: 1, minutes: 0, seconds: 0 }] }
      : getDefaultConfig(stepType);
    const outputs = stepType === "pause" && isNoResponse
      ? [{ id: uid(), label: "Cronômetro expirado", conditionType: "timeout", conditionValue: null, nextSteps: [] as FlowStep[] }]
      : getDefaultOutputs(stepType);
    const newStep: FlowStep = { id: uid(), type: stepType, config, outputs };
    setRootOutputs(prev => addStepInTree(prev, outputId, newStep));
  };

  const findOutputConditionType = (outs: FlowOutput[], targetId: string): string | null => {
    for (const o of outs) {
      if (o.id === targetId) return o.conditionType;
      for (const step of o.nextSteps) {
        const found = findOutputConditionType(step.outputs, targetId);
        if (found) return found;
      }
    }
    return null;
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
        ...o,
        nextSteps: o.nextSteps.filter(step => step.id !== targetId).map(step => ({ ...step, outputs: removeInTree(step.outputs) })),
      }));
    };
    setRootOutputs(prev => removeInTree(prev));
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
      case "list_message": return { header: "", body: "", footer: "", buttonText: "Ver opções", sections: [{ title: "", rows: [{ id: "opcao_1", title: "", description: "" }] }] };
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
      case "list_message":
        return [
          { id: uid(), label: "Outra resposta", conditionType: "other_reply", conditionValue: null, nextSteps: [] },
          { id: uid(), label: "Sem resposta", conditionType: "no_response", conditionValue: null, nextSteps: [] },
        ];
      case "stop_bot":
        return [];
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
        flatNodes.push({
          id: realId, bot_id: botId, type: dbType, config: step.config,
          position_x: stepIndex * 300, position_y: 0, is_start_node: isFirst,
        });
        stepIndex++;

        step.outputs.forEach(o => {
          const outId = crypto.randomUUID();
          const nextId = o.nextSteps.length > 0 ? o.nextSteps[0] : null;
          flatOutputs.push({
            id: outId, node_id: realId, label: o.label,
            condition_type: o.conditionType, condition_value: o.conditionValue,
            next_node_id: nextId ? "__pending__" + o.nextSteps[0].id : null,
          });
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

  // ── Pan & Zoom handlers ──

  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.target !== canvasRef.current) return;
    e.preventDefault();
    setIsPanning(true);
    panStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  }, [pan]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return;
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    setPan({ x: panStartRef.current.panX + dx, y: panStartRef.current.panY + dy });
  }, [isPanning]);

  const handleCanvasMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.05 : 0.05;
    setZoom(prev => Math.min(2, Math.max(0.3, prev + delta)));
  }, []);

  // Prevent browser zoom on pinch gestures
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const preventGesture = (e: Event) => e.preventDefault();
    const preventWheelPassive = (e: WheelEvent) => {
      if (e.ctrlKey) e.preventDefault();
    };
    el.addEventListener("gesturestart", preventGesture, { passive: false });
    el.addEventListener("gesturechange", preventGesture, { passive: false });
    el.addEventListener("gestureend", preventGesture, { passive: false });
    el.addEventListener("wheel", preventWheelPassive, { passive: false });
    return () => {
      el.removeEventListener("gesturestart", preventGesture);
      el.removeEventListener("gesturechange", preventGesture);
      el.removeEventListener("gestureend", preventGesture);
      el.removeEventListener("wheel", preventWheelPassive);
    };
  }, []);

  const zoomIn = () => setZoom(prev => Math.min(2, prev + 0.1));
  const zoomOut = () => setZoom(prev => Math.max(0.3, prev - 0.1));
  const zoomFit = () => { setZoom(1); setPan({ x: 40, y: 40 }); };

  // ── Trigger helpers ──

  const updateTriggerConfig = (triggerId: string, config: Partial<Trigger["config"]>) => {
    setTriggers(prev => prev.map(t =>
      t.id === triggerId ? { ...t, config: { ...t.config, ...config } } : t
    ));
  };

  const getStagesForPipeline = (pipelineId: string) => stages.filter(s => s.pipeline_id === pipelineId);

  if (!bot) return <div className="flex items-center justify-center h-64 text-muted-foreground">Carregando...</div>;

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] -m-6 bg-muted/30" style={{ touchAction: "none" }}>
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

      {/* Canvas area */}
      <div className="flex-1 relative overflow-hidden" style={{ touchAction: "none" }}>
        {/* Canvas background (pannable) */}
        <div
          ref={canvasRef}
          className="absolute inset-0"
          style={{ cursor: isPanning ? "grabbing" : "grab", touchAction: "none" }}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
          onWheel={handleWheel}
          onTouchStart={(e) => {
            if (e.target !== canvasRef.current) return;
            e.preventDefault();
            const touch = e.touches[0];
            setIsPanning(true);
            panStartRef.current = { x: touch.clientX, y: touch.clientY, panX: pan.x, panY: pan.y };
          }}
          onTouchMove={(e) => {
            if (!isPanning) return;
            e.preventDefault();
            const touch = e.touches[0];
            const dx = touch.clientX - panStartRef.current.x;
            const dy = touch.clientY - panStartRef.current.y;
            setPan({ x: panStartRef.current.panX + dx, y: panStartRef.current.panY + dy });
          }}
          onTouchEnd={() => setIsPanning(false)}
        >
          {/* Transformed content */}
          <div
            ref={contentRef}
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "0 0",
              pointerEvents: "auto",
              touchAction: "none",
            }}
          >
            <div className="flex items-start gap-6 min-w-max p-2">
              {/* Triggers panel */}
              <div className="w-72 shrink-0" onMouseDown={e => e.stopPropagation()} style={{ touchAction: "auto" }}>
                <div className="bg-card rounded-xl border border-border shadow-sm p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-foreground">Gatilhos</h3>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">
                    Defina quando este bot deve ser iniciado automaticamente.
                  </p>
                  {triggers.map(t => {
                    const opt = TRIGGER_OPTIONS.find(o => o.type === t.type);
                    const needsStage = opt?.needsStage ?? false;
                    return (
                      <div key={t.id} className="bg-muted/50 rounded-lg px-3 py-2 mb-2 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span>{t.label}</span>
                          <button onClick={() => setTriggers(prev => prev.filter(tr => tr.id !== t.id))} className="text-muted-foreground hover:text-destructive">
                            <X size={12} />
                          </button>
                        </div>
                        {needsStage && (
                          <div className="space-y-1.5">
                            <Select
                              value={t.config?.pipeline_id || ""}
                              onValueChange={v => updateTriggerConfig(t.id, { pipeline_id: v, stage_id: "" })}
                            >
                              <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Selecione o funil" /></SelectTrigger>
                              <SelectContent>
                                {pipelines.map(p => (
                                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {t.config?.pipeline_id && (
                              <Select
                                value={t.config?.stage_id || ""}
                                onValueChange={v => updateTriggerConfig(t.id, { stage_id: v })}
                              >
                                <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Selecione a etapa" /></SelectTrigger>
                                <SelectContent>
                                  {getStagesForPipeline(t.config.pipeline_id).map(s => (
                                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                            {!t.config?.stage_id && (
                              <p className="text-[10px] text-amber-500">⚠ Selecione a etapa para ativar este gatilho</p>
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
                      <div className="absolute top-full left-0 right-0 mt-1 bg-card rounded-lg border border-border shadow-lg z-20 py-1">
                        {TRIGGER_OPTIONS.map(opt => (
                          <button
                            key={opt.type}
                            className="w-full text-left px-3 py-2 text-xs hover:bg-muted/80 transition-colors"
                            onClick={() => {
                              setTriggers(prev => [...prev, {
                                id: uid(), type: opt.type, label: opt.label,
                                config: opt.needsStage ? { pipeline_id: "", stage_id: "" } : undefined,
                              }]);
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
              <div className="flex items-start" onMouseDown={e => e.stopPropagation()} style={{ touchAction: "none" }}>
                {/* Start card */}
                <div className="shrink-0">
                  <div className="bg-emerald-500 text-white rounded-xl px-5 py-3 flex items-center gap-2 shadow-sm border border-emerald-400">
                    <Play size={16} fill="white" />
                    <span className="text-sm font-semibold">Iniciar robô</span>
                  </div>
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
                      nodePositions={nodePositions}
                      onUpdateNodePosition={updateNodePosition}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Zoom controls - bottom right */}
        <div className="absolute bottom-4 right-4 flex items-center gap-1 bg-card rounded-lg border border-border shadow-md p-1 z-20">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={zoomOut}>
            <ZoomOut size={14} />
          </Button>
          <span className="text-xs font-mono w-10 text-center text-muted-foreground">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={zoomIn}>
            <ZoomIn size={14} />
          </Button>
          <div className="w-px h-5 bg-border mx-0.5" />
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={zoomFit} title="Centralizar">
            <Maximize2 size={14} />
          </Button>
        </div>
      </div>
    </div>
  );
};

// ── Orthogonal Connector Line (Kommo style) ──

const OrthogonalConnector = ({ targetOffset }: { targetOffset?: { x: number; y: number } }) => {
  const dy = targetOffset?.y || 0;
  const dx = targetOffset?.x || 0;
  const baseLen = 40;
  const totalW = baseLen + dx + 12;
  const absH = Math.abs(dy) + 12;

  if (Math.abs(dy) < 3 && Math.abs(dx) < 3) {
    // Straight line
    return (
      <div className="flex items-center shrink-0 mx-0">
        <div className="w-10 h-px bg-border" />
        <div className="w-2 h-2 rounded-full border-2 border-border bg-card -ml-1" />
      </div>
    );
  }

  // Orthogonal path: go right half, then down/up, then right to target
  const midX = baseLen / 2;
  const endX = baseLen + dx;
  const endY = dy;

  return (
    <div className="flex items-center shrink-0 mx-0" style={{ position: "relative" }}>
      <svg
        width={Math.max(totalW, 44)}
        height={absH + 6}
        className="shrink-0 overflow-visible"
        style={{
          minWidth: 44,
          minHeight: 10,
          position: "relative",
          top: dy > 0 ? 0 : dy,
        }}
      >
        <path
          d={`M 0,${dy < 0 ? -dy + 3 : 3} L ${midX},${dy < 0 ? -dy + 3 : 3} L ${midX},${dy < 0 ? 3 : dy + 3} L ${endX},${dy < 0 ? 3 : dy + 3}`}
          fill="none"
          stroke="hsl(var(--border))"
          strokeWidth={1.5}
        />
        <circle
          cx={endX}
          cy={dy < 0 ? 3 : dy + 3}
          r={3}
          fill="hsl(var(--card))"
          stroke="hsl(var(--border))"
          strokeWidth={2}
        />
      </svg>
    </div>
  );
};

const ConnectorLine = () => (
  <div className="flex items-center shrink-0 mx-0">
    <div className="w-10 h-px bg-border" />
    <div className="w-2 h-2 rounded-full border-2 border-border bg-card -ml-1" />
  </div>
);

// ── Add Step Button (draggable) ──

const AddStepButton = ({ outputId, onAdd, restrictToType }: { outputId: string; onAdd: (outputId: string, type: string) => void; restrictToType?: string }) => {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, ox: 0, oy: 0 });

  useEffect(() => {
    if (!open) return;
    if (restrictToType) {
      onAdd(outputId, restrictToType);
      setOpen(false);
      return;
    }
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, restrictToType, outputId, onAdd]);

  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - dragStartRef.current.x;
      const dy = ev.clientY - dragStartRef.current.y;
      setOffset({ x: dragStartRef.current.ox + dx, y: dragStartRef.current.oy + dy });
    };
    const onUp = () => {
      setDragging(false);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  return (
    <div className="relative flex items-center" ref={menuRef} style={{ touchAction: "none" }}>
      {/* Orthogonal connector line to the dragged position */}
      {(() => {
        const dy = offset.y;
        const dx = offset.x;
        const baseLen = 40;

        if (Math.abs(dy) < 3 && Math.abs(dx) < 3) {
          return (
            <div className="flex items-center shrink-0 mx-0">
              <div className="w-10 h-px bg-border" />
              <div className="w-2 h-2 rounded-full border-2 border-border bg-card -ml-1" />
            </div>
          );
        }

        const midX = baseLen / 2;
        const endX = baseLen + dx;
        const absH = Math.abs(dy) + 12;
        const totalW = baseLen + dx + 12;

        return (
          <div className="flex items-center shrink-0 mx-0" style={{ position: "relative" }}>
            <svg
              width={Math.max(totalW, 44)}
              height={absH + 6}
              className="shrink-0 overflow-visible"
              style={{
                minWidth: 44,
                minHeight: 10,
                position: "relative",
                top: dy > 0 ? 0 : dy,
              }}
            >
              <path
                d={`M 0,${dy < 0 ? -dy + 3 : 3} L ${midX},${dy < 0 ? -dy + 3 : 3} L ${midX},${dy < 0 ? 3 : dy + 3} L ${endX},${dy < 0 ? 3 : dy + 3}`}
                fill="none"
                stroke="hsl(var(--border))"
                strokeWidth={1.5}
              />
              <circle
                cx={endX}
                cy={dy < 0 ? 3 : dy + 3}
                r={3}
                fill="hsl(var(--card))"
                stroke="hsl(var(--border))"
                strokeWidth={2}
              />
            </svg>
          </div>
        );
      })()}
      <button
        ref={btnRef}
        onMouseDown={handleDragStart}
        onClick={(e) => { if (!dragging) setOpen(!open); }}
        className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-dashed border-border bg-card text-xs text-muted-foreground hover:border-primary hover:text-primary transition-colors whitespace-nowrap shadow-sm select-none"
        style={{
          touchAction: "none",
          cursor: dragging ? "grabbing" : "grab",
          transform: `translate(${offset.x}px, ${offset.y}px)`,
          position: "relative",
          zIndex: dragging ? 50 : "auto",
        }}
      >
        <Plus size={12} /> Adicionar próximo passo
      </button>

      {open && (
        restrictToType ? (
          // Auto-add the restricted type directly
          (() => { onAdd(outputId, restrictToType); setOpen(false); return null; })()
        ) : (
        <div
          className="absolute left-12 top-full mt-1 bg-card rounded-xl border border-border shadow-xl z-30 py-2 w-64"
          style={{
            touchAction: "auto",
            transform: `translate(${offset.x}px, ${offset.y}px)`,
          }}
        >
          <div className="px-3 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Mensagens</div>
          {STEP_TYPES.filter(s => s.category === "main").map(st => (
            <button key={st.type} className="w-full text-left px-3 py-2 text-sm hover:bg-muted/80 transition-colors flex items-center gap-2"
              onClick={() => { onAdd(outputId, st.type); setOpen(false); }}>
              <span>{st.emoji}</span> {st.label}
            </button>
          ))}
          <div className="border-t border-border my-1" />
          <div className="px-3 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Lógica</div>
          {STEP_TYPES.filter(s => s.category === "logic").map(st => (
            <button key={st.type} className="w-full text-left px-3 py-2 text-sm hover:bg-muted/80 transition-colors flex items-center gap-2"
              onClick={() => { onAdd(outputId, st.type); setOpen(false); }}>
              <span>{st.emoji}</span> {st.label}
            </button>
          ))}
          <div className="border-t border-border my-1" />
          <div className="px-3 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Ações</div>
          {STEP_TYPES.filter(s => s.category === "action").map(st => (
            <button key={st.type} className="w-full text-left px-3 py-2 text-sm hover:bg-muted/80 transition-colors flex items-center gap-2"
              onClick={() => { onAdd(outputId, st.type); setOpen(false); }}>
              <span>{st.emoji}</span> {st.label}
            </button>
          ))}
        </div>
        )
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
  nodePositions: Record<string, { x: number; y: number }>;
  onUpdateNodePosition: (nodeId: string, pos: { x: number; y: number }) => void;
}

const FlowBranch = ({
  output, stepNumber, onAddStep, onRemoveStep, onUpdateConfig, onUpdateOutputs,
  pipelines, stages, templates, allBots, branchLabel, nodePositions, onUpdateNodePosition,
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
        <AddStepButton outputId={output.id} onAdd={onAddStep} restrictToType={output.conditionType === "no_response" ? "pause" : undefined} />
      </div>
    );
  }

  return (
    <>
      {output.nextSteps.map((step, idx) => {
        const currentNum = stepNumber + idx;
        const hasMultipleOutputs = step.outputs.length > 1;
        const stepPos = nodePositions[step.id] || { x: 0, y: 0 };

        return (
          <div key={step.id} className="flex items-start">
            {branchLabel ? (
              <>
                <ConnectorLine />
                <span className="text-[10px] text-muted-foreground bg-muted/50 px-2 py-0.5 rounded whitespace-nowrap mr-1 self-center">{branchLabel}</span>
                <OrthogonalConnector targetOffset={stepPos} />
              </>
            ) : (
              <OrthogonalConnector targetOffset={stepPos} />
            )}

            <div
              className="flex flex-col shrink-0"
              style={{
                transform: `translate(${stepPos.x}px, ${stepPos.y}px)`,
                position: "relative",
                zIndex: 5,
              }}
            >
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
                position={stepPos}
                onUpdatePosition={(pos) => onUpdateNodePosition(step.id, pos)}
              />
            </div>

            {hasMultipleOutputs ? (
              <div className="flex flex-col gap-3 self-center" style={{ transform: `translate(${stepPos.x}px, ${stepPos.y}px)` }}>
                {step.outputs.map((o) => (
                  <FlowBranch
                    key={o.id} output={o} stepNumber={currentNum + 1}
                    onAddStep={onAddStep} onRemoveStep={onRemoveStep}
                    onUpdateConfig={onUpdateConfig} onUpdateOutputs={onUpdateOutputs}
                    pipelines={pipelines} stages={stages} templates={templates} allBots={allBots}
                    branchLabel={o.label}
                    nodePositions={nodePositions} onUpdateNodePosition={onUpdateNodePosition}
                  />
                ))}
              </div>
            ) : step.outputs.length === 1 ? (
              <div style={{ transform: `translate(${stepPos.x}px, ${stepPos.y}px)` }}>
                <FlowBranch
                  output={step.outputs[0]} stepNumber={currentNum + 1}
                  onAddStep={onAddStep} onRemoveStep={onRemoveStep}
                  onUpdateConfig={onUpdateConfig} onUpdateOutputs={onUpdateOutputs}
                  pipelines={pipelines} stages={stages} templates={templates} allBots={allBots}
                  nodePositions={nodePositions} onUpdateNodePosition={onUpdateNodePosition}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
};

// ── Step Card (draggable) ──

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
  position: { x: number; y: number };
  onUpdatePosition: (pos: { x: number; y: number }) => void;
}

const StepCard = ({ step, number, onRemove, onUpdateConfig, onUpdateOutputs, pipelines, stages, templates, allBots, position, onUpdatePosition }: StepCardProps) => {
  const stepInfo = STEP_TYPES.find(s => s.type === step.type);
  const config = step.config || {};
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef({ x: 0, y: 0, px: 0, py: 0 });

  const headerColors: Record<string, string> = {
    send_message: "bg-blue-500", pause: "bg-amber-500", condition: "bg-purple-500",
    action: "bg-emerald-500", stop_bot: "bg-red-500", start_bot: "bg-indigo-500",
    reaction: "bg-pink-500", comment: "bg-sky-500", internal_message: "bg-teal-500",
    list_message: "bg-cyan-500", validation: "bg-orange-500", round_robin: "bg-violet-500",
  };

  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    // Don't drag if clicking the close button
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    dragRef.current = { x: e.clientX, y: e.clientY, px: position.x, py: position.y };

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - dragRef.current.x;
      const dy = ev.clientY - dragRef.current.y;
      onUpdatePosition({ x: dragRef.current.px + dx, y: dragRef.current.py + dy });
    };
    const onUp = () => {
      setIsDragging(false);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  return (
    <div
      className="bg-card rounded-xl border border-border shadow-sm w-80 overflow-hidden"
      style={{ touchAction: "none", zIndex: isDragging ? 50 : "auto" }}
    >
      <div
        className={`${headerColors[step.type] || "bg-muted"} px-3 py-2 flex items-center justify-between`}
        style={{ cursor: isDragging ? "grabbing" : "grab", touchAction: "none" }}
        onMouseDown={handleHeaderMouseDown}
      >
        <div className="flex items-center gap-2 text-white">
          <span className="text-xs font-bold bg-white/20 rounded-full w-5 h-5 flex items-center justify-center">{number}</span>
          <span className="text-xs font-semibold">{stepInfo?.label || step.type}</span>
        </div>
        <button onClick={onRemove} className="text-white/70 hover:text-white"><X size={14} /></button>
      </div>

      <div className="p-3 space-y-2" style={{ touchAction: "auto" }}>
        {step.type === "send_message" && (
          <SendMessageConfig config={config} onChange={onUpdateConfig} templates={templates} outputs={step.outputs} onUpdateOutputs={onUpdateOutputs} />
        )}
        {step.type === "pause" && (
          <PauseConfig config={config} onChange={onUpdateConfig} outputs={step.outputs} onUpdateOutputs={onUpdateOutputs} />
        )}
        {step.type === "condition" && <ConditionConfig config={config} onChange={onUpdateConfig} />}
        {step.type === "action" && <ActionConfig config={config} onChange={onUpdateConfig} pipelines={pipelines} stages={stages} />}
        {step.type === "stop_bot" && <p className="text-xs text-muted-foreground">O bot será encerrado neste ponto.</p>}
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
        {step.type === "reaction" && <ReactionConfig config={config} onChange={onUpdateConfig} />}
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
        {step.type === "list_message" && (
          <ListMessageConfig config={config} onChange={onUpdateConfig} outputs={step.outputs} onUpdateOutputs={onUpdateOutputs} />
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

export default CrmBotEditor;
