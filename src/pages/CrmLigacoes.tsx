import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed, PhoneOff,
  Ban, AlertCircle, Search, MessageSquare, X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import AudioPlayer from "@/components/chat/AudioPlayer";
import AudioTranscriptionToggle from "@/components/chat/AudioTranscriptionToggle";
import { formatDistanceToNow, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

type CallCategory = "answered" | "missed" | "rejected" | "blocked" | "failed" | "ongoing";

type CallRow = {
  id: string;
  tenant_id: string;
  lead_id: string | null;
  from_phone: string | null;
  to_phone: string | null;
  direction: "inbound" | "outbound" | string;
  status: string | null;
  started_at: string | null;
  connected_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  error_message: string | null;
  recording_url: string | null;
  transcription: string | null;
  initiated_by: string | null;
  answered_by: string | null;
  lead?: { id: string; name: string | null; phone: string | null } | null;
};

const FILTERS: { key: CallCategory | "all"; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "answered", label: "Atendidas" },
  { key: "missed", label: "Perdidas" },
  { key: "rejected", label: "Recusadas" },
  { key: "blocked", label: "Bloqueadas" },
  { key: "failed", label: "Não completadas" },
];

function categorize(c: CallRow): CallCategory {
  const s = (c.status || "").toLowerCase();
  const err = (c.error_message || "").toLowerCase();
  if (["ringing", "connecting", "connected", "in_progress"].includes(s)) return "ongoing";
  if (err.includes("no approved call permission") || err.includes("2593090") || err.includes("permissão de ligação")) return "blocked";
  if (s === "completed" && (c.duration_seconds || 0) > 0) return "answered";
  if (s === "rejected" || s === "declined") return "rejected";
  if (["missed", "no_answer", "ringing_timeout", "unanswered"].includes(s)) return "missed";
  if ((c.duration_seconds || 0) === 0 && c.direction === "inbound" && (s === "ended" || s === "terminated")) return "missed";
  if (["failed", "error"].includes(s)) return "failed";
  return "failed";
}

function categoryMeta(cat: CallCategory, direction: string) {
  const inbound = direction === "inbound";
  switch (cat) {
    case "answered":
      return { icon: inbound ? PhoneIncoming : PhoneOutgoing, color: "text-emerald-600 dark:text-emerald-500", label: inbound ? "Recebida" : "Realizada" };
    case "missed":
      return { icon: PhoneMissed, color: "text-destructive", label: "Perdida" };
    case "rejected":
      return { icon: PhoneOff, color: "text-destructive", label: "Recusada" };
    case "blocked":
      return { icon: Ban, color: "text-orange-600 dark:text-orange-500", label: "Bloqueada pelo cliente" };
    case "failed":
      return { icon: AlertCircle, color: "text-muted-foreground", label: "Não completada" };
    case "ongoing":
      return { icon: Phone, color: "text-primary", label: "Ao vivo" };
  }
}

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function displayName(c: CallRow): string {
  if (c.lead?.name) return c.lead.name;
  const phone = c.direction === "inbound" ? c.from_phone : c.to_phone;
  return phone || "Desconhecido";
}

export default function CrmLigacoes() {
  const navigate = useNavigate();
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<CallCategory | "all">("all");
  const [directionFilter, setDirectionFilter] = useState<"all" | "inbound" | "outbound">("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<CallRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const { data, error } = await supabase
        .from("whatsapp_calls")
        .select(`
          id, tenant_id, lead_id, from_phone, to_phone, direction, status,
          started_at, connected_at, ended_at, duration_seconds, error_message,
          recording_url, transcription, initiated_by, answered_by,
          lead:crm_leads!whatsapp_calls_lead_id_fkey ( id, nome, telefone, avatar_url )
        `)
        .order("started_at", { ascending: false, nullsFirst: false })
        .limit(500);
      if (cancelled) return;
      if (error) {
        console.error("[ligacoes] load error:", error);
        toast.error("Erro ao carregar ligações");
      } else {
        setCalls((data as any) || []);
      }
      setLoading(false);
    }
    load();

    const channel = supabase
      .channel("whatsapp_calls_ligacoes")
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_calls" }, () => {
        load();
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return calls.filter((c) => {
      if (directionFilter !== "all" && c.direction !== directionFilter) return false;
      const cat = categorize(c);
      if (filter !== "all" && filter !== cat) return false;
      if (q) {
        const name = (c.lead?.name || "").toLowerCase();
        const phone = (c.from_phone || "") + " " + (c.to_phone || "") + " " + (c.lead?.phone || "");
        if (!name.includes(q) && !phone.includes(q)) return false;
      }
      return true;
    });
  }, [calls, filter, directionFilter, search]);

  const kpis = useMemo(() => {
    const scoped = calls.filter((c) => {
      if (directionFilter !== "all" && c.direction !== directionFilter) return false;
      return true;
    });
    const total = scoped.length;
    const answered = scoped.filter((c) => categorize(c) === "answered");
    const missed = scoped.filter((c) => categorize(c) === "missed").length;
    const rejected = scoped.filter((c) => categorize(c) === "rejected").length;
    const blocked = scoped.filter((c) => categorize(c) === "blocked").length;
    const avgDur = answered.length
      ? Math.round(answered.reduce((s, c) => s + (c.duration_seconds || 0), 0) / answered.length)
      : 0;
    const rate = total ? Math.round((answered.length / total) * 100) : 0;
    return { total, answered: answered.length, missed, rejected, blocked, avgDur, rate };
  }, [calls, directionFilter]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="p-4 md:p-6 border-b bg-background">
        <div className="flex items-center gap-2 mb-4">
          <Phone className="text-primary" />
          <h1 className="text-2xl font-semibold">Ligações</h1>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 md:gap-3 mb-4">
          <KpiCard label="Total" value={kpis.total} />
          <KpiCard label="Atendidas" value={kpis.answered} tone="success" />
          <KpiCard label="Taxa atend." value={`${kpis.rate}%`} />
          <KpiCard label="Duração média" value={kpis.avgDur ? formatDuration(kpis.avgDur) : "—"} />
          <KpiCard label="Perdidas" value={kpis.missed} tone="warn" />
          <KpiCard label="Bloqueadas" value={kpis.blocked} tone="warn" />
        </div>

        <div className="flex flex-wrap gap-2 mb-3">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                filter === f.key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background hover:bg-muted border-border"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
            <Input
              placeholder="Buscar por nome ou telefone"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9"
            />
          </div>
          <div className="flex gap-1">
            {(["all", "inbound", "outbound"] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDirectionFilter(d)}
                className={`px-3 py-1.5 text-xs rounded-md border ${
                  directionFilter === d ? "bg-secondary" : "bg-background hover:bg-muted"
                }`}
              >
                {d === "all" ? "Todas direções" : d === "inbound" ? "Recebidas" : "Realizadas"}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Carregando ligações…</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            <Phone className="mx-auto mb-3 opacity-30" size={32} />
            <p className="text-sm">Nenhuma ligação encontrada</p>
          </div>
        ) : (
          <ul className="divide-y">
            {filtered.map((c) => {
              const cat = categorize(c);
              const meta = categoryMeta(cat, c.direction);
              const Icon = meta.icon;
              const name = displayName(c);
              const dur = formatDuration(c.duration_seconds);
              const when = c.started_at ? new Date(c.started_at) : null;
              return (
                <li
                  key={c.id}
                  onClick={() => setSelected(c)}
                  className="flex items-center gap-3 p-3 md:px-6 hover:bg-muted/40 cursor-pointer"
                >
                  <Avatar className="h-10 w-10 flex-shrink-0">
                    {c.lead?.avatar_url ? <AvatarImage src={c.lead.avatar_url} /> : null}
                    <AvatarFallback>{(name || "?").slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`font-medium truncate ${cat === "missed" || cat === "rejected" ? "text-destructive" : ""}`}>
                        {name}
                      </span>
                      <span className="text-xs text-muted-foreground flex-shrink-0">
                        {when ? formatDistanceToNow(when, { locale: ptBR, addSuffix: true }) : ""}
                      </span>
                    </div>
                    <div className={`flex items-center gap-1.5 text-xs mt-0.5 ${meta.color}`}>
                      <Icon size={14} />
                      <span>{meta.label}</span>
                      {dur && <span className="text-muted-foreground">· {dur}</span>}
                      {c.recording_url && cat === "answered" && (
                        <span className="text-muted-foreground">· 🎙️ Gravado</span>
                      )}
                    </div>
                  </div>
                  {c.lead_id && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/crm/conversa/${c.lead_id}`);
                      }}
                      className="flex-shrink-0"
                    >
                      <MessageSquare size={14} className="mr-1" /> Conversa
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Sheet open={!!selected} onOpenChange={(v) => !v && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <Phone size={18} /> Detalhes da ligação
                </SheetTitle>
              </SheetHeader>
              <CallDetails call={selected} onGoToConversation={(leadId) => {
                setSelected(null);
                navigate(`/crm/conversa/${leadId}`);
              }} />
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function KpiCard({ label, value, tone }: { label: string; value: string | number; tone?: "success" | "warn" }) {
  const color = tone === "success" ? "text-emerald-600 dark:text-emerald-500"
    : tone === "warn" ? "text-orange-600 dark:text-orange-500"
    : "text-foreground";
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function CallDetails({ call, onGoToConversation }: { call: CallRow; onGoToConversation: (leadId: string) => void }) {
  const cat = categorize(call);
  const meta = categoryMeta(cat, call.direction);
  const Icon = meta.icon;
  const name = displayName(call);
  const phone = call.direction === "inbound" ? call.from_phone : call.to_phone;

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center gap-3">
        <Avatar className="h-14 w-14">
          {call.lead?.avatar_url ? <AvatarImage src={call.lead.avatar_url} /> : null}
          <AvatarFallback>{(name || "?").slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="font-semibold truncate">{name}</div>
          {phone && <div className="text-sm text-muted-foreground">{phone}</div>}
        </div>
      </div>

      <div className={`flex items-center gap-2 text-sm ${meta.color}`}>
        <Icon size={16} />
        <span className="font-medium">{meta.label}</span>
        {call.duration_seconds ? <span className="text-muted-foreground">· {formatDuration(call.duration_seconds)}</span> : null}
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <Info label="Direção" value={call.direction === "inbound" ? "Recebida" : "Realizada"} />
        <Info label="Status" value={call.status || "—"} />
        <Info label="Início" value={call.started_at ? format(new Date(call.started_at), "dd/MM/yyyy HH:mm:ss", { locale: ptBR }) : "—"} />
        <Info label="Atendida" value={call.connected_at ? format(new Date(call.connected_at), "dd/MM/yyyy HH:mm:ss", { locale: ptBR }) : "—"} />
        <Info label="Encerrada" value={call.ended_at ? format(new Date(call.ended_at), "dd/MM/yyyy HH:mm:ss", { locale: ptBR }) : "—"} />
        <Info label="Duração" value={formatDuration(call.duration_seconds) || "—"} />
      </dl>

      {call.error_message && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          <div className="font-medium mb-1">Mensagem de erro</div>
          <div className="whitespace-pre-wrap break-words">{call.error_message}</div>
        </div>
      )}

      {call.recording_url && cat === "answered" && (
        <div className="rounded-md border p-3 bg-card">
          <div className="text-xs font-medium mb-2 flex items-center gap-1.5">🎙️ Gravação da ligação</div>
          <AudioPlayer src={call.recording_url} />
          <AudioTranscriptionToggle callId={call.id} initialTranscription={call.transcription} />
        </div>
      )}

      <div className="flex gap-2 pt-2">
        {call.lead_id && (
          <Button className="flex-1" onClick={() => onGoToConversation(call.lead_id!)}>
            <MessageSquare size={14} className="mr-1.5" /> Ir para a conversa
          </Button>
        )}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium break-words">{value}</dd>
    </div>
  );
}
