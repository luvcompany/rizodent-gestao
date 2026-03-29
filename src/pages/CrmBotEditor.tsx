import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  ArrowLeft, ZoomIn, ZoomOut, Maximize2, Save, Plus,
  MessageSquare, FileText, Mic, Clock, GitBranch, ArrowRightLeft,
  Tag, Settings2, XCircle, Trash2, GripVertical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

// ── Types ──

interface BotNode {
  id: string;
  bot_id: string;
  type: string;
  config: any;
  position_x: number;
  position_y: number;
  is_start_node: boolean;
  created_at?: string;
  _temp?: boolean;
}

interface BotNodeOutput {
  id: string;
  node_id: string;
  label: string;
  condition_type: string;
  condition_value: string | null;
  next_node_id: string | null;
  _temp?: boolean;
}

interface Bot {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
}

const NODE_COLORS: Record<string, string> = {
  message_text: "hsl(270, 60%, 50%)",
  message_template: "hsl(220, 70%, 40%)",
  message_audio: "hsl(30, 90%, 50%)",
  wait: "hsl(45, 90%, 50%)",
  condition: "hsl(45, 90%, 50%)",
  action_move_stage: "hsl(140, 50%, 45%)",
  action_set_field: "hsl(140, 50%, 45%)",
  action_add_tag: "hsl(140, 50%, 45%)",
  action_end_bot: "hsl(0, 70%, 50%)",
};

const NODE_LABELS: Record<string, string> = {
  message_text: "Texto",
  message_template: "Template WhatsApp",
  message_audio: "Áudio",
  wait: "Espera",
  condition: "Condição",
  action_move_stage: "Mover Etapa",
  action_set_field: "Definir Campo",
  action_add_tag: "Adicionar Tag",
  action_end_bot: "Encerrar Bot",
};

const NODE_ICONS: Record<string, any> = {
  message_text: MessageSquare,
  message_template: FileText,
  message_audio: Mic,
  wait: Clock,
  condition: GitBranch,
  action_move_stage: ArrowRightLeft,
  action_set_field: Settings2,
  action_add_tag: Tag,
  action_end_bot: XCircle,
};

const NODE_WIDTH = 220;
const NODE_HEIGHT = 120;

const CrmBotEditor = () => {
  const { id: botId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [bot, setBot] = useState<Bot | null>(null);
  const [nodes, setNodes] = useState<BotNode[]>([]);
  const [outputs, setOutputs] = useState<BotNodeOutput[]>([]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [botName, setBotName] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);

  // Canvas state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);

  // Drag node state
  const [draggingNode, setDraggingNode] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // Connection drawing state
  const [connecting, setConnecting] = useState<{ outputId: string; fromX: number; fromY: number } | null>(null);
  const [connectMouse, setConnectMouse] = useState({ x: 0, y: 0 });

  // Extra data for config panels
  const [pipelines, setPipelines] = useState<any[]>([]);
  const [stages, setStages] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);

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

    const { data: n } = await supabase.from("bot_nodes").select("*").eq("bot_id", botId).order("created_at");
    setNodes(n || []);

    const nodeIds = (n || []).map((nd: any) => nd.id);
    if (nodeIds.length > 0) {
      const { data: o } = await supabase.from("bot_node_outputs").select("*").in("node_id", nodeIds);
      setOutputs(o || []);
    }
  };

  const loadExtras = async () => {
    const [{ data: p }, { data: s }, { data: t }] = await Promise.all([
      supabase.from("crm_pipelines").select("*"),
      supabase.from("crm_stages").select("*").order("position"),
      supabase.from("crm_whatsapp_templates").select("*").eq("status", "APPROVED"),
    ]);
    setPipelines(p || []);
    setStages(s || []);
    setTemplates(t || []);
  };

  // ── Canvas interactions ──

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.target === canvasRef.current || (e.target as HTMLElement).classList.contains("canvas-bg")) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      setSelectedNode(null);
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
    }
    if (draggingNode) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = (e.clientX - rect.left - pan.x) / zoom - dragOffset.x;
      const y = (e.clientY - rect.top - pan.y) / zoom - dragOffset.y;
      setNodes(prev => prev.map(n => n.id === draggingNode ? { ...n, position_x: x, position_y: y } : n));
    }
    if (connecting) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      setConnectMouse({
        x: (e.clientX - rect.left - pan.x) / zoom,
        y: (e.clientY - rect.top - pan.y) / zoom,
      });
    }
  };

  const handleCanvasMouseUp = () => {
    setIsPanning(false);
    setDraggingNode(null);
    if (connecting) setConnecting(null);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom(z => Math.max(0.3, Math.min(2, z + delta)));
  };

  const centerCanvas = () => {
    if (nodes.length === 0) { setPan({ x: 0, y: 0 }); return; }
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const avgX = nodes.reduce((s, n) => s + n.position_x, 0) / nodes.length;
    const avgY = nodes.reduce((s, n) => s + n.position_y, 0) / nodes.length;
    setPan({ x: rect.width / 2 - avgX * zoom, y: rect.height / 2 - avgY * zoom });
  };

  // ── Node operations ──

  const addNode = (type: string) => {
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const isFirst = nodes.length === 0;
    const newNode: BotNode = {
      id: tempId,
      bot_id: botId!,
      type,
      config: getDefaultConfig(type),
      position_x: 100 + Math.random() * 200,
      position_y: 100 + Math.random() * 200,
      is_start_node: isFirst,
      _temp: true,
    };

    // Auto-create outputs based on type
    const newOutputs: BotNodeOutput[] = [];
    if (type === "wait") {
      newOutputs.push({ id: `to_${Date.now()}_1`, node_id: tempId, label: "Respondeu", condition_type: "any_reply", condition_value: null, next_node_id: null, _temp: true });
      newOutputs.push({ id: `to_${Date.now()}_2`, node_id: tempId, label: "Timeout", condition_type: "timeout", condition_value: null, next_node_id: null, _temp: true });
    } else if (type === "condition") {
      newOutputs.push({ id: `to_${Date.now()}_1`, node_id: tempId, label: "Corresponde", condition_type: "field_match", condition_value: null, next_node_id: null, _temp: true });
      newOutputs.push({ id: `to_${Date.now()}_2`, node_id: tempId, label: "Não corresponde", condition_type: "field_no_match", condition_value: null, next_node_id: null, _temp: true });
    } else if (type !== "action_end_bot") {
      newOutputs.push({ id: `to_${Date.now()}_d`, node_id: tempId, label: "Próximo", condition_type: "default", condition_value: null, next_node_id: null, _temp: true });
    }

    setNodes(prev => [...prev, newNode]);
    setOutputs(prev => [...prev, ...newOutputs]);
    setShowAddMenu(false);
    setSelectedNode(tempId);
  };

  const deleteNode = (nodeId: string) => {
    setNodes(prev => prev.filter(n => n.id !== nodeId));
    setOutputs(prev => prev.filter(o => o.node_id !== nodeId && o.next_node_id !== nodeId).map(o => o.next_node_id === nodeId ? { ...o, next_node_id: null } : o));
    if (selectedNode === nodeId) setSelectedNode(null);
  };

  const setStartNode = (nodeId: string) => {
    setNodes(prev => prev.map(n => ({ ...n, is_start_node: n.id === nodeId })));
  };

  const updateNodeConfig = (nodeId: string, config: any) => {
    setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, config } : n));
  };

  // ── Connection operations ──

  const startConnection = (outputId: string, fromX: number, fromY: number) => {
    setConnecting({ outputId, fromX, fromY });
  };

  const completeConnection = (targetNodeId: string) => {
    if (!connecting) return;
    setOutputs(prev => prev.map(o => o.id === connecting.outputId ? { ...o, next_node_id: targetNodeId } : o));
    setConnecting(null);
  };

  const deleteConnection = (outputId: string) => {
    setOutputs(prev => prev.map(o => o.id === outputId ? { ...o, next_node_id: null } : o));
  };

  // ── Save ──

  const saveBot = async () => {
    if (!botId) return;
    setSaving(true);
    try {
      // Update bot name
      await supabase.from("bots").update({ name: botName }).eq("id", botId);

      // Delete existing nodes/outputs and re-insert
      const { data: existingNodes } = await supabase.from("bot_nodes").select("id").eq("bot_id", botId);
      if (existingNodes?.length) {
        const existingIds = existingNodes.map((n: any) => n.id);
        await supabase.from("bot_node_outputs").delete().in("node_id", existingIds);
        await supabase.from("bot_nodes").delete().eq("bot_id", botId);
      }

      if (nodes.length === 0) { toast.success("Bot salvo!"); setSaving(false); return; }

      // Map temp IDs to real UUIDs
      const idMap: Record<string, string> = {};
      const nodesForInsert = nodes.map(n => {
        const realId = crypto.randomUUID();
        idMap[n.id] = realId;
        return {
          id: realId,
          bot_id: botId,
          type: n.type,
          config: n.config,
          position_x: n.position_x,
          position_y: n.position_y,
          is_start_node: n.is_start_node,
        };
      });

      const { error: nodesErr } = await supabase.from("bot_nodes").insert(nodesForInsert);
      if (nodesErr) throw nodesErr;

      // Insert outputs with mapped IDs
      const outputsForInsert = outputs.map(o => ({
        id: crypto.randomUUID(),
        node_id: idMap[o.node_id] || o.node_id,
        label: o.label,
        condition_type: o.condition_type,
        condition_value: o.condition_value,
        next_node_id: o.next_node_id ? (idMap[o.next_node_id] || o.next_node_id) : null,
      }));

      if (outputsForInsert.length > 0) {
        const { error: outErr } = await supabase.from("bot_node_outputs").insert(outputsForInsert);
        if (outErr) throw outErr;
      }

      // Reload with real IDs
      await loadBot();
      toast.success("Bot salvo com sucesso!");
    } catch (err: any) {
      toast.error("Erro ao salvar: " + err.message);
    }
    setSaving(false);
  };

  const getDefaultConfig = (type: string): any => {
    switch (type) {
      case "message_text": return { message: "" };
      case "message_template": return { template_name: "", template_language: "pt_BR", template_components: [] };
      case "message_audio": return { audio_url: "" };
      case "wait": return { type: "both", hours: 4 };
      case "condition": return { field: "tags", operator: "equals", value: "" };
      case "action_move_stage": return { pipeline_id: "", stage_id: "" };
      case "action_set_field": return { field: "", value: "" };
      case "action_add_tag": return { tag: "", action: "add" };
      case "action_end_bot": return {};
      default: return {};
    }
  };

  // ── Render helpers ──

  const getNodeSummary = (node: BotNode): string => {
    const c = node.config || {};
    switch (node.type) {
      case "message_text": return c.message ? c.message.substring(0, 60) + (c.message.length > 60 ? "…" : "") : "Sem texto";
      case "message_template": return c.template_name || "Sem template";
      case "message_audio": return c.audio_url ? "Áudio configurado" : "Sem áudio";
      case "wait": return c.type === "reply" ? "Aguardar resposta" : c.type === "timeout" ? `Timeout: ${c.hours}h` : `Resposta ou ${c.hours}h`;
      case "condition": return `${c.field} ${c.operator} ${c.value}`;
      case "action_move_stage": { const st = stages.find(s => s.id === c.stage_id); return st ? `→ ${st.name}` : "Sem etapa"; }
      case "action_set_field": return c.field ? `${c.field} = ${c.value}` : "Sem campo";
      case "action_add_tag": return c.tag || "Sem tag";
      case "action_end_bot": return "Encerra o fluxo";
      default: return "";
    }
  };

  const nodeOutputs = (nodeId: string) => outputs.filter(o => o.node_id === nodeId);

  const selectedNodeData = nodes.find(n => n.id === selectedNode);

  if (!bot) return <div className="flex items-center justify-center h-64 text-muted-foreground">Carregando...</div>;

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] -m-6">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-card shrink-0">
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
        <div className="flex items-center gap-1 ml-auto">
          <Button variant="ghost" size="icon" onClick={() => setZoom(z => Math.min(2, z + 0.1))} title="Zoom In"><ZoomIn size={16} /></Button>
          <span className="text-xs text-muted-foreground w-10 text-center">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="icon" onClick={() => setZoom(z => Math.max(0.3, z - 0.1))} title="Zoom Out"><ZoomOut size={16} /></Button>
          <Button variant="ghost" size="icon" onClick={centerCanvas} title="Centralizar"><Maximize2 size={16} /></Button>
          <div className="w-px h-6 bg-border mx-1" />
          <div className="flex items-center gap-2 mr-2">
            <span className="text-xs text-muted-foreground">Ativo</span>
            <Switch checked={bot.active} onCheckedChange={async (v) => {
              await supabase.from("bots").update({ active: v }).eq("id", bot.id);
              setBot(prev => prev ? { ...prev, active: v } : prev);
            }} />
          </div>
          <Button size="sm" onClick={saveBot} disabled={saving} className="gap-1">
            <Save size={14} /> {saving ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Canvas */}
        <div
          ref={canvasRef}
          className="flex-1 overflow-hidden cursor-grab active:cursor-grabbing relative"
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
          onWheel={handleWheel}
          style={{ userSelect: "none" }}
        >
          {/* Grid background */}
          <svg className="absolute inset-0 w-full h-full canvas-bg pointer-events-none" style={{ zIndex: 0 }}>
            <defs>
              <pattern id="grid" width={20 * zoom} height={20 * zoom} patternUnits="userSpaceOnUse" x={pan.x % (20 * zoom)} y={pan.y % (20 * zoom)}>
                <circle cx={1} cy={1} r={1} fill="hsl(var(--muted-foreground) / 0.15)" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>

          {/* Transformed content */}
          <div style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "0 0", position: "absolute", top: 0, left: 0 }}>
            {/* Connection lines */}
            <svg className="absolute" style={{ width: 5000, height: 5000, top: -2500, left: -2500, pointerEvents: "none", overflow: "visible" }}>
              {outputs.filter(o => o.next_node_id).map(o => {
                const fromNode = nodes.find(n => n.id === o.node_id);
                const toNode = nodes.find(n => n.id === o.next_node_id);
                if (!fromNode || !toNode) return null;
                const fromX = fromNode.position_x + NODE_WIDTH;
                const fromY = fromNode.position_y + NODE_HEIGHT / 2;
                const toX = toNode.position_x;
                const toY = toNode.position_y + NODE_HEIGHT / 2;
                const midX = (fromX + toX) / 2;
                return (
                  <g key={o.id}>
                    <path
                      d={`M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`}
                      fill="none"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      markerEnd="url(#arrowhead)"
                    />
                    <text x={midX} y={(fromY + toY) / 2 - 8} textAnchor="middle" fontSize={10} fill="hsl(var(--muted-foreground))">{o.label}</text>
                    {/* Delete connection click area */}
                    <circle
                      cx={midX}
                      cy={(fromY + toY) / 2}
                      r={8}
                      fill="hsl(var(--destructive))"
                      opacity={0}
                      className="hover:opacity-100 cursor-pointer transition-opacity"
                      style={{ pointerEvents: "all" }}
                      onClick={() => deleteConnection(o.id)}
                    />
                  </g>
                );
              })}
              {/* Drawing connection */}
              {connecting && (
                <line x1={connecting.fromX} y1={connecting.fromY} x2={connectMouse.x} y2={connectMouse.y} stroke="hsl(var(--primary))" strokeWidth={2} strokeDasharray="6 4" />
              )}
              <defs>
                <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                  <polygon points="0 0, 10 3.5, 0 7" fill="hsl(var(--primary))" />
                </marker>
              </defs>
            </svg>

            {/* Nodes */}
            {nodes.map(node => {
              const Icon = NODE_ICONS[node.type] || Settings2;
              const color = NODE_COLORS[node.type] || "hsl(var(--muted))";
              const nodeOuts = nodeOutputs(node.id);
              return (
                <div
                  key={node.id}
                  className={`absolute rounded-lg border shadow-md bg-card cursor-move select-none transition-shadow ${selectedNode === node.id ? "ring-2 ring-primary shadow-lg" : ""}`}
                  style={{ left: node.position_x, top: node.position_y, width: NODE_WIDTH, minHeight: NODE_HEIGHT }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    if (connecting) { completeConnection(node.id); return; }
                    setDraggingNode(node.id);
                    const rect = canvasRef.current?.getBoundingClientRect();
                    if (rect) {
                      setDragOffset({
                        x: (e.clientX - rect.left - pan.x) / zoom - node.position_x,
                        y: (e.clientY - rect.top - pan.y) / zoom - node.position_y,
                      });
                    }
                  }}
                  onClick={(e) => { e.stopPropagation(); setSelectedNode(node.id); }}
                >
                  {/* Header */}
                  <div className="flex items-center gap-2 px-3 py-2 rounded-t-lg text-white text-xs font-medium" style={{ backgroundColor: color }}>
                    <Icon size={14} />
                    <span className="flex-1 truncate">{NODE_LABELS[node.type]}</span>
                    {node.is_start_node && <Badge className="bg-white/20 text-white text-[9px] px-1">INÍCIO</Badge>}
                    <button onClick={(e) => { e.stopPropagation(); deleteNode(node.id); }} className="opacity-60 hover:opacity-100">
                      <Trash2 size={12} />
                    </button>
                  </div>
                  {/* Body */}
                  <div className="px-3 py-2 text-xs text-muted-foreground line-clamp-2">
                    {getNodeSummary(node)}
                  </div>
                  {/* Outputs */}
                  <div className="px-2 pb-2 space-y-1">
                    {nodeOuts.map(o => (
                      <div key={o.id} className="flex items-center gap-1">
                        <div
                          className="w-3 h-3 rounded-full border-2 border-primary bg-card cursor-crosshair shrink-0"
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            const rect = canvasRef.current?.getBoundingClientRect();
                            if (!rect) return;
                            startConnection(o.id, node.position_x + NODE_WIDTH, node.position_y + NODE_HEIGHT / 2);
                          }}
                        />
                        <span className="text-[10px] text-muted-foreground truncate">{o.label}</span>
                        {o.next_node_id && (
                          <button onClick={(e) => { e.stopPropagation(); deleteConnection(o.id); }} className="text-destructive opacity-50 hover:opacity-100 ml-auto">
                            <XCircle size={10} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Add button */}
          <div className="absolute bottom-4 right-4 z-10">
            <div className="relative">
              <Button size="lg" className="rounded-full w-12 h-12 shadow-lg" onClick={() => setShowAddMenu(!showAddMenu)}>
                <Plus size={24} />
              </Button>
              {showAddMenu && (
                <div className="absolute bottom-14 right-0 bg-card border border-border rounded-lg shadow-xl p-3 w-56 space-y-2">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Mensagens</p>
                  <button onClick={() => addNode("message_text")} className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-muted transition-colors"><MessageSquare size={14} style={{ color: NODE_COLORS.message_text }} /> Texto</button>
                  <button onClick={() => addNode("message_template")} className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-muted transition-colors"><FileText size={14} style={{ color: NODE_COLORS.message_template }} /> Template WhatsApp</button>
                  <button onClick={() => addNode("message_audio")} className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-muted transition-colors"><Mic size={14} style={{ color: NODE_COLORS.message_audio }} /> Áudio</button>
                  <div className="border-t border-border my-1" />
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Lógica</p>
                  <button onClick={() => addNode("wait")} className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-muted transition-colors"><Clock size={14} style={{ color: NODE_COLORS.wait }} /> Espera / Condição</button>
                  <button onClick={() => addNode("condition")} className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-muted transition-colors"><GitBranch size={14} style={{ color: NODE_COLORS.condition }} /> Condição de Campo</button>
                  <div className="border-t border-border my-1" />
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Ações</p>
                  <button onClick={() => addNode("action_move_stage")} className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-muted transition-colors"><ArrowRightLeft size={14} style={{ color: NODE_COLORS.action_move_stage }} /> Mover Etapa</button>
                  <button onClick={() => addNode("action_set_field")} className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-muted transition-colors"><Settings2 size={14} style={{ color: NODE_COLORS.action_set_field }} /> Definir Campo</button>
                  <button onClick={() => addNode("action_add_tag")} className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-muted transition-colors"><Tag size={14} style={{ color: NODE_COLORS.action_add_tag }} /> Adicionar Tag</button>
                  <div className="border-t border-border my-1" />
                  <button onClick={() => addNode("action_end_bot")} className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-muted transition-colors"><XCircle size={14} style={{ color: NODE_COLORS.action_end_bot }} /> Encerrar Bot</button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Config Panel */}
        {selectedNodeData && (
          <div className="w-80 border-l border-border bg-card shrink-0 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="text-sm font-semibold">{NODE_LABELS[selectedNodeData.type]}</h3>
              <Button variant="ghost" size="icon" onClick={() => setSelectedNode(null)}><XCircle size={16} /></Button>
            </div>
            <ScrollArea className="flex-1 p-4">
              <NodeConfigPanel
                node={selectedNodeData}
                onUpdate={(config) => updateNodeConfig(selectedNodeData.id, config)}
                onSetStart={() => setStartNode(selectedNodeData.id)}
                pipelines={pipelines}
                stages={stages}
                templates={templates}
              />
            </ScrollArea>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Node Config Panel ──

function NodeConfigPanel({ node, onUpdate, onSetStart, pipelines, stages, templates }: {
  node: BotNode;
  onUpdate: (config: any) => void;
  onSetStart: () => void;
  pipelines: any[];
  stages: any[];
  templates: any[];
}) {
  const config = node.config || {};

  const update = (key: string, value: any) => {
    onUpdate({ ...config, [key]: value });
  };

  return (
    <div className="space-y-4">
      {!node.is_start_node && (
        <Button variant="outline" size="sm" className="w-full" onClick={onSetStart}>
          Definir como nó inicial
        </Button>
      )}

      {node.type === "message_text" && (
        <>
          <div>
            <Label className="text-xs">Mensagem</Label>
            <Textarea value={config.message || ""} onChange={e => update("message", e.target.value)} rows={5} placeholder="Digite a mensagem..." />
          </div>
          <div className="flex flex-wrap gap-1">
            {["{{nome}}", "{{telefone}}"].map(v => (
              <Badge key={v} variant="secondary" className="cursor-pointer text-xs" onClick={() => update("message", (config.message || "") + " " + v)}>
                {v}
              </Badge>
            ))}
          </div>
          {config.message && (
            <div className="bg-muted rounded p-2 text-xs">
              <p className="text-muted-foreground mb-1">Preview:</p>
              <p>{config.message.replace(/\{\{nome\}\}/g, "João").replace(/\{\{telefone\}\}/g, "5511999999999")}</p>
            </div>
          )}
        </>
      )}

      {node.type === "message_template" && (
        <>
          <div>
            <Label className="text-xs">Template aprovado</Label>
            <Select value={config.template_name || ""} onValueChange={v => update("template_name", v)}>
              <SelectTrigger><SelectValue placeholder="Selecionar template" /></SelectTrigger>
              <SelectContent>
                {templates.map(t => <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {config.template_name && (
            <div className="bg-muted rounded p-2 text-xs">
              <p className="text-muted-foreground">Template: {config.template_name}</p>
            </div>
          )}
        </>
      )}

      {node.type === "message_audio" && (
        <div>
          <Label className="text-xs">URL do áudio</Label>
          <Input value={config.audio_url || ""} onChange={e => update("audio_url", e.target.value)} placeholder="https://..." />
        </div>
      )}

      {node.type === "wait" && (
        <>
          <div>
            <Label className="text-xs">Tipo de espera</Label>
            <RadioGroup value={config.type || "both"} onValueChange={v => update("type", v)} className="mt-2 space-y-2">
              <div className="flex items-center gap-2"><RadioGroupItem value="reply" id="wr" /><Label htmlFor="wr" className="text-xs">Aguardar resposta</Label></div>
              <div className="flex items-center gap-2"><RadioGroupItem value="timeout" id="wt" /><Label htmlFor="wt" className="text-xs">Aguardar timeout</Label></div>
              <div className="flex items-center gap-2"><RadioGroupItem value="both" id="wb" /><Label htmlFor="wb" className="text-xs">Ambos (o que vier primeiro)</Label></div>
            </RadioGroup>
          </div>
          {(config.type === "timeout" || config.type === "both") && (
            <div>
              <Label className="text-xs">Horas de timeout</Label>
              <Input type="number" min={0.5} step={0.5} value={config.hours || 4} onChange={e => update("hours", parseFloat(e.target.value))} />
            </div>
          )}
        </>
      )}

      {node.type === "condition" && (
        <>
          <div>
            <Label className="text-xs">Campo</Label>
            <Select value={config.field || ""} onValueChange={v => update("field", v)}>
              <SelectTrigger><SelectValue placeholder="Campo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="tags">Tags</SelectItem>
                <SelectItem value="name">Nome</SelectItem>
                <SelectItem value="phone">Telefone</SelectItem>
                <SelectItem value="source">Origem</SelectItem>
                <SelectItem value="value">Valor</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Operador</Label>
            <Select value={config.operator || "equals"} onValueChange={v => update("operator", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="equals">É igual a</SelectItem>
                <SelectItem value="not_equals">Não é igual a</SelectItem>
                <SelectItem value="contains">Contém</SelectItem>
                <SelectItem value="greater_than">Maior que</SelectItem>
                <SelectItem value="less_than">Menor que</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Valor</Label>
            <Input value={config.value || ""} onChange={e => update("value", e.target.value)} placeholder="Valor para comparar" />
          </div>
        </>
      )}

      {node.type === "action_move_stage" && (
        <>
          <div>
            <Label className="text-xs">Funil</Label>
            <Select value={config.pipeline_id || ""} onValueChange={v => update("pipeline_id", v)}>
              <SelectTrigger><SelectValue placeholder="Selecionar funil" /></SelectTrigger>
              <SelectContent>
                {pipelines.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Etapa destino</Label>
            <Select value={config.stage_id || ""} onValueChange={v => update("stage_id", v)}>
              <SelectTrigger><SelectValue placeholder="Selecionar etapa" /></SelectTrigger>
              <SelectContent>
                {stages.filter(s => s.pipeline_id === config.pipeline_id).map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded p-2 text-xs text-yellow-600">
            ⚠️ O bot atual será cancelado e o bot da etapa destino será iniciado.
          </div>
        </>
      )}

      {node.type === "action_set_field" && (
        <>
          <div>
            <Label className="text-xs">Campo</Label>
            <Select value={config.field || ""} onValueChange={v => update("field", v)}>
              <SelectTrigger><SelectValue placeholder="Campo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Nome</SelectItem>
                <SelectItem value="source">Origem</SelectItem>
                <SelectItem value="notes">Observações</SelectItem>
                <SelectItem value="value">Valor</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Valor</Label>
            <Input value={config.value || ""} onChange={e => update("value", e.target.value)} placeholder="Valor" />
          </div>
        </>
      )}

      {node.type === "action_add_tag" && (
        <>
          <div>
            <Label className="text-xs">Tag</Label>
            <Input value={config.tag || ""} onChange={e => update("tag", e.target.value)} placeholder="Nome da tag" />
          </div>
        </>
      )}

      {node.type === "action_end_bot" && (
        <div className="bg-muted rounded p-3 text-xs text-muted-foreground">
          Este nó encerra completamente a execução do bot para o lead. Nenhuma ação adicional será executada.
        </div>
      )}
    </div>
  );
}

export default CrmBotEditor;
