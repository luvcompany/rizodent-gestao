import { useState, useEffect, useCallback, useId } from "react";
import { Bell, BellRing } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useNavigate } from "react-router-dom";

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  lead_id: string | null;
  is_read: boolean;
  created_at: string;
};

const NotificationBell = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  // Nome de canal por INSTÂNCIA. Com um nome fixo, dois sinos na mesma página
  // pegavam o mesmo canal e o segundo chamava `.on()` depois do `subscribe()`
  // do primeiro — o cliente lança ali, e sem ErrorBoundary o React derrubava a
  // árvore inteira: a tela abria em branco, sem nada no console do usuário.
  const instancia = useId().replace(/:/g, "");
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const fetchNotifications = useCallback(async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from("crm_notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (data) setNotifications(data as Notification[]);
  }, [user?.id]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Realtime subscription
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`notifications-bell-${instancia}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "crm_notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const n = payload.new as Notification;
          setNotifications((prev) => [n, ...prev]);
          // `id` da própria notificação: se houver mais de um sino montado, os
          // dois avisam a mesma coisa e o usuário vê um aviso só.
          toast.info(n.title, { id: n.id, description: n.body || undefined });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const markAsRead = async (id: string) => {
    // Guarda o valor ANTERIOR para reverter com fidelidade: repor `false` fixo
    // marcaria como não lida uma notificação que já estava lida antes do clique.
    const estavaLida = notifications.find((n) => n.id === id)?.is_read ?? false;
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
    );
    // O `.select()` torna a resposta verificável: quando a regra do banco
    // recusa o update, não vem erro — vem sucesso com zero linhas, e o badge
    // zerado voltava a apitar no próximo carregamento.
    const { data, error } = await supabase
      .from("crm_notifications")
      .update({ is_read: true })
      .eq("id", id)
      .select("id");
    if (error || !data || data.length === 0) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: estavaLida } : n))
      );
      toast.error(
        error
          ? "Erro ao marcar como lida: " + error.message
          : "Seu perfil não tem permissão para marcar esta notificação como lida."
      );
    }
  };

  const markAllAsRead = async () => {
    const unreadIds = notifications.filter((n) => !n.is_read).map((n) => n.id);
    if (!unreadIds.length) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    const { data, error } = await supabase
      .from("crm_notifications")
      .update({ is_read: true })
      .in("id", unreadIds)
      .select("id");
    if (error) {
      setNotifications((prev) =>
        prev.map((n) => (unreadIds.includes(n.id) ? { ...n, is_read: false } : n))
      );
      toast.error("Erro ao marcar notificações como lidas: " + error.message);
      return;
    }
    const gravadas = new Set((data ?? []).map((d) => d.id));
    if (gravadas.size < unreadIds.length) {
      // Reverte só o que o banco não aceitou — o restante ficou lido de verdade.
      setNotifications((prev) =>
        prev.map((n) =>
          unreadIds.includes(n.id) && !gravadas.has(n.id)
            ? { ...n, is_read: false }
            : n
        )
      );
      toast.error("Seu perfil não tem permissão para marcar algumas notificações como lidas.");
    }
  };

  const handleClick = (n: Notification) => {
    markAsRead(n.id);
    setOpen(false);
    if (n.lead_id) {
      navigate(`/crm/conversa/${n.lead_id}`);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative rounded-control text-muted-foreground hover:bg-primary-soft hover:text-primary-soft-foreground" aria-label="Abrir notificações">
          <Bell size={20} />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground px-1">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(22rem,calc(100vw-1rem))] overflow-hidden p-0" align="end" sideOffset={10}>
        <div className="flex items-center justify-between border-b border-border/60 bg-card px-4 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-control bg-primary-soft text-primary-soft-foreground">
              <BellRing className="h-4 w-4" />
            </span>
            <div>
              <h4 className="text-sm font-semibold text-foreground">Notificações</h4>
              {unreadCount > 0 && <p className="text-xs text-muted-foreground">{unreadCount} não {unreadCount === 1 ? "lida" : "lidas"}</p>}
            </div>
          </div>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs text-primary hover:bg-primary-soft hover:text-primary-soft-foreground"
              onClick={markAllAsRead}
            >
              Marcar todas como lidas
            </Button>
          )}
        </div>
        <ScrollArea className="max-h-96 bg-popover">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-10 text-center text-sm text-muted-foreground">
              <span className="mb-3 grid h-10 w-10 place-items-center rounded-full bg-slate-soft text-slate-soft-foreground">
                <Bell className="h-4 w-4" />
              </span>
              Nenhuma notificação
            </div>
          ) : (
            notifications.map((n) => (
              <Button
                variant="ghost"
                key={n.id}
                onClick={() => handleClick(n)}
                className={`h-auto w-full justify-start rounded-none border-b border-border/60 px-4 py-3 text-left transition-colors last:border-0 hover:bg-surface-sunken ${
                  !n.is_read ? "bg-primary-soft/60" : "bg-popover"
                }`}
              >
                <div className="flex items-start gap-2">
                  {!n.is_read && (
                    <span className="mt-1.5 h-2 w-2 rounded-full bg-primary shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{n.title}</p>
                    {n.body && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {n.body}
                      </p>
                    )}
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {formatDistanceToNow(new Date(n.created_at), {
                        addSuffix: true,
                        locale: ptBR,
                      })}
                    </p>
                  </div>
                </div>
              </Button>
            ))
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
};

export default NotificationBell;
