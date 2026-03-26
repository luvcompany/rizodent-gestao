import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import ChatInput from "@/components/chat/ChatInput";
import {
  ArrowLeft, FileText, Phone, Mic,
  MoreVertical, Check, CheckCheck, Clock, Plus, Tag, File as FileIcon
} from "lucide-react";

type Message = {
  id: string;
  lead_id: string;
  direction: string;
  type: string;
  content: string | null;
  media_url: string | null;
  status: string;
  created_at: string;
};

type Lead = {
  id: string;
  name: string;
  phone: string | null;
  stage_id: string;
  tags: string[] | null;
  source: string | null;
  value: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type Stage = {
  id: string;
  name: string;
  color: string;
  position: number;
  pipeline_id: string;
};

export default function CrmConversa() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [lead, setLead] = useState<Lead | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [newNote, setNewNote] = useState("");
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const fetchData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [leadRes, messagesRes, stagesRes] = await Promise.all([
      supabase.from("crm_leads").select("*").eq("id", id).single(),
      supabase.from("messages").select("*").eq("lead_id", id).order("created_at", { ascending: true }),
      supabase.from("crm_stages").select("*").order("position"),
    ]);
    if (leadRes.data) setLead(leadRes.data as Lead);
    setMessages((messagesRes.data as Message[]) || []);
    setStages((stagesRes.data as Stage[]) || []);
    setLoading(false);
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => { scrollToBottom(); }, [messages]);

  // Realtime messages
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`messages-${id}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `lead_id=eq.${id}`,
      }, (payload) => {
        setMessages((prev) => [...prev, payload.new as Message]);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id]);

  // Message sending is now handled by ChatInput component

  const handleStageChange = async (stageId: string) => {
    if (!id) return;
    const { error } = await supabase.from("crm_leads").update({ stage_id: stageId, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { toast.error("Erro ao mover lead"); return; }
    setLead((prev) => prev ? { ...prev, stage_id: stageId } : prev);
    toast.success("Etapa atualizada");
  };

  const handleAddNote = async () => {
    if (!newNote.trim() || !lead) return;
    const existingNotes = lead.notes || "";
    const timestamp = new Date().toLocaleString("pt-BR");
    const updatedNotes = `${existingNotes}\n[${timestamp}] ${newNote.trim()}`.trim();
    const { error } = await supabase.from("crm_leads").update({ notes: updatedNotes }).eq("id", lead.id);
    if (error) { toast.error("Erro ao salvar nota"); return; }
    setLead((prev) => prev ? { ...prev, notes: updatedNotes } : prev);
    setNewNote("");
    toast.success("Nota adicionada");
  };

  const loadTemplates = async () => {
    const { data } = await supabase.from("crm_whatsapp_templates").select("*").eq("status", "APPROVED");
    setTemplates(data || []);
    setTemplatesOpen(true);
  };

  const insertTemplate = (text: string) => {
    setNewMessage(text);
    setTemplatesOpen(false);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "read": return <CheckCheck size={14} className="text-blue-400" />;
      case "delivered": return <CheckCheck size={14} className="text-muted-foreground" />;
      case "sent": return <Check size={14} className="text-muted-foreground" />;
      default: return <Clock size={14} className="text-muted-foreground" />;
    }
  };

  const currentStage = stages.find((s) => s.id === lead?.stage_id);
  const formatCurrency = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-muted-foreground">Carregando conversa...</div>
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-muted-foreground">Lead não encontrado</div>
      </div>
    );
  }

  return (
    <div className="flex overflow-hidden bg-background -m-6" style={{ height: "calc(100vh - 4rem)" }}>
      {/* LEFT COLUMN - Chat (70%) */}
      <div className="flex flex-col w-[70%] border-r border-border">
        {/* Chat Header */}
        <div className="flex-shrink-0 bg-card border-b border-border px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate("/crm")} className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={20} />
          </button>
          <Avatar className="h-10 w-10">
            <AvatarFallback className="bg-primary/20 text-primary font-semibold">
              {lead.name.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-foreground truncate">{lead.name}</div>
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              {lead.phone && <span>{lead.phone}</span>}
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                Online
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="p-2 text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-secondary">
              <Phone size={18} />
            </button>
            <button className="p-2 text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-secondary">
              <MoreVertical size={18} />
            </button>
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2" style={{ backgroundImage: "radial-gradient(circle at 20% 50%, hsl(var(--primary) / 0.03) 0%, transparent 50%)" }}>
          {messages.length === 0 && (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              Nenhuma mensagem ainda. Inicie a conversa!
            </div>
          )}
          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.direction === "outbound" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[65%] rounded-lg px-3 py-2 ${
                msg.direction === "outbound"
                  ? "bg-primary/20 text-foreground rounded-br-none"
                  : "bg-card border border-border text-foreground rounded-bl-none"
              }`}>
                {msg.type === "image" && msg.media_url && (
                  <img src={msg.media_url} alt="Imagem" className="rounded mb-1 max-w-full" />
                )}
                {msg.type === "audio" && (
                  <div className="flex items-center gap-2 text-sm">
                    <Mic size={14} className="text-primary" />
                    <span>Mensagem de áudio</span>
                  </div>
                )}
                {msg.content && <p className="text-sm whitespace-pre-wrap">{msg.content}</p>}
                <div className={`flex items-center gap-1 mt-1 ${msg.direction === "outbound" ? "justify-end" : ""}`}>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(msg.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  {msg.direction === "outbound" && getStatusIcon(msg.status)}
                </div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="flex-shrink-0 bg-card border-t border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <button className="p-2 text-muted-foreground hover:text-primary transition-colors">
              <Paperclip size={20} />
            </button>
            <div className="flex-1 relative">
              <Input
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Digite uma mensagem..."
                className="pr-10 bg-secondary border-border"
              />
            </div>
            <button onClick={loadTemplates} className="p-2 text-muted-foreground hover:text-primary transition-colors" title="Templates">
              <FileText size={20} />
            </button>
            <button className="p-2 text-muted-foreground hover:text-primary transition-colors">
              <Mic size={20} />
            </button>
            <Button size="icon" onClick={handleSendMessage} disabled={!newMessage.trim()}>
              <Send size={18} />
            </Button>
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN - Lead Panel (30%) */}
      <div className="w-[30%] flex flex-col bg-card overflow-y-auto">
        {/* Lead Info Header */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-3 mb-3">
            <Avatar className="h-14 w-14">
              <AvatarFallback className="bg-primary/20 text-primary text-xl font-bold">
                {lead.name.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <h2 className="font-bold text-foreground">{lead.name}</h2>
              <p className="text-sm text-muted-foreground">{lead.phone || "Sem telefone"}</p>
            </div>
          </div>

          {/* Stage selector */}
          <div className="mb-3">
            <label className="text-xs text-muted-foreground mb-1 block">Etapa do Funil</label>
            <Select value={lead.stage_id} onValueChange={handleStageChange}>
              <SelectTrigger className="bg-secondary border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {stages.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                      {s.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Current stage badge */}
          {currentStage && (
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: currentStage.color }} />
              <span className="text-sm font-medium text-foreground">{currentStage.name}</span>
            </div>
          )}

          {/* Value */}
          {lead.value ? (
            <div className="mt-2">
              <span className="text-xs text-muted-foreground">Valor</span>
              <p className="text-primary font-semibold">{formatCurrency(lead.value)}</p>
            </div>
          ) : null}

          {/* Source */}
          {lead.source && (
            <div className="mt-2">
              <span className="text-xs text-muted-foreground">Origem</span>
              <p className="text-sm text-foreground capitalize">{lead.source}</p>
            </div>
          )}
        </div>

        {/* Tags */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-2 mb-2">
            <Tag size={14} className="text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground uppercase">Tags</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {lead.tags && lead.tags.length > 0 ? (
              lead.tags.map((t) => (
                <Badge key={t} variant="secondary" className="text-xs">#{t}</Badge>
              ))
            ) : (
              <span className="text-sm text-muted-foreground">Nenhuma tag</span>
            )}
          </div>
        </div>

        {/* Notes / Activity */}
        <div className="p-4 border-b border-border flex-1">
          <h3 className="text-xs font-medium text-muted-foreground uppercase mb-2">Notas & Atividades</h3>
          <div className="text-sm text-foreground whitespace-pre-wrap mb-3 max-h-40 overflow-y-auto">
            {lead.notes || "Sem notas"}
          </div>
          <div className="flex gap-2">
            <Input
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Adicionar nota..."
              className="bg-secondary border-border text-sm"
              onKeyDown={(e) => { if (e.key === "Enter") handleAddNote(); }}
            />
            <Button size="sm" variant="outline" onClick={handleAddNote} disabled={!newNote.trim()}>
              <Plus size={14} />
            </Button>
          </div>
        </div>

        {/* Actions */}
        <div className="p-4">
          <Button variant="outline" className="w-full mb-2" size="sm">
            <Plus size={14} className="mr-1" /> Adicionar Tarefa
          </Button>
          <div className="text-xs text-muted-foreground text-center mt-2">
            Criado em {new Date(lead.created_at).toLocaleDateString("pt-BR")}
          </div>
        </div>
      </div>

      {/* Templates Sheet */}
      <Sheet open={templatesOpen} onOpenChange={setTemplatesOpen}>
        <SheetContent className="w-[380px]">
          <SheetHeader>
            <SheetTitle>Templates Aprovados</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-2">
            {templates.length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhum template aprovado encontrado.</p>
            )}
            {templates.map((t) => (
              <button
                key={t.id}
                onClick={() => insertTemplate(t.body_text || t.name)}
                className="w-full text-left p-3 rounded-lg border border-border hover:border-primary/30 bg-secondary/50 hover:bg-secondary transition-colors"
              >
                <div className="font-medium text-sm text-foreground">{t.name}</div>
                <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{t.body_text}</div>
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
