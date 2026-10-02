import { useState, useCallback, useRef, useEffect, useMemo } from "react";
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
  useUpdateNodeInternals,
  type Connection,
  type Node,
  type Edge,
  type NodeChange,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ArrowLeft, Save, Undo2, Redo2, Eye, Info, AlertTriangle, MoreHorizontal } from "lucide-react";
import { Smartphone } from "lucide-react";
import { useSnapLines, duplicateNode, type SnapLine } from "@/hooks/useBotEditorHelpers";
import {
  descreverModelosNaoAprovados, mensagemDeErroDoBot, modelosDoFluxo, modelosNaoAprovados,
  type StatusDoModelo,
} from "@/lib/bots";

import BotNode from "@/components/bot-editor/BotNode";
import DeletableEdge from "@/components/bot-editor/DeletableEdge";
import NodePalette from "@/components/bot-editor/NodePalette";
import NodePropertiesPanel from "@/components/bot-editor/NodePropertiesPanel";
import BotSimulator from "@/components/bot-editor/BotSimulator";
import { NODE_DEFINITIONS } from "@/types/bot";
import { cn } from "@/lib/utils";

const nodeTypes: Record<string, any> = {};
NODE_DEFINITIONS.forEach((def) => {
  nodeTypes[def.type] = BotNode;
});

const edgeTypes = { deletable: DeletableEdge };

// Rótulos do React Flow em PT-BR (CRC-22): os botões de zoom mostravam
// "Zoom In", "Fit View", "Toggle Interactivity" no title/aria-label.
// O React Flow manda a direção da seta em inglês ('up', 'down', 'left',
// 'right'); sem a tradução, o leitor de tela dizia "Bloco movido para left".
const DIRECAO_DA_SETA: Record<string, string> = { up: "cima", down: "baixo", left: "a esquerda", right: "a direita" };
const ROTULOS_DO_CANVAS = {
  "node.a11yDescription.default": "Pressione Enter ou Espaço para selecionar um bloco. Delete remove e Esc cancela.",
  "node.a11yDescription.keyboardDisabled": "Pressione Enter ou Espaço para selecionar um bloco. Depois, use as setas para movê-lo. Delete remove e Esc cancela.",
  "node.a11yDescription.ariaLiveMessage": ({ direction, x, y }: { direction: string; x: number; y: number }) =>
    `Bloco movido para ${DIRECAO_DA_SETA[direction] ?? "outra posição"}. Nova posição: x ${x}, y ${y}`,
  "edge.a11yDescription.default": "Pressione Enter ou Espaço para selecionar uma ligação. Depois, Delete remove e Esc cancela.",
  "controls.ariaLabel": "Controles do editor",
  "controls.zoomIn.ariaLabel": "Aproximar",
  "controls.zoomOut.ariaLabel": "Afastar",
  "controls.fitView.ariaLabel": "Ajustar à tela",
  "controls.interactive.ariaLabel": "Travar interação",
  "minimap.ariaLabel": "Minimapa",
  "handle.ariaLabel": "Conector",
};

/** Mesmo fluxo (nós e ligações), comparando o JSON do jeito que o banco devolve. */
function mesmoFluxo(a: unknown, b: unknown): boolean {
  const norm = (f: any) => JSON.stringify({ nodes: f?.nodes ?? [], edges: f?.edges ?? [] });
  return norm(a) === norm(b);
}

function BotEditorInner() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  // A SDR abre o editor pelo item "Ver fluxo" (CrmBots): ela lê os bots do
  // mundo do crc, mas a RESTRICTIVE sdr_sem_update_bots recusa a gravação —
  // salvar só devolveria "Seu perfil não tem permissão para editar este bot".
  // Aqui o botão some e o Ctrl+S não faz nada; o fluxo continua navegável.
  const { userRole } = useAuth();
  const podeSalvarBot = userRole !== "sdr";
  // Closer e recepção não operam Instagram (CLOSER_PREFIXES / RLS de
  // ig_accounts): o canal nem aparece para eles (CLO-13).
  const papelSemInstagram = userRole === "closer" || userRole === "recepcao";
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);
  const updateNodeInternals = useUpdateNodeInternals();

  const [botName, setBotName] = useState("Novo Bot");
  const [botDescription, setBotDescription] = useState("");
  const [botStatus, setBotStatus] = useState("draft");
  const [markAsRead, setMarkAsRead] = useState(true);
  const [channels, setChannels] = useState<string[]>(["whatsapp"]);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isDirty, setIsDirty] = useState(false);
  const [snapLines, setSnapLines] = useState<SnapLine[]>([]);
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);
  // Fluxo salvo que ainda não virou versão publicada: rascunho, ou "Salvar"
  // que não publicou (modelo não aprovado, falha na versão). Mantém o botão
  // Salvar ativo para tentar publicar de novo sem precisar mexer no fluxo.
  const [publicacaoPendente, setPublicacaoPendente] = useState(false);
  // Status dos modelos da Meta usados nos blocos (AUTO-29), pela chave dos ids.
  const [statusModelos, setStatusModelos] = useState<{ ids: string; mapa: Record<string, StatusDoModelo> }>({ ids: "", mapa: {} });
  const [instagramConectado, setInstagramConectado] = useState(false);
  const lastSavedRef = useRef<string>("");
  const { getSnapLines } = useSnapLines();

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
      setBotDescription(data.description || "");
      setBotStatus(data.status);
      setMarkAsRead((data as any).mark_as_read !== false);
      setChannels(Array.isArray((data as any).channels) && (data as any).channels.length ? (data as any).channels : ["whatsapp"]);
      const flow = data.flow_json as any;
      if (flow?.nodes) setNodes(flow.nodes);
      if (flow?.edges) setEdges(flow.edges);
      lastSavedRef.current = JSON.stringify({ nodes: flow?.nodes || [], edges: flow?.edges || [], botName: data.name, botDescription: data.description || "", markAsRead: (data as any).mark_as_read !== false, channels: (Array.isArray((data as any).channels) && (data as any).channels.length ? (data as any).channels : ["whatsapp"]) });
      setLoading(false);
      // Init history
      historyRef.current = [{ nodes: flow?.nodes || [], edges: flow?.edges || [] }];
      historyIndexRef.current = 0;
      // Rascunho, ou publicado com fluxo salvo diferente da versão no ar.
      if (data.status === "draft") {
        setPublicacaoPendente(true);
      } else if (data.status === "published" && (data.current_version || 0) > 0) {
        supabase.from("bot_versions").select("flow_json").eq("bot_id", id).eq("version", data.current_version).maybeSingle()
          .then(({ data: versao }) => {
            if (versao && !mesmoFluxo(versao.flow_json, flow)) setPublicacaoPendente(true);
          });
      }
    });
  }, [id]);

  // Canais oferecidos (CLO-13): WhatsApp sempre; Instagram só para quem opera
  // Instagram e com conta conectada e ativa no cliente (ig_accounts).
  useEffect(() => {
    if (papelSemInstagram) { setInstagramConectado(false); return; }
    let ativo = true;
    supabase.from("ig_accounts").select("id", { count: "exact", head: true }).eq("active", true)
      .then(({ count, error }) => { if (ativo) setInstagramConectado(!error && (count ?? 0) > 0); });
    return () => { ativo = false; };
  }, [papelSemInstagram]);

  const canaisOferecidos = useMemo(() => {
    const lista: { key: string; label: string }[] = [{ key: "whatsapp", label: "WhatsApp" }];
    // Bot que já roda no Instagram continua mostrando o canal (para poder
    // desligar), mesmo se a conta caiu.
    if (!papelSemInstagram && (instagramConectado || channels.includes("instagram"))) {
      lista.push({ key: "instagram", label: "Instagram" });
    }
    return lista;
  }, [papelSemInstagram, instagramConectado, channels]);

  const alternarCanal = useCallback((key: string) => {
    setChannels((prev) => {
      const next = prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key];
      return next.length ? next : prev; // sempre ao menos 1 canal
    });
  }, []);

  // Modelos da Meta usados nos blocos: status atual de cada um (AUTO-29).
  const idsModelos = useMemo(
    () => [...new Set(modelosDoFluxo(nodes as any).map((m) => m.templateId))].sort().join(","),
    [nodes],
  );
  useEffect(() => {
    if (!idsModelos) { setStatusModelos({ ids: "", mapa: {} }); return; }
    let ativo = true;
    supabase.from("crm_whatsapp_templates").select("id, name, status").in("id", idsModelos.split(","))
      .then(({ data, error }) => {
        if (!ativo || error) return;
        const mapa: Record<string, StatusDoModelo> = {};
        for (const t of data || []) mapa[(t as any).id] = { name: (t as any).name, status: (t as any).status };
        setStatusModelos({ ids: idsModelos, mapa });
      });
    return () => { ativo = false; };
  }, [idsModelos]);
  const modelosRuins = useMemo(
    () => (statusModelos.ids === idsModelos && idsModelos ? modelosNaoAprovados(nodes as any, statusModelos.mapa) : []),
    [nodes, statusModelos, idsModelos],
  );
  const nosComModeloRuim = useMemo(() => new Set(modelosRuins.map((m) => m.nodeId)), [modelosRuins]);

  // Push history on changes (debounced) + track dirty state
  useEffect(() => {
    if (loading) return;
    const t = setTimeout(pushHistory, 300);
    return () => clearTimeout(t);
  }, [nodes, edges, loading]);

  useEffect(() => {
    if (loading) return;
    const current = JSON.stringify({ nodes, edges, botName, botDescription, markAsRead, channels });
    setIsDirty(current !== lastSavedRef.current);
  }, [nodes, edges, botName, botDescription, markAsRead, channels, loading]);

  const handleDeleteEdge = useCallback(
    (edgeId: string) => {
      setEdges((eds) => eds.filter((e) => e.id !== edgeId));
    },
    [setEdges]
  );

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      setSelectedNode(null);
    },
    [setNodes, setEdges]
  );

  const handleDuplicateNode = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node || node.type === "start") return;
      const newNode = duplicateNode(node);
      setNodes((nds) => nds.concat(newNode));
      toast.success("Bloco duplicado");
    },
    [nodes, setNodes]
  );

  // Snap-aware node change handler
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChange(changes);
      const dragChange = changes.find((c) => c.type === "position" && c.dragging);
      if (dragChange && dragChange.type === "position" && dragChange.position) {
        const draggingNode = nodes.find((n) => n.id === dragChange.id);
        if (draggingNode) {
          const tempNode = { ...draggingNode, position: dragChange.position };
          const { snapLines: lines, snappedPosition } = getSnapLines(tempNode, nodes);
          setSnapLines(lines);
          if (snappedPosition.x !== dragChange.position.x || snappedPosition.y !== dragChange.position.y) {
            setNodes((nds) =>
              nds.map((n) => n.id === dragChange.id ? { ...n, position: snappedPosition } : n)
            );
          }
        }
      } else {
        const hasDrag = changes.some((c) => c.type === "position" && c.dragging);
        if (!hasDrag) setSnapLines([]);
      }
    },
    [onNodesChange, nodes, getSnapLines, setNodes]
  );

  // Ctrl+S chama SEMPRE o handleSave do render atual (AUTO-32): o listener é
  // registrado com dependências que não incluem nome, descrição, canais e
  // "Marcar como lida", e o isDirty só vira true num render seguinte — com a
  // função capturada no registro, o primeiro Ctrl+S saía calado.
  const saveRef = useRef<() => void>(() => {});

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); saveRef.current(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "d") {
        e.preventDefault();
        const selected = nodes.find((n) => n.selected && n.type !== "start");
        if (selected) handleDuplicateNode(selected.id);
      }
      if ((e.key === "Delete" || e.key === "Backspace") && !["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement)?.tagName)) {
        const selectedEdges = edges.filter((e) => e.selected);
        if (selectedEdges.length > 0) {
          e.preventDefault();
          selectedEdges.forEach((ed) => handleDeleteEdge(ed.id));
          return;
        }
        const selected = nodes.filter((n) => n.selected && n.type !== "start");
        if (selected.length > 0) {
          e.preventDefault();
          selected.forEach((n) => handleDeleteNode(n.id));
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo, nodes, edges, botName, handleDeleteNode, handleDeleteEdge, handleDuplicateNode]);

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
        edgeStyle.style = { stroke: "hsl(var(--warning))" };
        edgeStyle.label = "Timeout";
      }
      setEdges((eds) => addEdge({ ...params, type: "deletable", animated: true, ...edgeStyle }, eds));
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
      // Force ReactFlow to recalculate handles for dynamic outputs (menu items, template buttons)
      setTimeout(() => updateNodeInternals(nodeId), 0);
    },
    [setNodes, updateNodeInternals]
  );

  const handleSave = useCallback(async () => {
    // Sem poder salvar (SDR), o Ctrl+S não pode ficar mudo: ela mexeria no
    // fluxo do CRC e perderia o trabalho ao sair sem nenhum aviso.
    if (!podeSalvarBot) {
      toast.info("Os bots pertencem ao CRC. Aqui você só consegue ver o fluxo.");
      return;
    }
    if (!id || saving) return;
    if (botStatus === "archived") {
      toast.info("Este bot está arquivado. Restaure-o na lista de Bots para editar e publicar.");
      return;
    }
    const atual = JSON.stringify({ nodes, edges, botName, botDescription, markAsRead, channels });
    const semMudanca = atual === lastSavedRef.current;
    if (semMudanca && !publicacaoPendente) {
      toast.info("Nenhuma alteração para salvar.");
      return;
    }
    if (!botName.trim()) {
      toast.error("Dê um nome ao bot antes de salvar.");
      return;
    }
    setSaving(true);
    try {
      // Modelos da Meta: confere o status AGORA (pode ter mudado desde que o
      // editor abriu). Modelo não aprovado não publica (AUTO-29).
      const ids = [...new Set(modelosDoFluxo(nodes as any).map((m) => m.templateId))].sort();
      let ruins: ReturnType<typeof modelosNaoAprovados> = [];
      if (ids.length) {
        const { data: tpls, error: tplErr } = await supabase
          .from("crm_whatsapp_templates").select("id, name, status").in("id", ids);
        if (tplErr) {
          toast.error(mensagemDeErroDoBot(tplErr, "Não foi possível conferir os modelos usados no bot. Tente de novo."));
          return;
        }
        const mapa: Record<string, StatusDoModelo> = {};
        for (const t of tpls || []) mapa[(t as any).id] = { name: (t as any).name, status: (t as any).status };
        setStatusModelos({ ids: ids.join(","), mapa });
        ruins = modelosNaoAprovados(nodes as any, mapa);
      }

      // Save flow
      // RLS que barra o update devolve sucesso com 0 linhas — o .select() torna isso visível.
      if (!semMudanca) {
        const { data: saved, error } = await supabase.from("bots").update({
          name: botName.trim(),
          description: botDescription,
          flow_json: { nodes, edges },
          mark_as_read: markAsRead,
          channels,
        } as any).eq("id", id).select("id");

        if (error) { toast.error(mensagemDeErroDoBot(error, "Não foi possível salvar o bot. Tente de novo.")); return; }
        if (!saved || saved.length === 0) {
          toast.error("Seu perfil não tem permissão para editar este bot.");
          return;
        }
        lastSavedRef.current = atual;
        setIsDirty(false);
      }

      if (ruins.length > 0) {
        setPublicacaoPendente(true);
        toast.error(
          `Fluxo salvo, mas NÃO publicado. ${descreverModelosNaoAprovados(ruins)} ` +
          (botStatus === "published"
            ? "Os pacientes continuam recebendo a versão publicada anterior."
            : "O bot continua em rascunho."),
          { duration: 10000 },
        );
        return;
      }

      // Auto-publish: create version
      const { data: bot, error: botErr } = await supabase.from("bots").select("current_version").eq("id", id).single();
      if (botErr) {
        setPublicacaoPendente(true);
        toast.error(`O fluxo foi salvo, mas a publicação falhou: ${mensagemDeErroDoBot(botErr, "tente de novo.")}`);
        return;
      }
      const newVersion = (bot?.current_version || 0) + 1;

      const { error: versionErr } = await supabase.from("bot_versions").insert({
        bot_id: id,
        version: newVersion,
        flow_json: { nodes, edges },
      });
      if (versionErr) {
        setPublicacaoPendente(true);
        toast.error(`O fluxo foi salvo, mas a publicação falhou: ${mensagemDeErroDoBot(versionErr, "tente de novo.")}`);
        return;
      }

      const { data: published, error: publishErr } = await supabase.from("bots").update({
        status: "published",
        current_version: newVersion,
      }).eq("id", id).select("id");
      if (publishErr) {
        setPublicacaoPendente(true);
        toast.error(`O fluxo foi salvo, mas a publicação falhou: ${mensagemDeErroDoBot(publishErr, "tente de novo.")}`);
        return;
      }
      if (!published || published.length === 0) {
        setPublicacaoPendente(true);
        toast.error("Seu perfil não tem permissão para publicar este bot.");
        return;
      }

      setBotStatus("published");
      setPublicacaoPendente(false);
      toast.success(`Bot salvo e publicado! Versão ${newVersion}`);
    } finally {
      setSaving(false);
    }
  }, [id, saving, botStatus, publicacaoPendente, podeSalvarBot, botName, botDescription, nodes, edges, markAsRead, channels]);
  saveRef.current = () => { void handleSave(); };

  // Leva o foco ao 1º bloco com modelo não aprovado (aviso da barra).
  const irParaBloco = useCallback((nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    setSimulatorOpen(false);
    setSelectedNode(node);
    reactFlowInstance?.setCenter(
      node.position.x + (node.measured?.width ?? 250) / 2,
      node.position.y + (node.measured?.height ?? 80) / 2,
      { duration: 400, zoom: 1.2 },
    );
  }, [nodes, reactFlowInstance]);

  const handleHighlightNode = useCallback((nodeId: string | null) => {
    setHighlightedNodeId(nodeId);
    if (nodeId && reactFlowInstance) {
      const node = nodes.find((n) => n.id === nodeId);
      if (node) {
        reactFlowInstance.setCenter(
          node.position.x + (node.measured?.width ?? 250) / 2,
          node.position.y + (node.measured?.height ?? 80) / 2,
          { duration: 400, zoom: 1.2 }
        );
      }
    }
  }, [reactFlowInstance, nodes]);

  if (loading) {
    return <div className="flex items-center justify-center h-full text-sm font-medium text-muted-foreground">Carregando editor...</div>;
  }

  const rotuloStatus =
    botStatus === "archived" ? "Arquivado"
    : botStatus === "published" ? (publicacaoPendente ? "Publicado · alterações não publicadas" : "Publicado")
    : "Rascunho";
  const podeClicarSalvar = !saving && (isDirty || publicacaoPendente) && botStatus !== "archived";

  const chipsDeCanal = (
    <div
      className="flex items-center gap-1 h-9 pl-3 pr-1 rounded-full border border-border/60 bg-surface-sunken"
      title="Em quais canais este bot pode rodar. O bot só executa se o lead for do canal marcado."
    >
      <span className="text-xs font-medium text-muted-foreground mr-1">Canais:</span>
      {canaisOferecidos.map((c) => {
        const on = channels.includes(c.key);
        return (
          <button
            key={c.key}
            type="button"
            disabled={!podeSalvarBot}
            aria-pressed={on}
            onClick={() => alternarCanal(c.key)}
            className={`h-7 text-xs font-medium px-3 rounded-full border transition-colors ${on ? "border-primary/20 bg-primary-soft text-primary-soft-fg" : "bg-card text-muted-foreground border-border/60 hover:bg-muted"}`}
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="flex flex-col h-full -m-2 sm:-m-4 lg:-m-6 bg-surface-sunken" style={{ height: "calc(100vh - 4rem)" }}>
      {/* Top Toolbar — quebra em duas linhas quando falta espaço (CLO-05):
          Salvar e Pré-visualizar ficam sempre visíveis; abaixo de 1536 px,
          "Canais" e "Marcar como lida" vão para o menu ⋯ (medido: com a barra
          lateral aberta, em 1440 px os chips só cabiam numa 2ª linha).
          O grupo da esquerda NÃO tem base fixa (grow + basis auto): a quebra
          de linha é calculada com a largura real do conteúdo (voltar + nome +
          descrição mínima + status). Com base de 280 px, o flex-wrap achava
          que cabia e o status passava por cima dos botões da direita. Sozinho
          numa linha estreita (celular), o nome encolhe até 96 px e o status
          trunca. */}
      <div className="flex-shrink-0 flex flex-wrap items-center gap-x-3 gap-y-2 min-h-16 px-3 sm:px-4 py-2.5 border-b border-border/60 bg-card">
        <div className="flex items-center gap-2 min-w-0 grow basis-auto">
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0 rounded-xl border-border/60 text-muted-foreground hover:text-foreground"
            onClick={() => navigate("/crm/bots")}
            title="Voltar para a lista de bots"
            aria-label="Voltar para a lista de bots"
          >
            <ArrowLeft size={18} />
          </Button>
          <Input
            value={botName}
            onChange={(e) => setBotName(e.target.value)}
            aria-label="Nome do bot"
            title={botName || undefined}
            className="w-[180px] min-w-[96px] shrink h-9 px-2 text-base font-bold tracking-tight bg-transparent border-transparent shadow-none hover:border-border focus:border-border"
          />
          {/* w-0 + flex-1: a descrição entra no cálculo da quebra só com o
              mínimo (80 px) e ocupa o que sobrar da linha. */}
          <Input
            value={botDescription}
            onChange={(e) => setBotDescription(e.target.value)}
            placeholder="Descrição do bot (opcional)"
            aria-label="Descrição do bot"
            title={botDescription || undefined}
            className="w-0 min-w-[80px] flex-1 h-9 px-2 text-[13px] truncate bg-transparent border-transparent shadow-none hover:border-border focus:border-border text-muted-foreground"
          />
          <span
            title={rotuloStatus}
            className={cn(
              "h-7 min-w-[4.5rem] shrink truncate whitespace-nowrap rounded-full px-2.5 text-xs font-medium leading-7 before:mr-1.5 before:inline-block before:h-1.5 before:w-1.5 before:rounded-full before:bg-current before:align-middle before:content-['']",
              botStatus === "published"
                ? (publicacaoPendente ? "bg-warning-soft text-warning-soft-foreground" : "bg-success-soft text-success-soft-foreground")
                : "bg-slate-soft text-slate-soft-foreground",
            )}
          >
            {rotuloStatus}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-auto">
          <div className="hidden min-[1536px]:flex">{chipsDeCanal}</div>
          <TooltipProvider delayDuration={200}>
            <div className="hidden min-[1536px]:flex items-center gap-2 h-9 px-3 rounded-full border border-border/60 bg-surface-sunken">
              <Switch
                id="mark-as-read"
                checked={markAsRead}
                onCheckedChange={setMarkAsRead}
                disabled={!podeSalvarBot}
                className="scale-75"
              />
              <Label htmlFor="mark-as-read" className="text-xs font-medium cursor-pointer flex items-center gap-1 whitespace-nowrap">
                <Eye size={12} />
                Marcar como lida
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info size={12} className="text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs">
                    Quando ativado, mensagens enviadas pelo bot marcam a conversa como respondida.
                    Desative para que o lead continue aparecendo como "aguardando resposta" mesmo após o bot interagir.
                  </TooltipContent>
                </Tooltip>
              </Label>
            </div>
          </TooltipProvider>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 rounded-lg min-[1536px]:hidden"
                title="Canais e leitura das mensagens"
                aria-label="Canais e leitura das mensagens"
              >
                <MoreHorizontal size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 rounded-xl">
              <DropdownMenuLabel className="text-xs">Canais em que o bot roda</DropdownMenuLabel>
              {canaisOferecidos.map((c) => {
                const on = channels.includes(c.key);
                return (
                  <DropdownMenuCheckboxItem
                    key={c.key}
                    checked={on}
                    disabled={!podeSalvarBot || (on && channels.length === 1)}
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={() => alternarCanal(c.key)}
                  >
                    {c.label}
                  </DropdownMenuCheckboxItem>
                );
              })}
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={markAsRead}
                disabled={!podeSalvarBot}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={(v) => setMarkAsRead(!!v)}
              >
                Marcar como lida
              </DropdownMenuCheckboxItem>
              <p className="px-2 pb-1.5 pt-0.5 text-[11px] leading-snug text-muted-foreground">
                Ligado: as mensagens do bot marcam a conversa como respondida. Desligado: o lead continua como "aguardando resposta".
              </p>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 rounded-lg" onClick={undo} title="Desfazer (Ctrl+Z)" aria-label="Desfazer">
            <Undo2 size={16} />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 rounded-lg" onClick={redo} title="Refazer (Ctrl+Y)" aria-label="Refazer">
            <Redo2 size={16} />
          </Button>
          {podeSalvarBot ? (
            <Button
              size="sm"
              onClick={() => { void handleSave(); }}
              disabled={!podeClicarSalvar}
              title="Salvar e publicar (Ctrl+S)"
              className={`h-9 px-4 gap-1.5 shrink-0 rounded-xl ${!podeClicarSalvar ? "opacity-50" : "shadow-crm-brand"}`}
            >
              <Save size={14} /> {saving ? "Salvando..." : "Salvar"}
            </Button>
          ) : (
            <span className="inline-flex h-7 items-center shrink-0 text-xs font-medium text-slate-soft-foreground px-3 rounded-full bg-slate-soft">
              Somente leitura
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setSimulatorOpen(!simulatorOpen); setSelectedNode(null); }}
            className={`h-9 px-3 gap-1.5 shrink-0 rounded-xl border-border/60 ${simulatorOpen ? "bg-primary-soft text-primary-soft-fg border-primary/30" : ""}`}
            title="Pré-visualizar bot"
          >
            <Smartphone size={14} /> <span className="hidden sm:inline">Pré-visualizar bot</span>
          </Button>
        </div>
      </div>

      {/* Modelo da Meta que deixou de ser aprovado (AUTO-29): o bot não é
          publicado enquanto algum bloco usar um. */}
      {modelosRuins.length > 0 && (
        <div className="flex-shrink-0 flex items-start gap-2 px-4 py-2.5 border-b border-destructive/30 bg-destructive-soft text-xs text-destructive-soft-foreground" role="alert">
          <AlertTriangle size={14} className="text-destructive shrink-0 mt-0.5" />
          <span className="flex-1 min-w-0">
            {descreverModelosNaoAprovados(modelosRuins)} O bot não é publicado enquanto isso não for corrigido.
          </span>
          <button
            type="button"
            className="shrink-0 font-medium text-primary hover:underline"
            onClick={() => irParaBloco(modelosRuins[0].nodeId)}
          >
            Ver bloco
          </button>
        </div>
      )}

      {/* Editor Area */}
      <div className="flex flex-1 min-h-0">
        {/* Left: Palette */}
        <NodePalette />

        {/* Center: Canvas */}
        <div className="flex-1 min-w-0 bg-surface-sunken" ref={reactFlowWrapper}>
          <ReactFlow
            proOptions={{ hideAttribution: true }}
            nodes={nodes.map((n) => ({
              ...n,
              // Bloco com modelo não aprovado: contorno vermelho e dica ao passar
              // o mouse (só na tela; não vai para o fluxo salvo).
              ...(nosComModeloRuim.has(n.id)
                ? {
                    style: { ...(n.style || {}), outline: "2px solid hsl(var(--destructive))", outlineOffset: 3, borderRadius: 10 },
                    domAttributes: { title: "Modelo não aprovado pela Meta — troque o modelo deste bloco" },
                  }
                : {}),
              data: { ...n.data, onDuplicate: handleDuplicateNode, onDeleteNode: handleDeleteNode, _highlighted: n.id === highlightedNodeId },
            }))}
            edges={edges.map((e) => ({ ...e, data: { ...e.data, onDelete: handleDeleteEdge } }))}
            onNodesChange={handleNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onInit={setReactFlowInstance}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            /* Quem não pode salvar (SDR) enxerga o fluxo, mas não move nada:
               canvas inerte em vez de um editor que perde o trabalho. */
            nodesDraggable={podeSalvarBot}
            nodesConnectable={podeSalvarBot}
            elementsSelectable={podeSalvarBot}
            edgesReconnectable={podeSalvarBot}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            snapToGrid
            snapGrid={[16, 16]}
            deleteKeyCode={podeSalvarBot ? "Delete" : null}
            ariaLabelConfig={ROTULOS_DO_CANVAS}
            className="bot-editor-canvas [&_.react-flow\_\_background-pattern]:!fill-[hsl(var(--border))]"
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="hsl(var(--muted-foreground) / 0.15)" />
            <Controls className="!bg-card !border !border-border/60 !rounded-xl !shadow-float overflow-hidden [&>button]:!bg-card [&>button]:!border-border/60 [&>button]:!text-foreground [&>button]:!w-8 [&>button]:!h-8 [&>button:hover]:!bg-secondary [&>button>svg]:!fill-current" />
            <MiniMap
              className="!rounded-xl overflow-hidden !shadow-float"
              nodeStrokeWidth={3}
              style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
              maskColor="hsl(var(--background) / 0.7)"
            />
            {/* Snap alignment lines */}
            <svg className="react-flow__edges" style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 1000 }}>
              {snapLines.map((line, i) =>
                line.type === "vertical" ? (
                  <line key={i} x1={line.position} y1={-10000} x2={line.position} y2={10000} stroke="hsl(var(--primary))" strokeWidth={1} strokeDasharray="4 4" opacity={0.6} />
                ) : (
                  <line key={i} x1={-10000} y1={line.position} x2={10000} y2={line.position} stroke="hsl(var(--primary))" strokeWidth={1} strokeDasharray="4 4" opacity={0.6} />
                )
              )}
            </svg>
          </ReactFlow>
        </div>

        {/* Right: Properties */}
        {simulatorOpen && (
          <BotSimulator
            nodes={nodes}
            edges={edges}
            onHighlightNode={handleHighlightNode}
            onClose={() => { setSimulatorOpen(false); setHighlightedNodeId(null); }}
          />
        )}

        {selectedNode && !simulatorOpen && podeSalvarBot && (
          <NodePropertiesPanel
            node={selectedNode}
            allNodes={nodes}
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
