import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  MessageSquare,
  Send,
  Search,
  Instagram,
  ExternalLink,
  Loader2,
  Reply as ReplyIcon,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import EmojiPickerButton from "@/components/chat/EmojiPickerButton";

type IgComment = {
  id: string;
  comment_id: string | null;
  post_id: string | null;
  sender_id: string | null;
  sender_name: string | null;
  sender_username: string | null;
  sender_profile_pic: string | null;
  message_text: string | null;
  is_outbound: boolean;
  is_read: boolean;
  created_at: string;
  instagram_account_id: string | null;
};

type Thread = {
  key: string;
  sender_id: string | null;
  sender_name: string | null;
  sender_username: string | null;
  sender_profile_pic: string | null;
  post_id: string | null;
  instagram_account_id: string | null;
  comments: IgComment[];
  lastAt: string;
  unread: number;
};

const INSTAGRAM_PIPELINE_ID = "c2d3e4f5-0001-4000-8000-000000000002";

export default function InstagramComments() {
  const [comments, setComments] = useState<IgComment[]>([]);
  const [accountsMap, setAccountsMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyMode, setReplyMode] = useState<"comment" | "dm">("comment");
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [{ data: accounts }, { data: msgs }] = await Promise.all([
      supabase.from("instagram_accounts").select("instagram_account_id, name"),
      supabase
        .from("instagram_messages")
        .select("*")
        .eq("message_type", "comment")
        .order("created_at", { ascending: false })
        .limit(1000),
    ]);
    const map: Record<string, string> = {};
    (accounts ?? []).forEach((a: any) => {
      if (a.instagram_account_id) map[a.instagram_account_id] = a.name ?? "";
    });
    setAccountsMap(map);
    setComments((msgs as IgComment[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll();
    const channel = supabase
      .channel("ig-comments-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "instagram_messages", filter: "message_type=eq.comment" },
        () => loadAll()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadAll]);

  // Group comments into threads: same sender + post
  const threads = useMemo<Thread[]>(() => {
    const map = new Map<string, Thread>();
    // iterate ascending so thread.comments stays chronological
    const sortedAsc = [...comments].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    for (const c of sortedAsc) {
      const key = `${c.sender_id ?? "anon"}::${c.post_id ?? "nopost"}`;
      const existing = map.get(key);
      if (existing) {
        existing.comments.push(c);
        if (new Date(c.created_at) > new Date(existing.lastAt)) existing.lastAt = c.created_at;
        if (!c.is_read && !c.is_outbound) existing.unread += 1;
        // prefer non-null profile data
        existing.sender_name ??= c.sender_name;
        existing.sender_username ??= c.sender_username;
        existing.sender_profile_pic ??= c.sender_profile_pic;
        existing.instagram_account_id ??= c.instagram_account_id;
      } else {
        map.set(key, {
          key,
          sender_id: c.sender_id,
          sender_name: c.sender_name,
          sender_username: c.sender_username,
          sender_profile_pic: c.sender_profile_pic,
          post_id: c.post_id,
          instagram_account_id: c.instagram_account_id,
          comments: [c],
          lastAt: c.created_at,
          unread: !c.is_read && !c.is_outbound ? 1 : 0,
        });
      }
    }
    return Array.from(map.values()).sort(
      (a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime()
    );
  }, [comments]);

  const filteredThreads = useMemo(() => {
    if (!search.trim()) return threads;
    const q = search.toLowerCase();
    return threads.filter(
      (t) =>
        (t.sender_name || "").toLowerCase().includes(q) ||
        (t.sender_username || "").toLowerCase().includes(q) ||
        t.comments.some((c) => (c.message_text || "").toLowerCase().includes(q))
    );
  }, [threads, search]);

  const selected = useMemo(
    () => filteredThreads.find((t) => t.key === selectedKey) ?? threads.find((t) => t.key === selectedKey) ?? null,
    [filteredThreads, threads, selectedKey]
  );

  // Auto-mark thread as read on open
  useEffect(() => {
    if (!selected) return;
    const unreadIds = selected.comments.filter((c) => !c.is_read && !c.is_outbound).map((c) => c.id);
    if (unreadIds.length === 0) return;
    supabase.from("instagram_messages").update({ is_read: true }).in("id", unreadIds).then(() => {
      setComments((prev) => prev.map((c) => (unreadIds.includes(c.id) ? { ...c, is_read: true } : c)));
    });
  }, [selected?.key]);

  // Scroll to bottom when conversation changes / new msg arrives
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [selected?.key, selected?.comments.length]);

  const insertEmoji = (emoji: string) => {
    const ta = textareaRef.current;
    if (!ta) {
      setReplyText((t) => t + emoji);
      return;
    }
    const start = ta.selectionStart ?? replyText.length;
    const end = ta.selectionEnd ?? replyText.length;
    const next = replyText.slice(0, start) + emoji + replyText.slice(end);
    setReplyText(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };

  const handleSend = async () => {
    if (!selected || !replyText.trim()) return;
    // Find the comment we'll reply to: the latest inbound (or any) comment in thread
    const targetComment =
      [...selected.comments].reverse().find((c) => !c.is_outbound) ?? selected.comments[selected.comments.length - 1];
    if (!targetComment) return;

    setSending(true);
    try {
      if (replyMode === "comment") {
        if (!targetComment.comment_id || !targetComment.instagram_account_id) {
          throw new Error("Comentário sem ID válido");
        }
        const { data, error } = await supabase.functions.invoke("instagram-send-message", {
          body: {
            instagram_account_id: targetComment.instagram_account_id,
            comment_id: targetComment.comment_id,
            message: replyText.trim(),
            message_type: "comment",
            post_id: targetComment.post_id ?? selected.post_id ?? null,
            thread_sender_id: selected.sender_id ?? targetComment.sender_id ?? null,
          },
        });
        if (error || data?.ok === false) throw Object.assign(error || new Error(data?.error || "Falha ao responder comentário"), { context: data });
        toast.success("Resposta enviada ao comentário");
      } else {
        if (!selected.sender_id || !selected.instagram_account_id) {
          throw new Error("Dados do remetente ausentes");
        }
        // ensure lead exists
        let leadId: string | null = null;
        const { data: existing } = await supabase
          .from("crm_leads")
          .select("id")
          .eq("instagram_user_id", selected.sender_id)
          .maybeSingle();
        if (existing) {
          leadId = existing.id;
        } else {
          const { data: firstStage } = await supabase
            .from("crm_stages")
            .select("id")
            .eq("pipeline_id", INSTAGRAM_PIPELINE_ID)
            .order("position", { ascending: true })
            .limit(1)
            .maybeSingle();
          if (!firstStage) throw new Error("Funil Instagram sem etapas");
          const accountName = accountsMap[selected.instagram_account_id] || "";
          const displayName =
            selected.sender_name || selected.sender_username || `IG ${selected.sender_id.slice(0, 8)}`;
          const { data: created, error: createErr } = await supabase
            .from("crm_leads")
            .insert({
              name: displayName,
              pipeline_id: INSTAGRAM_PIPELINE_ID,
              stage_id: firstStage.id,
              source: accountName ? `Instagram (${accountName})` : "Instagram",
              instagram_user_id: selected.sender_id,
              instagram_username: selected.sender_username,
              instagram_profile_pic_url: selected.sender_profile_pic,
            })
            .select("id")
            .single();
          if (createErr) throw createErr;
          leadId = created.id;
        }

        const { data, error } = await supabase.functions.invoke("instagram-send-message", {
          body: {
            instagram_account_id: selected.instagram_account_id,
            lead_id: leadId,
            recipient_id: selected.sender_id,
            message: replyText.trim(),
            message_type: "dm",
          },
        });
        if (error || data?.ok === false) throw Object.assign(error || new Error(data?.error || "Falha ao enviar DM"), { context: data });
        toast.success("DM enviada — disponível na aba Direct");
      }
      setReplyText("");
      // realtime will refetch; in case it's slow, refresh quickly
      setTimeout(loadAll, 800);
    } catch (e: any) {
      console.error("[InstagramComments] reply error", e);
      toast.error(e?.context?.user_message ?? e?.message ?? "Falha ao enviar resposta");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-1 overflow-hidden bg-background">
      {/* LEFT: thread list */}
      <div className="w-[320px] border-r border-border flex flex-col">
        <div className="px-3 py-3 border-b border-border">
          <div className="flex items-center gap-2 mb-2">
            <Instagram size={16} className="text-pink-500" />
            <h2 className="text-sm font-semibold text-foreground">Comentários</h2>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 bg-secondary border-border text-sm"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 size={16} className="animate-spin mr-2" /> Carregando...
            </div>
          )}
          {!loading && filteredThreads.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-muted-foreground text-center">
              <MessageSquare size={32} className="opacity-40 mb-3" />
              <p className="text-sm">Nenhum comentário encontrado.</p>
            </div>
          )}
          {filteredThreads.map((t) => {
            const last = t.comments[t.comments.length - 1];
            const initials = (t.sender_name || t.sender_username || "?").slice(0, 2).toUpperCase();
            const isActive = selectedKey === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setSelectedKey(t.key)}
                className={`w-full text-left px-3 py-3 border-b border-border/60 hover:bg-secondary/50 transition-colors ${
                  isActive ? "bg-secondary" : t.unread > 0 ? "bg-primary/5" : ""
                }`}
              >
                <div className="flex gap-2.5">
                  <Avatar className="h-10 w-10 flex-shrink-0">
                    <AvatarImage src={t.sender_profile_pic ?? undefined} />
                    <AvatarFallback className="bg-secondary text-xs">{initials}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-foreground truncate">
                        {t.sender_name || t.sender_username || "Anônimo"}
                      </span>
                      <span className="text-[10px] text-muted-foreground ml-auto whitespace-nowrap">
                        {formatDistanceToNow(new Date(t.lastAt), { addSuffix: false, locale: ptBR })}
                      </span>
                    </div>
                    {t.sender_username && (
                      <div className="text-[11px] text-muted-foreground truncate">@{t.sender_username}</div>
                    )}
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-xs text-muted-foreground truncate flex-1">
                        {last?.message_text || <span className="italic">(sem texto)</span>}
                      </p>
                      {t.unread > 0 && (
                        <Badge variant="default" className="h-4 min-w-4 px-1 text-[10px] bg-primary">
                          {t.unread}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* RIGHT: conversation */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selected ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
            <MessageSquare size={48} className="opacity-30 mb-4" />
            <p className="text-sm">Selecione um comentário para responder</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
              <Avatar className="h-9 w-9">
                <AvatarImage src={selected.sender_profile_pic ?? undefined} />
                <AvatarFallback className="bg-secondary text-xs">
                  {(selected.sender_name || selected.sender_username || "?").slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground truncate">
                    {selected.sender_name || selected.sender_username || "Anônimo"}
                  </span>
                  {selected.sender_username && (
                    <span className="text-xs text-muted-foreground">@{selected.sender_username}</span>
                  )}
                </div>
                {selected.instagram_account_id && accountsMap[selected.instagram_account_id] && (
                  <div className="text-[11px] text-muted-foreground">
                    Conta: {accountsMap[selected.instagram_account_id]}
                  </div>
                )}
              </div>
              {selected.post_id && (
                <a
                  href={`https://www.instagram.com/p/${selected.post_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1"
                >
                  <ExternalLink size={12} /> Ver post
                </a>
              )}
            </div>

            {/* Comments thread */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-muted/20">
              {selected.comments.map((c) => {
                const isOut = c.is_outbound;
                return (
                  <div key={c.id} className={`flex ${isOut ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[75%] rounded-2xl px-3.5 py-2 shadow-sm ${
                        isOut
                          ? "bg-primary text-primary-foreground rounded-br-sm"
                          : "bg-card border border-border rounded-bl-sm"
                      }`}
                    >
                      {!isOut && (
                        <div className="text-[11px] font-medium text-muted-foreground mb-0.5">
                          {c.sender_name || c.sender_username || "Anônimo"}
                        </div>
                      )}
                      <p className="text-sm whitespace-pre-wrap break-words">
                        {c.message_text || <span className="italic opacity-70">(sem texto)</span>}
                      </p>
                      <div
                        className={`text-[10px] mt-1 ${
                          isOut ? "text-primary-foreground/70" : "text-muted-foreground"
                        }`}
                      >
                        {format(new Date(c.created_at), "dd/MM HH:mm")}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Composer */}
            <div className="border-t border-border bg-background">
              {/* Mode toggle */}
              <div className="flex items-center gap-1 px-3 pt-2">
                <button
                  onClick={() => setReplyMode("comment")}
                  className={`text-xs px-2.5 py-1 rounded-md inline-flex items-center gap-1 transition-colors ${
                    replyMode === "comment"
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-secondary"
                  }`}
                >
                  <ReplyIcon size={12} /> Responder no post
                </button>
                <button
                  onClick={() => setReplyMode("dm")}
                  className={`text-xs px-2.5 py-1 rounded-md inline-flex items-center gap-1 transition-colors ${
                    replyMode === "dm"
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-secondary"
                  }`}
                >
                  <Send size={12} /> Enviar Direct
                </button>
                {replyMode === "dm" && (
                  <span className="text-[10px] text-muted-foreground ml-2">
                    Cria lead no funil Instagram
                  </span>
                )}
              </div>

              <div className="flex items-end gap-1 p-2">
                <EmojiPickerButton onEmojiSelect={insertEmoji} disabled={sending} />
                <Textarea
                  ref={textareaRef}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder={
                    replyMode === "comment"
                      ? "Responder publicamente neste comentário..."
                      : "Mensagem direta (DM) para este usuário..."
                  }
                  rows={1}
                  className="flex-1 min-h-[40px] max-h-32 resize-none bg-secondary border-border text-sm"
                  disabled={sending}
                />
                <Button
                  onClick={handleSend}
                  disabled={sending || !replyText.trim()}
                  size="icon"
                  className="h-10 w-10 flex-shrink-0"
                >
                  {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
