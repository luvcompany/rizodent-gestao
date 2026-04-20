import { useEffect, useMemo, useRef, useState } from "react";
import { Instagram, Send, Loader2, Search, MessageSquare, MessageCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useInstagramMessages } from "@/hooks/useInstagramMessages";

const IG_PURPLE = "#833AB4";

type IGAccountOption = { instagram_account_id: string; name: string | null };

export default function InstagramConversations() {
  const {
    conversations,
    messages,
    selectedConversationId,
    setSelectedConversationId,
    sendMessage,
    markAsRead,
    loading,
  } = useInstagramMessages();

  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<"dm" | "comment">("dm");
  const [search, setSearch] = useState("");
  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);
  const [accountOptions, setAccountOptions] = useState<IGAccountOption[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase
      .from("instagram_accounts")
      .select("instagram_account_id, name")
      .eq("is_active", true)
      .then(({ data }) => {
        setAccountOptions(
          ((data || []) as IGAccountOption[]).filter((a) => !!a.instagram_account_id),
        );
      });
  }, []);

  useEffect(() => {
    if (selectedConversationId) markAsRead(selectedConversationId);
  }, [selectedConversationId, markAsRead]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, selectedConversationId]);

  const filteredConversations = useMemo(() => {
    return conversations.filter((c) => {
      if (typeFilter === "dm" && c.message_type !== "dm") return false;
      if (typeFilter === "comment" && c.message_type !== "comment") return false;
      if (accountFilter !== "all" && c.instagram_account_id !== accountFilter) return false;
      if (search.trim()) {
        const s = search.trim().toLowerCase();
        const hay = `${c.sender_name ?? ""} ${c.last_message ?? ""}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [conversations, typeFilter, accountFilter, search]);

  const activeConversation = filteredConversations.find(
    (c) => c.sender_id === selectedConversationId,
  ) || conversations.find((c) => c.sender_id === selectedConversationId);

  const handleSend = async () => {
    if (!composer.trim() || !activeConversation || !activeConversation.instagram_account_id) {
      if (!activeConversation?.instagram_account_id) {
        toast.error("Conta do Instagram não identificada para esta conversa");
      }
      return;
    }
    const payload = {
      instagram_account_id: activeConversation.instagram_account_id,
      recipient_id: activeConversation.sender_id,
      message: composer.trim(),
      message_type: (activeConversation.message_type as "dm" | "comment") ?? "dm",
      comment_id: [...messages].reverse().find((m) => m.comment_id)?.comment_id ?? undefined,
    };
    setSending(true);
    try {
      await sendMessage(payload);
      setComposer("");
      toast.success("Mensagem enviada");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro ao enviar";
      console.error("Falha ao enviar mensagem Instagram:", e);
      toast.error(msg);
    } finally {
      setSending(false);
    }
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) {
      return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  };

  return (
    <div className="h-full">
      <ResizablePanelGroup direction="horizontal" className="h-full">
        {/* Left: conversation list */}
        <ResizablePanel defaultSize={30} minSize={22}>
          <div className="h-full flex flex-col bg-card border-r border-border">
            <div className="p-3 border-b border-border space-y-2">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar conversa..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 h-9"
                />
              </div>
              <Tabs value={typeFilter} onValueChange={(v) => setTypeFilter(v as "dm" | "comment")}>
                <TabsList className="w-full">
                  <TabsTrigger value="dm" className="flex-1 gap-1">
                    <MessageSquare size={14} /> Directs
                  </TabsTrigger>
                  <TabsTrigger value="comment" className="flex-1 gap-1">
                    <MessageCircle size={14} /> Comentários
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <Select value={accountFilter} onValueChange={setAccountFilter}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Todas as contas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as contas</SelectItem>
                  {accountOptions.map((a) => (
                    <SelectItem key={a.instagram_account_id} value={a.instagram_account_id}>
                      {a.name || a.instagram_account_id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex-1 overflow-y-auto">
              {loading && (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  <Loader2 size={16} className="animate-spin inline mr-2" /> Carregando...
                </div>
              )}
              {!loading && filteredConversations.length === 0 && (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  Nenhuma conversa
                </div>
              )}
              {filteredConversations.map((c) => {
                const selected = selectedConversationId === c.sender_id;
                return (
                  <button
                    key={c.sender_id}
                    onClick={() => setSelectedConversationId(c.sender_id)}
                    className={`w-full text-left flex gap-3 p-3 border-b border-border hover:bg-accent/50 transition-colors ${
                      selected ? "bg-accent" : ""
                    }`}
                  >
                    <Avatar className="w-10 h-10 flex-shrink-0">
                      {c.sender_profile_pic && <AvatarImage src={c.sender_profile_pic} alt={c.sender_name ?? ""} />}
                      <AvatarFallback className="text-white" style={{ backgroundColor: IG_PURPLE }}>
                        <Instagram size={18} />
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-sm text-foreground truncate">
                          {c.sender_name || c.sender_id}
                        </span>
                        <span className="text-[10px] text-muted-foreground flex-shrink-0">
                          {formatTime(c.last_message_time)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground truncate">
                          {c.last_message || "(sem texto)"}
                        </span>
                        {c.unread_count > 0 && (
                          <Badge
                            className="text-white border-0 h-5 min-w-[20px] px-1.5 text-[10px]"
                            style={{ backgroundColor: IG_PURPLE }}
                          >
                            {c.unread_count}
                          </Badge>
                        )}
                      </div>
                      {c.account_name && (
                        <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                          via {c.account_name}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Right: conversation window */}
        <ResizablePanel defaultSize={70}>
          <div className="h-full flex flex-col bg-background">
            {!activeConversation ? (
              <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
                <Instagram size={48} className="mb-3 opacity-40" />
                <p className="text-sm">Selecione uma conversa para começar</p>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 p-4 border-b border-border bg-card">
                  <Avatar className="w-10 h-10">
                    {activeConversation.sender_profile_pic && (
                      <AvatarImage src={activeConversation.sender_profile_pic} alt={activeConversation.sender_name ?? ""} />
                    )}
                    <AvatarFallback className="text-white" style={{ backgroundColor: IG_PURPLE }}>
                      <Instagram size={18} />
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-foreground truncate">
                      {activeConversation.sender_name || activeConversation.sender_id}
                    </h3>
                    <p className="text-xs text-muted-foreground truncate">
                      Instagram • {activeConversation.account_name || activeConversation.instagram_account_id}
                      {activeConversation.message_type === "comment" && " • Comentários"}
                    </p>
                  </div>
                </div>

                <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
                  {activeConversation.message_type === "comment" && messages[0]?.post_id && (
                    <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs">
                      <p className="font-semibold text-foreground mb-1">Comentário no post</p>
                      <p className="text-muted-foreground break-all">post_id: {messages[0].post_id}</p>
                    </div>
                  )}
                  {messages.map((m) => {
                    const outbound = m.is_outbound;
                    return (
                      <div key={m.id} className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[70%] rounded-lg px-3 py-2 text-sm ${
                            outbound ? "text-white" : "bg-muted text-foreground"
                          }`}
                          style={outbound ? { backgroundColor: IG_PURPLE } : undefined}
                        >
                          {m.message_text || <em className="opacity-70">(sem conteúdo)</em>}
                          <div
                            className={`text-[10px] mt-1 ${
                              outbound ? "text-white/70" : "text-muted-foreground"
                            }`}
                          >
                            {new Date(m.created_at).toLocaleTimeString("pt-BR", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="p-3 border-t border-border bg-card flex items-end gap-2">
                  <textarea
                    value={composer}
                    onChange={(e) => setComposer(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder={
                      activeConversation.message_type === "comment"
                        ? "Responder ao comentário..."
                        : "Mensagem..."
                    }
                    rows={1}
                    className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    disabled={sending}
                  />
                  <Button
                    onClick={handleSend}
                    disabled={sending || !composer.trim()}
                    className="text-white"
                    style={{ backgroundColor: IG_PURPLE }}
                  >
                    {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  </Button>
                </div>
              </>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
