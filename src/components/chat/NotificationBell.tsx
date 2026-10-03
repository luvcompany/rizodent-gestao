import { useState, useEffect, useCallback, useId, useRef } from "react";
import { Bell, BellOff } from "lucide-react";
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
import { avisarNoNavegador, categoriaDaNotificacao } from "@/lib/notificacoesNavegador";

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
  // Em ref: o canal do realtime não pode ser refeito a cada troca de rota.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
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
          // Notificação do navegador pelas preferências da aba Notificações
          // (INTEG-4). A `tag` faz o mesmo papel do `id` do toast.
          const tipo = categoriaDaNotificacao(n);
          if (tipo) {
            void avisarNoNavegador(user.id, tipo, {
              titulo: n.title,
              corpo: n.body,
              tag: `crm-notif-${n.id}`,
              aoClicar: (n as { type?: string }).type === "chat_interno"
                ? () => navigateRef.current("/crm/interno")
                : n.lead_id ? () => navigateRef.current(`/crm/conversa/${n.lead_id}`) : undefined,
            });
          }
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
    if ((n as { type?: string }).type === "chat_interno") {
      navigate("/crm/interno");
    } else if (n.lead_id) {
      navigate(`/crm/conversa/${n.lead_id}`);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={unreadCount > 0 ? `Notificações (${unreadCount} não lidas)` : "Notificações"}
          className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 data-[state=open]:bg-primary-soft data-[state=open]:text-primary-soft-fg"
        >
          <Bell size={18} />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none tabular-nums text-destructive-foreground ring-2 ring-background">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[34rem] max-w-[calc(100vw-1rem)] overflow-hidden rounded-2xl border-border/60 p-0 shadow-float"
        align="end"
        sideOffset={10}
        collisionPadding={8}
      >
        <div className="flex min-h-16 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-border/60 px-5 py-3">
          <h4 className="text-base font-semibold leading-6 text-foreground">Notificações</h4>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="-mr-2 h-8 shrink-0 rounded-xl px-3 text-xs font-semibold text-primary-soft-fg hover:bg-primary-soft hover:text-primary-soft-fg"
              onClick={markAllAsRead}
            >
              Marcar todas como lidas
            </Button>
          )}
        </div>
        <ScrollArea className="[&>[data-radix-scroll-area-viewport]]:max-h-[min(32rem,calc(100vh-8rem))]">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-10 text-center text-[13px] font-medium text-muted-foreground">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-tertiary">
                <BellOff size={20} />
              </span>
              Nenhuma notificação
            </div>
          ) : (
            notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => handleClick(n)}
                className={`group relative w-full border-b border-border/60 px-5 py-4 text-left transition-colors last:border-0 hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none ${
                  !n.is_read ? "crm-notif-nova bg-primary-soft-2" : ""
                }`}
              >
                <div className="grid grid-cols-[2.75rem_minmax(0,1fr)_0.5rem] items-start gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted text-tertiary group-[.crm-notif-nova]:bg-primary-soft group-[.crm-notif-nova]:text-primary-soft-fg">
                    <Bell size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium leading-5 text-foreground group-[.crm-notif-nova]:font-semibold">{n.title}</p>
                    {n.body && (
                      <p className="mt-1 line-clamp-3 break-words text-[13px] leading-5 text-muted-foreground">
                        {n.body}
                      </p>
                    )}
                    <p className="mt-1.5 text-xs leading-4 text-tertiary">
                      {formatDistanceToNow(new Date(n.created_at), {
                        addSuffix: true,
                        locale: ptBR,
                      })}
                    </p>
                  </div>
                  {!n.is_read && (
                    <span className="mt-1.5 h-2 w-2 rounded-full bg-primary" />
                  )}
                </div>
              </button>
            ))
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
};

export default NotificationBell;
