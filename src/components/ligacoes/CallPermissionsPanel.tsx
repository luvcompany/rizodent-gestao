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
// As ações (Ligar / Pedir de novo) seguem a MESMA regra do botão de ligar das
// conversas (podeLigarPorWhatsapp do número da permissão): número em
// coexistência com o app WhatsApp Business, desconectado ou sem módulo não
// oferece ligação pela API (INTEG-14). A página Ligações explica o porquê.

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
  /** Número (whatsapp_numbers.id) do pedido; null em linha antiga. */
  whatsappNumberId: string | null;
};

const REQUEST_TEXT = "📞 Solicitação de permissão de ligação enviada";

function normPhone(p?: string | null) {
  return (p || "").replace(/\D/g, "");
}

const STATUS_META: Record<PermStatus, { label: string; cls: string; icon: typeof Clock }> = {
  approved: { label: "Aprovada", cls: "bg-success-soft text-success-soft-foreground", icon: CheckCircle2 },
  pending: { label: "Aguardando resposta", cls: "bg-warning-soft text-warning-soft-foreground", icon: Clock },
  denied: { label: "Rejeitada", cls: "bg-destructive-soft text-destructive-soft-foreground", icon: XCircle },
  expired: { label: "Expirada", cls: "bg-slate-soft text-slate-soft-foreground", icon: ShieldQuestion },
  revoked: { label: "Revogada", cls: "bg-slate-soft text-slate-soft-foreground", icon: XCircle },
};

const FILTERS: { key: "all" | PermStatus; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "approved", label: "Aprovadas" },
  { key: "pending", label: "Aguardando" },
  { key: "denied", label: "Rejeitadas" },
];

export default function CallPermissionsPanel() {
  const navigate = useNavigate();
  const { initiateCall, requestCallPermission, podeLigarPorWhatsapp, state: callState } = useWhatsappCall();
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
        "consumer_phone, status, approved_at, expires_at, requested_at, updated_at, lead_id, whatsapp_number_id, lead:crm_leads!whatsapp_call_permissions_lead_id_fkey ( id, name, phone, whatsapp_number_id )",
      );

    // 2) Pedidos enviados (para derivar quem ainda não respondeu).
    const { data: reqs } = await supabase
      .from("messages")
      .select("lead_id, created_at, whatsapp_number_id")
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
        whatsappNumberId: p.whatsapp_number_id ?? lead?.whatsapp_number_id ?? null,
      });
      if (p.lead_id) coveredLeads.add(p.lead_id);
      if (phone) coveredPhones.add(phone);
    }

    // Pedidos sem permissão registrada -> "Aguardando".
    const pendingLeadIds: string[] = [];
    const reqDate: Record<string, string> = {};
    const reqNumero: Record<string, string | null> = {};
    for (const r of (reqs || []) as any[]) {
      if (!r.lead_id || coveredLeads.has(r.lead_id)) continue;
      if (!(r.lead_id in reqDate)) {
        reqDate[r.lead_id] = r.created_at;
        reqNumero[r.lead_id] = r.whatsapp_number_id ?? null;
        pendingLeadIds.push(r.lead_id);
      }
    }
    if (pendingLeadIds.length) {
      const { data: leads } = await supabase
        .from("crm_leads").select("id, name, phone, whatsapp_number_id").in("id", pendingLeadIds);
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
          whatsappNumberId: reqNumero[l.id] ?? l.whatsapp_number_id ?? null,
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
    <div className="overflow-hidden rounded-card border border-border/60 bg-card shadow-card">
      <div className="flex flex-wrap gap-1 border-b border-border/60 p-4">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
              filter === f.key ? "bg-primary text-primary-foreground shadow-brand" : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {f.label}
            <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${filter === f.key ? "bg-primary-foreground/25 text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
              {counts[f.key] ?? 0}
            </span>
          </button>
        ))}
      </div>

      <div>
        {loading ? (
          <div className="p-10 text-center text-sm text-muted-foreground">Carregando permissões…</div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-14 text-center">
            <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary-soft text-primary-soft-fg">
            <BellRing size={24} />
            </span>
            <p className="text-[15px] font-semibold text-foreground">Nenhuma solicitação nesta categoria</p>
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {filtered.map((it) => {
              const meta = STATUS_META[it.status];
              const Icon = meta.icon;
              const val = validity(it);
              const canCall = it.status === "approved" && !!it.phone;
              // INTEG-14: coexistência/desconectado não liga nem pede permissão pela API.
              const ligavel = podeLigarPorWhatsapp(it.whatsappNumberId);
              const numeroDaAcao = it.whatsappNumberId ?? undefined;
              return (
                <li key={it.key} className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-sunken/60 md:px-5">
                  <Avatar className="h-10 w-10 flex-shrink-0">
                    <AvatarFallback className="bg-primary-soft text-[13px] font-semibold text-primary-soft-fg">{(it.name || "?").slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-semibold text-foreground">{it.name}</span>
                      <span className={`inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-[11px] font-medium ${meta.cls}`}>
                        <Icon size={12} /> {meta.label}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs tabular-nums text-tertiary">
                      {it.phone && <span className="text-muted-foreground">{it.phone}</span>}
                      {val && <span>· {val}</span>}
                      {it.date && <span>· {formatDistanceToNow(new Date(it.date), { locale: ptBR, addSuffix: true })}</span>}
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1.5">
                    {!ligavel ? null : canCall ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="rounded-xl font-semibold text-success hover:bg-success-soft hover:text-success-soft-foreground"
                        disabled={callState.phase !== "idle"}
                        onClick={() => initiateCall({ toPhone: it.phone, leadId: it.leadId, leadName: it.name, whatsappNumberId: numeroDaAcao })}
                        title="Ligar via WhatsApp"
                      >
                        <Phone size={14} />
                        <span className="hidden sm:inline">Ligar</span>
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="rounded-xl text-muted-foreground hover:text-foreground"
                        disabled={!it.phone}
                        onClick={() => requestCallPermission({ toPhone: it.phone, leadId: it.leadId, whatsappNumberId: numeroDaAcao })}
                        title="Reenviar pedido de permissão"
                      >
                        <BellRing size={14} />
                        <span className="hidden sm:inline">{it.status === "pending" ? "Reenviar" : "Pedir de novo"}</span>
                      </Button>
                    )}
                    {it.leadId && (
                      <Button variant="ghost" size="sm" className="rounded-xl border border-border/60 bg-card font-medium hover:bg-muted" onClick={() => navigate(`/crm/conversa/${it.leadId}`)} title="Abrir conversa">
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
