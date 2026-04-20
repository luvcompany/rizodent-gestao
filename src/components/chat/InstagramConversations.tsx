import { useEffect, useMemo, useState, useRef } from "react";
import { useInstagramMessages } from "@/hooks/useInstagramMessages";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Instagram, Send, Loader2, Search, MessageSquare, MessageCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const IG_PURPLE = "#833AB4";

type SubFilter = "directs" | "comments";

export default function InstagramConversations() {
  const {
    conversations,
    messages,
    selectedConversationId,
    setSelectedConversationId,
    sendMessage,
    markAsRead,
    loading,
    error,
  } = useInstagramMessages();

  const [subFilter, setSubFilter] = useState<SubFilter>("directs");
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [accounts, setAccounts] = useState<{ instagram_account_id: string; name: string }[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase
      .from("instagram_accounts")
      .select("instagram_account_id, name")
      .eq("is_active", true)
      .then(({ data }) => {
        setAccounts((data ?? []).filter((a) => a.instagram_account_id) as any);
      });
  }, []);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, selectedConversationId]);

  const filteredConversations = useMemo(() => {
    return conversations.filter((c) => {
      if (subFilter === "directs" && c.message_type !== "dm") return false;
      if (subFilter === "comments" && c.message_type !== "comment") return false;
      if (accountFilter !== "all" && c.instagram_account_id !== accountFilter) return false;
      if (search.trim()) {
        const s = search.toLowerCase();
        const name = (c.sender_name || c.sender_id || "").toLowerCase();
        if (!name.includes(s)) return false;
      }
      return true;
    });
  }, [conversations, subFilter, accountFilter, search]);

  const selectedConv = useMemo(
    () => conversations.find((c) => c.sender_id === selectedConversationId) || null,
    [conversations, selectedConversationId]
  );

  const handleSelect = (sender_id: string) => {
    setSelectedConversationId(sender_id);
    markAsRead(sender_id);
  };

  const handleSend = async () => {
    if (!input.trim() || !selectedConv || sending) return;
    if (!selectedConv.instagram_account_id) {
      toast.error("Conta do Instagram não identificada para esta conversa");
      return;
    }
    setSending(true);
    try {
      const isComment = selectedConv.message_type === "comment";
      const lastCommentId = isComment
        ? [...messages].reverse().find((m) => m.comment_id)?.comment_id ?? undefined
        : undefined;

      await sendMessage({
        instagram_account_id: selectedConv.instagram_account_id,
        recipient_id: selectedConv.sender_id,
        message: input.trim(),
        message_type: isComment ? "comment" : "dm",
        comment_id: lastCommentId,
      });
      setInput("");
    } catch (e: any) {
      console.error("[InstagramConversations] send error", e);
      toast.error(e?.message ?? "Erro ao enviar mensagem");
    } finally {
      setSending(false);
    }
  };

  const firstPostId = useMemo(
    () => messages.find((m) => m.post_id)?.post_id,
    [messages]
  );

  return (
    <div className="flex-1 overflow-hidden">
      <ResizablePanelGroup direction="horizontal" className="h-full">
        {/* LEFT — conversation list */}
        <ResizablePanel defaultSize={28} minSize={20} maxSize={40}>
          <div className="flex flex-col h-full border-r border-border bg-card">
            {/* Filters */}
            <div className="p-3 border-b border-border space-y-2">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 h-9 bg-secondary border-border text-xs"
                />
              </div>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant={subFilter === "directs" ? "default" : "outline"}
                  className="flex-1 h-8 text-xs"
                  onClick={() => setSubFilter("directs")}
                  style={subFilter === "directs" ? { backgroundColor: IG_PURPLE, color: "white" } : {}}
                >
                  <MessageSquare size={12} className="mr-1" /> Directs
                </Button>
                <Button
                  size="sm"
                  variant={subFilter === "comments" ? "default" : "outline"}
                  className="flex-1 h-8 text-xs"
                  onClick={() => setSubFilter("comments")}
                  style={subFilter === "comments" ? { backgroundColor: IG_PURPLE, color: "white" } : {}}
                >
                  <MessageCircle size={12} className="mr-1" /> Comentários
                </Button>
              </div>
              <Select value={accountFilter} onValueChange={setAccountFilter}>
                <SelectTrigger className="h-8 text-xs bg-secondary border-border">
                  <SelectValue placeholder="Todas as contas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as contas</SelectItem>
                  {accounts.map((a) => (
                    <SelectItem key={a.instagram_account_id} value={a.instagram_account_id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto">
              {loading && (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  <Loader2 className="animate-spin mx-auto mb-2" size={18} /> Carregando...
                </div>
              )}
              {error && <div className="p-4 text-sm text-destructive">{error}</div>}
              {!loading && filteredConversations.length === 0 && (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  Nenhuma conversa do Instagram.
                </div>
              )}
              {filteredConversations.map((c) => {
                const isSelected = c.sender_id === selectedConversationId;
                const displayName = c.sender_name || c.sender_id || "Desconhecido";
                return (
                  <button
                    key={c.sender_id}
                    onClick={() => handleSelect(c.sender_id)}
                    className={`w-full text-left p-3 border-b border-border/50 hover:bg-secondary/60 transition-colors flex gap-3 items-start ${
                      isSelected ? "bg-secondary" : ""
                    }`}
                  >
                    <Avatar className="h-10 w-10 flex-shrink-0">
                      <AvatarFallback style={{ backgroundColor: IG_PURPLE, color: "white" }}>
                        <Instagram size={18} />
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-sm text-foreground truncate">{displayName}</span>
                        <span className="text-[10px] text-muted-foreground flex-shrink-0">
                          {format(new Date(c.last_message_time), "HH:mm")}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground truncate">
                          {c.last_message || <em>(sem texto)</em>}
                        </span>
                        {c.unread_count > 0 && (
                          <Badge className="h-5 min-w-5 px-1.5 bg-destructive text-destructive-foreground text-[10px] flex-shrink-0">
                            {c.unread_count}
                          </Badge>
                        )}
                      </div>
                      {c.account_name && (
                        <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
                          via {c.account_name}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle />

        {/* RIGHT — chat window */}
        <ResizablePanel defaultSize={72}>
          <div className="flex flex-col h-full bg-background">
            {!selectedConv ? (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <Instagram size={48} className="mx-auto mb-3 opacity-40" style={{ color: IG_PURPLE }} />
                  <p className="text-sm">Selecione uma conversa do Instagram</p>
                </div>
              </div>
            ) : (
              <>
                {/* Header */}
                <div className="flex-shrink-0 border-b border-border bg-card px-4 py-3 flex items-center gap-3">
                  <Avatar className="h-9 w-9">
                    <AvatarFallback style={{ backgroundColor: IG_PURPLE, color: "white" }}>
                      <Instagram size={16} />
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-foreground truncate">
                      {selectedConv.sender_name || selectedConv.sender_id}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {selectedConv.message_type === "comment" ? "Comentários" : "Direct Message"}
                      {selectedConv.account_name ? ` • ${selectedConv.account_name}` : ""}
                    </div>
                  </div>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                  {selectedConv.message_type === "comment" && firstPostId && (
                    <div className="bg-secondary/60 border border-border rounded-lg p-3 mb-3 text-xs text-muted-foreground">
                      💬 Comentário no post <span className="font-mono text-foreground">{firstPostId}</span>
                    </div>
                  )}

                  {messages.length === 0 && (
                    <div className="text-center text-xs text-muted-foreground py-8">
                      Nenhuma mensagem nesta conversa.
                    </div>
                  )}

                  {messages.map((m) => {
                    const isOut = m.is_outbound;
                    return (
                      <div key={m.id} className={`flex ${isOut ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[70%] rounded-2xl px-3 py-2 text-sm ${
                            isOut ? "text-white" : "bg-secondary text-foreground"
                          }`}
                          style={isOut ? { backgroundColor: IG_PURPLE } : {}}
                        >
                          {m.message_text || <em className="opacity-70">(sem texto)</em>}
                          <div
                            className={`text-[10px] mt-1 ${
                              isOut ? "text-white/70" : "text-muted-foreground"
                            }`}
                          >
                            {format(new Date(m.created_at), "dd/MM HH:mm", { locale: ptBR })}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>

                {/* Input */}
                <div className="flex-shrink-0 border-t border-border bg-card p-3">
                  <div className="flex gap-2 items-end">
                    <Input
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder={
                        selectedConv.message_type === "comment"
                          ? "Responder comentário..."
                          : "Digite uma mensagem..."
                      }
                      maxLength={1000}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSend();
                        }
                      }}
                      disabled={sending}
                      className="flex-1 bg-secondary border-border"
                    />
                    <Button
                      onClick={handleSend}
                      disabled={!input.trim() || sending}
                      style={{ backgroundColor: IG_PURPLE, color: "white" }}
                      className="hover:opacity-90"
                    >
                      {sending ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
