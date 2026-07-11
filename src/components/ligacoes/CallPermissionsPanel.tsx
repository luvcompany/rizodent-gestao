import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useWhatsappCall } from "@/contexts/WhatsappCallContext";
import { Phone, BellRing, MessageSquare, CheckCircle2, Clock, XCircle, ShieldQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

// Painel de "Permissões de ligação" (aba dentro de Ligações).
// Mostra as solicitações agrupadas por status. Fonte primária:
// whatsapp_call_permissions (approved/denied/pending/expired/revoked). Quem enviou
// pedido mas ainda não tem linha na tabela é derivado das mensagens de solicitação
// e mostrado como "Aguardando" — assim funciona mesmo antes do edge popular a tabela.

type PermStatus = "approved" | "pending" | "denied" | "expired" | "revoked";

type PermItem = {
  key: string;
  leadId: string | null;
  name: string;
  phone: string;
  status: PermStatus;
  date: string | null;
  expiresAt: string | null;
  permanent: boolean;
};

const REQUEST_TEXT = "📞 Solicitação de permissão de ligação enviada";

function normPhone(p?: string | null) {
  return (p || "").replace(/\D/g, "");
}

const STATUS_META: Record<PermStatus, { label: string; cls: string; icon: typeof Clock }> = {
  approved: { label: "Aprovada", cls: "text-emerald-600 dark:text-emerald-500 bg-emerald-500/10 border-emerald-500/20", icon: CheckCircle2 },
  pending: { label: "Aguardando resposta", cls: "text-amber-600 dark:text-amber-500 bg-amber-500/10 border-amber-500/20", icon: Clock },
  denied: { label: "Rejeitada", cls: "text-destructive bg-destructive/10 border-destructive/20", icon: XCircle },
  expired: { label: "Expirada", cls: "text-muted-foreground bg-muted border-border", icon: ShieldQuestion },
  revoked: { label: "Revogada", cls: "text-muted-foreground bg-muted border-border", icon: XCircle },
};

const FILTERS: { key: "all" | PermStatus; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "approved", label: "Aprovadas" },
  { key: "pending", label: "Aguardando" },
  { key: "denied", label: "Rejeitadas" },
];

export default function CallPermissionsPanel() {
  const navigate = useNavigate();
  const { initiateCall, requestCallPermission, state: callState } = useWhatsappCall();
  const [items, setItems] = useState<PermItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | PermStatus>("all");

  const load = useCallback(async () => {
    setLoading(true);
    const now = Date.now();

    // 1) Permissões já registradas (RLS já limita ao tenant).
    const { data: perms } = await supabase
      .from("whatsapp_call_permissions")
      .select(
        "consumer_phone, status, approved_at, expires_at, requested_at, updated_at, lead_id, lead:crm_leads!whatsapp_call_permissions_lead_id_fkey ( id, name, phone )",
      );

    // 2) Pedidos enviados (para derivar quem ainda não respondeu).
    const { data: reqs } = await supabase
      .from("messages")
      .select("lead_id, created_at")
      .eq("content", REQUEST_TEXT)
      .order("created_at", { ascending: false });

    const list: PermItem[] = [];
    const coveredLeads = new Set<string>();
    const coveredPhones = new Set<string>();

    for (const p of (perms || []) as any[]) {
      const lead = p.lead;
      const phone = normPhone(p.consumer_phone || lead?.phone);
      let status = (p.status as PermStatus) || "pending";
      const expiresAt = (p.expires_at as string | null) ?? null;
      const permanent = status === "approved" && !expiresAt;
      if (status === "approved" && expiresAt && new Date(expiresAt).getTime() < now) status = "expired";
      list.push({
        key: `perm-${phone || p.lead_id}`,
        leadId: p.lead_id ?? lead?.id ?? null,
        name: lead?.name || phone || "Desconhecido",
        phone: phone || (p.consumer_phone || ""),
        status,
        date: p.approved_at || p.requested_at || p.updated_at || null,
        expiresAt,
        permanent,
      });
      if (p.lead_id) coveredLeads.add(p.lead_id);
      if (phone) coveredPhones.add(phone);
    }

    // Pedidos sem permissão registrada -> "Aguardando".
    const pendingLeadIds: string[] = [];
    const reqDate: Record<string, string> = {};
    for (const r of (reqs || []) as any[]) {
      if (!r.lead_id || coveredLeads.has(r.lead_id)) continue;
      if (!(r.lead_id in reqDate)) {
        reqDate[r.lead_id] = r.created_at;
        pendingLeadIds.push(r.lead_id);
      }
    }
    if (pendingLeadIds.length) {
      const { data: leads } = await supabase
        .from("crm_leads").select("id, name, phone").in("id", pendingLeadIds);
      for (const l of (leads || []) as any[]) {
        const phone = normPhone(l.phone);
        if (phone && coveredPhones.has(phone)) continue;
        list.push({
          key: `req-${l.id}`,
          leadId: l.id,
          name: l.name || phone || "Desconhecido",
          phone,
          status: "pending",
          date: reqDate[l.id] || null,
          expiresAt: null,
          permanent: false,
        });
      }
    }

    list.sort((a, b) => (b.date ? new Date(b.date).getTime() : 0) - (a.date ? new Date(a.date).getTime() : 0));
    setItems(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const ch = supabase
      .channel("call-perms-panel")
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_call_permissions" }, () => {
        void load();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length, approved: 0, pending: 0, denied: 0 };
    for (const it of items) if (it.status in c) c[it.status] += 1;
    return c;
  }, [items]);

  const filtered = useMemo(
    () => (filter === "all" ? items : items.filter((i) => i.status === filter)),
    [items, filter],
  );

  function validity(it: PermItem): string {
    if (it.status === "approved") return it.permanent ? "Permanente" : it.expiresAt ? `Expira ${format(new Date(it.expiresAt), "dd/MM", { locale: ptBR })}` : "";
    if (it.status === "expired") return it.expiresAt ? `Expirou ${format(new Date(it.expiresAt), "dd/MM", { locale: ptBR })}` : "Expirou";
    return "";
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 md:px-6 py-3 flex flex-wrap gap-2 border-b bg-background">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
              filter === f.key ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted border-border"
            }`}
          >
            {f.label}
            <span className={`ml-1.5 text-xs ${filter === f.key ? "opacity-80" : "text-muted-foreground"}`}>
              {counts[f.key] ?? 0}
            </span>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Carregando permissões…</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            <BellRing className="mx-auto mb-3 opacity-30" size={32} />
            <p className="text-sm">Nenhuma solicitação nesta categoria</p>
          </div>
        ) : (
          <ul className="divide-y">
            {filtered.map((it) => {
              const meta = STATUS_META[it.status];
              const Icon = meta.icon;
              const val = validity(it);
              const canCall = it.status === "approved" && !!it.phone;
              return (
                <li key={it.key} className="flex items-center gap-3 p-3 md:px-6 hover:bg-muted/40">
                  <Avatar className="h-10 w-10 flex-shrink-0">
                    <AvatarFallback>{(it.name || "?").slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium truncate">{it.name}</span>
                      <span className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full border whitespace-nowrap ${meta.cls}`}>
                        <Icon size={11} /> {meta.label}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                      {it.phone && <span>{it.phone}</span>}
                      {val && <span>· {val}</span>}
                      {it.date && <span>· {formatDistanceToNow(new Date(it.date), { locale: ptBR, addSuffix: true })}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {canCall ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10"
                        disabled={callState.phase !== "idle"}
                        onClick={() => initiateCall({ toPhone: it.phone, leadId: it.leadId, leadName: it.name })}
                        title="Ligar via WhatsApp"
                      >
                        <Phone size={14} />
                        <span className="hidden sm:inline">Ligar</span>
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-foreground"
                        disabled={!it.phone}
                        onClick={() => requestCallPermission({ toPhone: it.phone, leadId: it.leadId })}
                        title="Reenviar pedido de permissão"
                      >
                        <BellRing size={14} />
                        <span className="hidden sm:inline">{it.status === "pending" ? "Reenviar" : "Pedir de novo"}</span>
                      </Button>
                    )}
                    {it.leadId && (
                      <Button variant="ghost" size="sm" onClick={() => navigate(`/crm/conversa/${it.leadId}`)} title="Abrir conversa">
                        <MessageSquare size={14} />
                        <span className="hidden md:inline">Conversa</span>
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
