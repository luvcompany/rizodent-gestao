import { useState, useCallback, useRef, useEffect } from "react";
import { X, Send, RotateCcw, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { NODE_DEFINITIONS } from "@/types/bot";
import type { Node, Edge } from "@xyflow/react";

type SimMessage = {
  id: string;
  from: "bot" | "user";
  content: string;
  type?: "text" | "menu" | "system" | "audio" | "file";
  buttons?: { id: string; title: string }[];
  listSections?: { title: string; rows: { id: string; title: string; description?: string }[] }[];
  menuType?: "buttons" | "list";
  buttonLabel?: string;
};

type Props = {
  nodes: Node[];
  edges: Edge[];
  onHighlightNode: (nodeId: string | null) => void;
  onClose: () => void;
};

export default function BotSimulator({ nodes, edges, onHighlightNode, onClose }: Props) {
  const [messages, setMessages] = useState<SimMessage[]>([]);
  const [input, setInput] = useState("");
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);
  const [waitingReply, setWaitingReply] = useState(false);
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [isRunning, setIsRunning] = useState(false);
  const [waitingMenuNode, setWaitingMenuNode] = useState<Node | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const processingRef = useRef(false);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }, 50);
  }, []);

  const replaceVars = useCallback((text: string) => {
    if (!text) return text;
    const replacements: Record<string, string> = {
      "lead.nome": "João Silva",
      "lead.name": "João Silva",
      "lead.telefone": "11999999999",
      "lead.phone": "11999999999",
      "lead.origem": "WhatsApp",
      "lead.source": "WhatsApp",
      "data.hoje": new Date().toLocaleDateString("pt-BR"),
      "data.hora": new Date().toLocaleTimeString("pt-BR"),
      "resposta.ultima": variables.last_reply || "",
      last_reply: variables.last_reply || "",
      ...variables,
    };
    return Object.entries(replacements).reduce((result, [key, value]) => {
      const bp = new RegExp(`\\[${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]`, "gi");
      const mp = new RegExp(`\\{\\{\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\}\\}`, "gi");
      return result.replace(bp, value).replace(mp, value);
    }, text);
  }, [variables]);

  const addMessage = useCallback((msg: Omit<SimMessage, "id">) => {
    const newMsg = { ...msg, id: `sim-${Date.now()}-${Math.random()}` };
    setMessages((prev) => [...prev, newMsg]);
    scrollToBottom();
    return newMsg;
  }, [scrollToBottom]);

  const findNextNode = useCallback((fromNodeId: string, handleId?: string | null) => {
    let edge;
    if (handleId) {
      edge = edges.find((e) => e.source === fromNodeId && e.sourceHandle === handleId);
    }
    if (!edge) {
      edge = edges.find((e) => e.source === fromNodeId && (!e.sourceHandle || e.sourceHandle === null));
    }
    return edge?.target || null;
  }, [edges]);

  const processNode = useCallback(async (nodeId: string, vars: Record<string, string>) => {
    if (processingRef.current) return;
    processingRef.current = true;

    const node = nodes.find((n) => n.id === nodeId);
    if (!node) { processingRef.current = false; return; }

    setCurrentNodeId(nodeId);
    onHighlightNode(nodeId);

    const data = node.data || {};
    const def = NODE_DEFINITIONS.find((d) => d.type === node.type);

    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

    switch (node.type) {
      case "start": {
        const nextId = findNextNode(nodeId);
        processingRef.current = false;
        if (nextId) await processNode(nextId, vars);
        return;
      }

      case "send_text": {
        if (data.templateId && data.templateName) {
          addMessage({ from: "bot", content: `📄 Modelo: ${String(data.templateName)}`, type: "text" });
          if (Array.isArray(data.templateButtons) && data.templateButtons.length > 0) {
            addMessage({
              from: "bot",
              content: replaceVars(String(data.text || data.templateName)),
              type: "menu",
              buttons: data.templateButtons as any[],
              menuType: "buttons",
            });
            setWaitingReply(true);
            setWaitingMenuNode(node);
            processingRef.current = false;
            return;
          }
        } else {
          const text = replaceVars(String(data.text || ""));
          if (text) addMessage({ from: "bot", content: text, type: "text" });
        }
        await delay(500);
        const nextId = findNextNode(nodeId);
        processingRef.current = false;
        if (nextId) await processNode(nextId, vars);
        return;
      }

      case "send_audio": {
        const audioUrl = data.audioUrl ? String(data.audioUrl) : null;
        addMessage({ from: "bot", content: audioUrl || "🎵 Áudio de voz", type: "audio" });
        await delay(500);
        const nextId = findNextNode(nodeId);
        processingRef.current = false;
        if (nextId) await processNode(nextId, vars);
        return;
      }

      case "send_file": {
        const caption = replaceVars(String(data.caption || ""));
        const fileType = String(data.fileType || "document");
        const fileUrl = data.fileUrl ? String(data.fileUrl) : null;
        const icon = fileType === "image" ? "🖼️" : fileType === "video" ? "🎬" : "📄";
        addMessage({ from: "bot", content: fileUrl || `${icon} Arquivo${caption ? `: ${caption}` : ""}`, type: fileType === "image" ? "image" as any : "file" });
        await delay(500);
        const nextId = findNextNode(nodeId);
        processingRef.current = false;
        if (nextId) await processNode(nextId, vars);
        return;
      }

      case "send_menu": {
        const body = replaceVars(String(data.bodyText || data.body || data.text || "Escolha uma opção:"));
        const menuType = String(data.menuType || "buttons") as "buttons" | "list";
        const buttons = (data.buttons as any[]) || [];
        const listSections = (data.listSections as any[]) || [];

        addMessage({
          from: "bot",
          content: body,
          type: "menu",
          buttons: menuType === "buttons" ? buttons : undefined,
          listSections: menuType === "list" ? listSections : undefined,
          menuType,
          buttonLabel: String(data.buttonLabel || "Ver opções"),
        });
        setWaitingReply(true);
        setWaitingMenuNode(node);
        processingRef.current = false;
        return;
      }

      case "wait_reply": {
        const fieldName = data.saveToField ? String(data.saveToField) : null;
        addMessage({ from: "bot", content: fieldName ? `💾 Aguardando resposta → salvar em [${fieldName}]` : "💾 Aguardando resposta...", type: "system" });
        setWaitingReply(true);
        setWaitingMenuNode(null);
        processingRef.current = false;
        return;
      }

      case "delay": {
        const amount = Number(data.delaySeconds || 5);
        const unit = String(data.unit || "seconds");
        const label = `${amount} ${unit === "minutes" ? "min" : unit === "hours" ? "h" : "s"}`;
        addMessage({ from: "bot", content: `⏸️ Pausa de ${label}`, type: "system" });
        await delay(800);
        const nextId = findNextNode(nodeId);
        processingRef.current = false;
        if (nextId) await processNode(nextId, vars);
        return;
      }

      case "condition": {
        const field = String(data.field || "");
        const operator = String(data.operator || "equals");
        const condValue = String(data.value || "");
        let fieldValue = "";
        if (field === "last_reply") fieldValue = vars.last_reply || "";
        else if (field === "lead.name") fieldValue = "João Silva";
        else if (field === "lead.source") fieldValue = "WhatsApp";

        let result = false;
        switch (operator) {
          case "equals": result = fieldValue === condValue; break;
          case "not_equals": result = fieldValue !== condValue; break;
          case "contains": result = fieldValue.toLowerCase().includes(condValue.toLowerCase()); break;
          case "is_empty": result = !fieldValue.trim(); break;
          case "not_empty": result = !!fieldValue.trim(); break;
          default: result = false;
        }

        addMessage({ from: "bot", content: `🔀 Condição: ${result ? "✅ Sim" : "❌ Não"}`, type: "system" });
        const handle = result ? "true" : "false";
        const nextId = findNextNode(nodeId, handle);
        processingRef.current = false;
        if (nextId) await processNode(nextId, vars);
        return;
      }

      case "move_stage": {
        addMessage({ from: "bot", content: "📌 Lead movido para outra etapa", type: "system" });
        await delay(300);
        const nextId = findNextNode(nodeId);
        processingRef.current = false;
        if (nextId) await processNode(nextId, vars);
        return;
      }

      case "add_tag": {
        addMessage({ from: "bot", content: `🏷️ Tag adicionada: ${data.tag || ""}`, type: "system" });
        await delay(300);
        const nextId = findNextNode(nodeId);
        processingRef.current = false;
        if (nextId) await processNode(nextId, vars);
        return;
      }

      case "remove_tag": {
        addMessage({ from: "bot", content: `🏷️ Tag removida: ${data.tag || ""}`, type: "system" });
        await delay(300);
        const nextId = findNextNode(nodeId);
        processingRef.current = false;
        if (nextId) await processNode(nextId, vars);
        return;
      }

      case "add_note": {
        addMessage({ from: "bot", content: `📝 Nota: ${replaceVars(String(data.note || ""))}`, type: "system" });
        await delay(300);
        const nextId = findNextNode(nodeId);
        processingRef.current = false;
        if (nextId) await processNode(nextId, vars);
        return;
      }

      case "create_task": {
        addMessage({ from: "bot", content: `✅ Tarefa criada: ${replaceVars(String(data.title || ""))}`, type: "system" });
        await delay(300);
        const nextId = findNextNode(nodeId);
        processingRef.current = false;
        if (nextId) await processNode(nextId, vars);
        return;
      }

      case "transfer_human": {
        addMessage({ from: "bot", content: "👤 Transferido para atendente humano", type: "system" });
        setIsRunning(false);
        processingRef.current = false;
        return;
      }

      case "schedule": {
        addMessage({ from: "bot", content: `📅 Mensagem programada`, type: "system" });
        await delay(300);
        const nextId = findNextNode(nodeId);
        processingRef.current = false;
        if (nextId) await processNode(nextId, vars);
        return;
      }

      default: {
        addMessage({ from: "bot", content: `⚙️ ${def?.label || node.type}`, type: "system" });
        await delay(300);
        const nextId = findNextNode(nodeId);
        processingRef.current = false;
        if (nextId) await processNode(nextId, vars);
        return;
      }
    }
  }, [nodes, edges, addMessage, replaceVars, findNextNode, onHighlightNode]);

  const startSimulation = useCallback(() => {
    setMessages([]);
    setVariables({});
    setWaitingReply(false);
    setWaitingMenuNode(null);
    setIsRunning(true);
    processingRef.current = false;

    const startNode = nodes.find((n) => n.type === "start");
    if (!startNode) {
      addMessage({ from: "bot", content: "❌ Nenhum bloco de início encontrado", type: "system" });
      return;
    }
    processNode(startNode.id, {});
  }, [nodes, addMessage, processNode]);

  const handleUserReply = useCallback((text: string, optionId?: string) => {
    if (!text.trim()) return;

    addMessage({ from: "user", content: text });
    setInput("");
    setWaitingReply(false);

    const newVars = { ...variables, last_reply: text };

    // If waiting on a menu node, resolve the option
    if (waitingMenuNode) {
      const menuNode = waitingMenuNode;
      setWaitingMenuNode(null);

      const menuType = String(menuNode.data?.menuType || "buttons");
      const buttons = (menuNode.data?.buttons as any[]) || [];
      const listSections = (menuNode.data?.listSections as any[]) || [];
      const listRows = listSections.flatMap((s: any) => s.rows || []);
      const templateButtons = (menuNode.data?.templateButtons as any[]) || [];

      let options: any[] = [];
      let handlePrefix = "";
      if (menuNode.type === "send_text") {
        options = templateButtons;
        handlePrefix = "btn-";
      } else if (menuType === "list") {
        options = listRows;
        handlePrefix = "menu-";
      } else {
        options = buttons;
        handlePrefix = "menu-";
      }

      let matched = optionId ? options.find((o: any) => String(o.id) === String(optionId)) : null;
      if (!matched) {
        const norm = text.trim().toLowerCase();
        matched = options.find((o: any) => o.title?.trim().toLowerCase() === norm);
      }

      if (matched) {
        const handle = `${handlePrefix}${matched.id}`;
        const nextId = findNextNode(menuNode.id, handle);
        if (nextId) {
          // Auto-skip wait_reply nodes that only capture
          let targetId = nextId;
          let targetVars = newVars;
          let guard = 0;
          while (targetId && guard < 10) {
            guard++;
            const targetNode = nodes.find((n) => n.id === targetId);
            if (!targetNode || targetNode.type !== "wait_reply") break;
            if (targetNode.data?.saveToField) {
              targetVars = { ...targetVars, [String(targetNode.data.saveToField)]: text };
            }
            const replyEdge = edges.find((e) => e.source === targetId && (e.sourceHandle === "reply" || !e.sourceHandle));
            targetId = replyEdge?.target || null;
          }
          setVariables(targetVars);
          if (targetId) processNode(targetId, targetVars);
          return;
        }
      }

      // No match - try generic edge
      const genericNext = findNextNode(menuNode.id, "reply") || findNextNode(menuNode.id);
      if (genericNext) {
        setVariables(newVars);
        processNode(genericNext, newVars);
        return;
      }

      addMessage({ from: "bot", content: "Por favor, selecione uma das opções acima. 👆", type: "system" });
      setWaitingReply(true);
      setWaitingMenuNode(menuNode);
      return;
    }

    // Regular wait_reply
    if (currentNodeId) {
      const currentNode = nodes.find((n) => n.id === currentNodeId);
      if (currentNode?.data?.saveToField) {
        newVars[String(currentNode.data.saveToField)] = text;
      }
      setVariables(newVars);

      const nextId = findNextNode(currentNodeId, "reply") || findNextNode(currentNodeId);
      if (nextId) processNode(nextId, newVars);
    }
  }, [variables, waitingMenuNode, currentNodeId, addMessage, findNextNode, nodes, edges, processNode]);

  // Auto-start
  useEffect(() => {
    if (!isRunning) startSimulation();
  }, []);

  // Find last menu message for rendering buttons
  const lastMenuMessage = [...messages].reverse().find((m) => m.type === "menu" && m.from === "bot");

  return (
    <div className="flex flex-col w-[340px] border-l border-border bg-background h-full">
      {/* Phone header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <Smartphone size={16} className="text-primary" />
          <span className="text-xs font-semibold">Pré-visualização</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={startSimulation} title="Reiniciar">
            <RotateCcw size={14} />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X size={14} />
          </Button>
        </div>
      </div>

      {/* Phone frame */}
      <div className="flex-1 flex flex-col min-h-0 mx-3 my-3 rounded-2xl border-2 border-border bg-background overflow-hidden shadow-lg">
        {/* Status bar */}
        <div className="flex items-center justify-center py-1.5 bg-card border-b border-border">
          <div className="w-20 h-1 rounded-full bg-muted-foreground/30" />
        </div>

        {/* Chat header */}
        <div className="flex items-center gap-2 px-3 py-2 bg-primary/10 border-b border-border">
          <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center">
            <span className="text-xs">🤖</span>
          </div>
          <div>
            <p className="text-xs font-semibold text-foreground">Bot Teste</p>
            <p className="text-[10px] text-muted-foreground">Simulação</p>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 bg-secondary/20">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.from === "user" ? "justify-end" : "justify-start"}`}>
              {msg.type === "system" ? (
                <div className="text-[10px] text-muted-foreground bg-muted/50 px-2 py-1 rounded-md text-center w-full italic">
                  {msg.content}
                </div>
              ) : (
                <div
                  className={`max-w-[85%] px-3 py-2 rounded-xl text-xs leading-relaxed ${
                    msg.from === "user"
                      ? "bg-primary text-primary-foreground rounded-br-sm"
                      : "bg-card border border-border text-card-foreground rounded-bl-sm"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                </div>
              )}
            </div>
          ))}

          {/* Interactive buttons/list for the active menu */}
          {waitingReply && lastMenuMessage && lastMenuMessage.type === "menu" && (
            <div className="space-y-1.5 pt-1">
              {lastMenuMessage.menuType === "buttons" && lastMenuMessage.buttons?.map((btn) => (
                <button
                  key={btn.id}
                  className="w-full text-xs py-2 px-3 rounded-lg border border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 transition-colors text-center"
                  onClick={() => handleUserReply(btn.title, btn.id)}
                >
                  {btn.title}
                </button>
              ))}
              {lastMenuMessage.menuType === "list" && lastMenuMessage.listSections?.map((section, si) => (
                <div key={si} className="space-y-1">
                  {section.title && (
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide px-1">{section.title}</p>
                  )}
                  {section.rows.map((row) => (
                    <button
                      key={row.id}
                      className="w-full text-left text-xs py-2 px-3 rounded-lg border border-primary/30 bg-primary/5 text-foreground hover:bg-primary/10 transition-colors"
                      onClick={() => handleUserReply(row.title, row.id)}
                    >
                      <span className="font-medium">{row.title}</span>
                      {row.description && <span className="block text-[10px] text-muted-foreground">{row.description}</span>}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-border p-2 bg-card">
          <div className="flex items-center gap-1.5">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && waitingReply) {
                  e.preventDefault();
                  handleUserReply(input);
                }
              }}
              placeholder={waitingReply ? "Digite sua resposta..." : "Aguarde..."}
              disabled={!waitingReply}
              className="h-8 text-xs"
            />
            <Button
              size="icon"
              className="h-8 w-8 shrink-0"
              disabled={!waitingReply || !input.trim()}
              onClick={() => handleUserReply(input)}
            >
              <Send size={14} />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}