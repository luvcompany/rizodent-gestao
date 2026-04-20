import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { MessageSquare, Reply, Send, Search, Instagram, ExternalLink, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

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
  account_name?: string | null;
};

const INSTAGRAM_PIPELINE_ID = "c2d3e4f5-0001-4000-8000-000000000002";

export default function InstagramComments() {
  const [comments, setComments] = useState<IgComment[]>([]);
  const [accountsMap, setAccountsMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [replyOpen, setReplyOpen] = useState<IgComment | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyMode, setReplyMode] = useState<"comment" | "dm">("comment");
  const [sending, setSending] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [{ data: accounts }, { data: msgs }] = await Promise.all([
      supabase.from("instagram_accounts").select("instagram_account_id, name"),
      supabase
        .from("instagram_messages")
        .select("*")
        .eq("message_type", "comment")
        .order("created_at", { ascending: false })
        .limit(500),
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

  const filtered = useMemo(() => {
    if (!search.trim()) return comments;
    const q = search.toLowerCase();
    return comments.filter(
      (c) =>
        (c.sender_name || "").toLowerCase().includes(q) ||
        (c.sender_username || "").toLowerCase().includes(q) ||
        (c.message_text || "").toLowerCase().includes(q)
    );
  }, [comments, search]);

  const handleOpenReply = (c: IgComment, mode: "comment" | "dm") => {
    setReplyOpen(c);
    setReplyMode(mode);
    setReplyText("");
  };

  const handleSendReply = async () => {
    if (!replyOpen || !replyText.trim()) return;
    setSending(true);
    try {
      if (replyMode === "comment") {
        if (!replyOpen.comment_id || !replyOpen.instagram_account_id) {
          throw new Error("Comentário sem ID válido");
        }
        const { error } = await supabase.functions.invoke("instagram-send-message", {
          body: {
            instagram_account_id: replyOpen.instagram_account_id,
            comment_id: replyOpen.comment_id,
            message: replyText.trim(),
            message_type: "comment",
          },
        });
        if (error) throw error;
        toast.success("Resposta enviada ao comentário");
        // Mark as read
        await supabase.from("instagram_messages").update({ is_read: true }).eq("id", replyOpen.id);
      } else {
        // DM mode → ensure a lead exists in IG pipeline, then send DM
        if (!replyOpen.sender_id || !replyOpen.instagram_account_id) {
          throw new Error("Dados do remetente ausentes");
        }
        // Find / create lead
        let leadId: string | null = null;
        const { data: existing } = await supabase
          .from("crm_leads")
          .select("id")
          .eq("instagram_user_id", replyOpen.sender_id)
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
          const accountName = accountsMap[replyOpen.instagram_account_id] || "";
          const displayName =
            replyOpen.sender_name || replyOpen.sender_username || `IG ${replyOpen.sender_id.slice(0, 8)}`;
          const { data: created, error: createErr } = await supabase
            .from("crm_leads")
            .insert({
              name: displayName,
              pipeline_id: INSTAGRAM_PIPELINE_ID,
              stage_id: firstStage.id,
              source: accountName ? `Instagram (${accountName})` : "Instagram",
              instagram_user_id: replyOpen.sender_id,
              instagram_username: replyOpen.sender_username,
              instagram_profile_pic_url: replyOpen.sender_profile_pic,
            })
            .select("id")
            .single();
          if (createErr) throw createErr;
          leadId = created.id;
        }

        const { error } = await supabase.functions.invoke("instagram-send-message", {
          body: {
            instagram_account_id: replyOpen.instagram_account_id,
            lead_id: leadId,
            recipient_id: replyOpen.sender_id,
            message: replyText.trim(),
            message_type: "dm",
          },
        });
        if (error) throw error;
        toast.success("DM enviada — conversa criada na aba Direct");
      }
      setReplyOpen(null);
      setReplyText("");
    } catch (e: any) {
      console.error("[InstagramComments] reply error", e);
      toast.error(e?.message ?? "Falha ao enviar resposta");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <Instagram size={18} className="text-pink-500" />
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-foreground">Comentários do Instagram</h2>
          <p className="text-[11px] text-muted-foreground">
            Responda no próprio post ou inicie uma conversa por Direct
          </p>
        </div>
        <div className="relative w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar comentário..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 bg-secondary border-border text-sm"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 size={18} className="animate-spin mr-2" /> Carregando comentários...
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <MessageSquare size={36} className="opacity-40 mb-3" />
            <p className="text-sm">Nenhum comentário recebido ainda.</p>
          </div>
        )}

        <div className="divide-y divide-border">
          {filtered.map((c) => {
            const accountName = c.instagram_account_id ? accountsMap[c.instagram_account_id] : null;
            const initials = (c.sender_name || c.sender_username || "?").slice(0, 2).toUpperCase();
            return (
              <div
                key={c.id}
                className={`px-4 py-3 hover:bg-secondary/40 transition-colors ${
                  !c.is_read && !c.is_outbound ? "bg-primary/5" : ""
                }`}
              >
                <div className="flex gap-3">
                  <Avatar className="h-10 w-10 flex-shrink-0">
                    <AvatarImage src={c.sender_profile_pic ?? undefined} />
                    <AvatarFallback className="bg-secondary text-xs">{initials}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-foreground truncate">
                        {c.sender_name || c.sender_username || "Anônimo"}
                      </span>
                      {c.sender_username && (
                        <span className="text-xs text-muted-foreground">@{c.sender_username}</span>
                      )}
                      {accountName && (
                        <Badge variant="outline" className="h-5 text-[10px]">
                          {accountName}
                        </Badge>
                      )}
                      {!c.is_read && !c.is_outbound && (
                        <Badge variant="default" className="h-5 text-[10px] bg-primary">
                          Novo
                        </Badge>
                      )}
                      <span className="text-[10px] text-muted-foreground ml-auto">
                        {formatDistanceToNow(new Date(c.created_at), { addSuffix: true, locale: ptBR })}
                      </span>
                    </div>
                    <p className="text-sm text-foreground mt-1 break-words">
                      {c.message_text || <span className="italic text-muted-foreground">(sem texto)</span>}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleOpenReply(c, "comment")}
                        className="h-7 px-2 text-xs gap-1"
                      >
                        <Reply size={12} /> Responder no post
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleOpenReply(c, "dm")}
                        className="h-7 px-2 text-xs gap-1"
                      >
                        <Send size={12} /> Enviar Direct
                      </Button>
                      {c.post_id && (
                        <a
                          href={`https://www.instagram.com/p/${c.post_id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] text-muted-foreground hover:text-primary inline-flex items-center gap-1"
                        >
                          <ExternalLink size={11} /> Ver post
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Reply Dialog */}
      <Dialog open={!!replyOpen} onOpenChange={(o) => !o && setReplyOpen(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {replyMode === "comment" ? "Responder no comentário" : "Enviar Direct"}
            </DialogTitle>
          </DialogHeader>
          {replyOpen && (
            <div className="space-y-3">
              <div className="rounded-md bg-secondary/60 p-3 text-xs">
                <div className="font-medium">
                  {replyOpen.sender_name || replyOpen.sender_username || "Anônimo"}
                </div>
                <div className="text-muted-foreground mt-1">{replyOpen.message_text}</div>
              </div>
              <Textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder={
                  replyMode === "comment"
                    ? "Escreva sua resposta pública ao comentário..."
                    : "Escreva uma mensagem direta (DM) para este usuário..."
                }
                rows={4}
                className="bg-secondary border-border resize-none"
              />
              {replyMode === "dm" && (
                <p className="text-[11px] text-muted-foreground">
                  Será criado um lead no funil Instagram e a conversa aparecerá na aba Direct.
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReplyOpen(null)} disabled={sending}>
              Cancelar
            </Button>
            <Button onClick={handleSendReply} disabled={sending || !replyText.trim()}>
              {sending && <Loader2 size={14} className="animate-spin mr-1" />}
              Enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
