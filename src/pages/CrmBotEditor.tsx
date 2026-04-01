import { useState, useCallback, useRef, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Node,
  type Edge,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Save, Upload, Undo2, Redo2 } from "lucide-react";

import BotNode from "@/components/bot-editor/BotNode";
import NodePalette from "@/components/bot-editor/NodePalette";
import NodePropertiesPanel from "@/components/bot-editor/NodePropertiesPanel";
import { NODE_DEFINITIONS } from "@/types/bot";

const nodeTypes: Record<string, any> = {};
NODE_DEFINITIONS.forEach((def) => {
  nodeTypes[def.type] = BotNode;
});

function BotEditorInner() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);

  const [botName, setBotName] = useState("Novo Bot");
  const [botStatus, setBotStatus] = useState("draft");
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // Undo/redo
  const historyRef = useRef<{ nodes: Node[]; edges: Edge[] }[]>([]);
  const historyIndexRef = useRef(-1);
  const skipHistoryRef = useRef(false);

  const pushHistory = useCallback(() => {
    if (skipHistoryRef.current) { skipHistoryRef.current = false; return; }
    const state = { nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) };
    historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    historyRef.current.push(state);
    if (historyRef.current.length > 50) historyRef.current.shift();
    historyIndexRef.current = historyRef.current.length - 1;
  }, [nodes, edges]);

  const undo = useCallback(() => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current--;
    const state = historyRef.current[historyIndexRef.current];
    skipHistoryRef.current = true;
    setNodes(state.nodes);
    setEdges(state.edges);
  }, [setNodes, setEdges]);

  const redo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current++;
    const state = historyRef.current[historyIndexRef.current];
    skipHistoryRef.current = true;
    setNodes(state.nodes);
    setEdges(state.edges);
  }, [setNodes, setEdges]);

  // Load bot
  useEffect(() => {
    if (!id) return;
    supabase.from("bots").select("*").eq("id", id).single().then(({ data, error }) => {
      if (error || !data) { toast.error("Bot não encontrado"); navigate("/crm/bots"); return; }
      setBotName(data.name);
      setBotStatus(data.status);
      const flow = data.flow_json as any;
      if (flow?.nodes) setNodes(flow.nodes);
      if (flow?.edges) setEdges(flow.edges);
      setLoading(false);
      // Init history
      historyRef.current = [{ nodes: flow?.nodes || [], edges: flow?.edges || [] }];
      historyIndexRef.current = 0;
    });
  }, [id]);

  // Push history on changes (debounced)
  useEffect(() => {
    if (loading) return;
    const t = setTimeout(pushHistory, 300);
    return () => clearTimeout(t);
  }, [nodes, edges, loading]);

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      setSelectedNode(null);
    },
    [setNodes, setEdges]
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); handleSave(); }
      if ((e.key === "Delete" || e.key === "Backspace") && !["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement)?.tagName)) {
        const selected = nodes.filter((n) => n.selected && n.type !== "start");
        if (selected.length > 0) {
          e.preventDefault();
          selected.forEach((n) => handleDeleteNode(n.id));
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo, nodes, edges, botName, handleDeleteNode]);

  const onConnect = useCallback(
    (params: Connection) => {
      const edgeStyle: Partial<Edge> = {};
      if (params.sourceHandle === "true") {
        edgeStyle.style = { stroke: "#22c55e" };
        edgeStyle.label = "Sim";
      } else if (params.sourceHandle === "false") {
        edgeStyle.style = { stroke: "#ef4444" };
        edgeStyle.label = "Não";
      } else if (params.sourceHandle === "reply") {
        edgeStyle.style = { stroke: "#22c55e" };
        edgeStyle.label = "Resposta";
      } else if (params.sourceHandle === "timeout") {
        edgeStyle.style = { stroke: "#f97316" };
        edgeStyle.label = "Timeout";
      }
      setEdges((eds) => addEdge({ ...params, type: "smoothstep", animated: true, ...edgeStyle }, eds));
    },
    [setEdges]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const nodeType = event.dataTransfer.getData("application/botnode");
      if (!nodeType || !reactFlowInstance) return;
      const def = NODE_DEFINITIONS.find((d) => d.type === nodeType);
      if (!def) return;
      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      const newNode: Node = {
        id: `${nodeType}-${Date.now()}`,
        type: nodeType,
        position,
        data: { ...def.defaultData, label: def.label },
      };
      setNodes((nds) => nds.concat(newNode));
    },
    [reactFlowInstance, setNodes]
  );

  const onNodeClick = useCallback((_: any, node: Node) => {
    setSelectedNode(node);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const handleNodeDataUpdate = useCallback(
    (nodeId: string, data: Record<string, any>) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data } : n))
      );
      setSelectedNode((prev) => (prev?.id === nodeId ? { ...prev, data } : prev));
    },
    [setNodes]
  );

  const handleSave = useCallback(async () => {
    if (!id) return;
    setSaving(true);
    const { error } = await supabase.from("bots").update({
      name: botName,
      flow_json: { nodes, edges },
    }).eq("id", id);
    setSaving(false);
    if (error) { toast.error("Erro ao salvar"); return; }
    toast.success("Bot salvo!");
  }, [id, botName, nodes, edges]);

  const handlePublish = useCallback(async () => {
    if (!id) return;
    // Save first
    await supabase.from("bots").update({
      name: botName,
      flow_json: { nodes, edges },
    }).eq("id", id);

    // Get current version
    const { data: bot } = await supabase.from("bots").select("current_version").eq("id", id).single();
    const newVersion = (bot?.current_version || 0) + 1;

    // Create version
    await supabase.from("bot_versions").insert({
      bot_id: id,
      version: newVersion,
      flow_json: { nodes, edges },
    });

    // Update bot status
    await supabase.from("bots").update({
      status: "published",
      current_version: newVersion,
    }).eq("id", id);

    setBotStatus("published");
    toast.success(`Bot publicado! Versão ${newVersion}`);
  }, [id, botName, nodes, edges]);

  if (loading) {
    return <div className="flex items-center justify-center h-full text-muted-foreground">Carregando editor...</div>;
  }

  return (
    <div className="flex flex-col h-full -m-6" style={{ height: "calc(100vh - 4rem)" }}>
      {/* Top Toolbar */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/crm/bots")}>
            <ArrowLeft size={18} />
          </Button>
          <Input
            value={botName}
            onChange={(e) => setBotName(e.target.value)}
            className="w-[200px] h-8 text-sm font-semibold bg-transparent border-transparent hover:border-border focus:border-border"
          />
          <span className="text-xs text-muted-foreground px-2 py-0.5 rounded bg-secondary">
            {botStatus === "published" ? "Publicado" : "Rascunho"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={undo} title="Desfazer (Ctrl+Z)">
            <Undo2 size={16} />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={redo} title="Refazer (Ctrl+Y)">
            <Redo2 size={16} />
          </Button>
          <Button variant="outline" size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
            <Save size={14} /> {saving ? "Salvando..." : "Salvar"}
          </Button>
          <Button size="sm" onClick={handlePublish} className="gap-1.5">
            <Upload size={14} /> Publicar
          </Button>
        </div>
      </div>

      {/* Editor Area */}
      <div className="flex flex-1 min-h-0">
        {/* Left: Palette */}
        <NodePalette />

        {/* Center: Canvas */}
        <div className="flex-1 min-w-0" ref={reactFlowWrapper}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onInit={setReactFlowInstance}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            fitView
            snapToGrid
            snapGrid={[16, 16]}
            deleteKeyCode="Delete"
            className="bot-editor-canvas"
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="hsl(var(--muted-foreground) / 0.15)" />
            <Controls className="!bg-card !border-border !shadow-lg [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-secondary" />
            <MiniMap
              nodeStrokeWidth={3}
              style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
              maskColor="hsl(var(--background) / 0.7)"
            />
          </ReactFlow>
        </div>

        {/* Right: Properties */}
        {selectedNode && (
          <NodePropertiesPanel
            node={selectedNode}
            onUpdate={handleNodeDataUpdate}
            onDelete={handleDeleteNode}
            onClose={() => setSelectedNode(null)}
          />
        )}
      </div>
    </div>
  );
}

export default function CrmBotEditor() {
  return (
    <ReactFlowProvider>
      <BotEditorInner />
    </ReactFlowProvider>
  );
}
