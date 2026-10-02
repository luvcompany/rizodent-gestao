import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed, PhoneOff,
  Ban, AlertCircle, Search, MessageSquare, X, PhoneCall, Percent, Timer,
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
import { DateRangeFilter, getDateRangeFromFilter, type DateRangeFilterValue } from "@/components/ui/date-range-filter";
import CallPermissionsPanel from "@/components/ligacoes/CallPermissionsPanel";
import { numeroConectado, useWhatsappCall } from "@/contexts/WhatsappCallContext";
import { useAuth } from "@/contexts/AuthContext";

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
  source: "whatsapp" | "api4com";
  lead?: { id: string; name: string | null; phone: string | null } | null;
};

// Normaliza uma linha de api4com_calls para o formato unificado de CallRow.
function mapApi4comCall(r: any): CallRow {
  const s = String(r.status || "").toLowerCase();
  // "no-answer" NÃO vira "missed" direto — a categorização decide por direção
  // (recebida não atendida = Perdida; realizada não atendida = Não atendida).
  const mappedStatus = s === "answered" ? "completed" : s === "no-answer" ? "no_answer" : s;
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    lead_id: r.lead_id ?? null,
    from_phone: r.from_phone ?? null,
    to_phone: r.to_phone ?? null,
    direction: r.direction || "outbound",
    status: mappedStatus,
    started_at: r.started_at ?? r.created_at ?? null,
    connected_at: r.answered_at ?? null,
    ended_at: r.ended_at ?? null,
    duration_seconds: r.duration_seconds ?? null,
    error_message: null,
    recording_url: r.recording_url ?? null,
    transcription: r.transcription ?? null,
    initiated_by: null,
    answered_by: null,
    source: "api4com",
    lead: r.lead ?? null,
  };
}

const FILTERS: { key: CallCategory | "all"; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "answered", label: "Atendidas" },
  { key: "missed", label: "Perdidas" },
  { key: "rejected", label: "Recusadas" },
  { key: "blocked", label: "Bloqueadas" },
  { key: "failed", label: "Não atendidas" },
];

function categorize(c: CallRow): CallCategory {
  const s = (c.status || "").toLowerCase();
  const err = (c.error_message || "").toLowerCase();
  if (["ringing", "connecting", "connected", "in_progress"].includes(s)) return "ongoing";
  if (err.includes("no approved call permission") || err.includes("2593090") || err.includes("permissão de ligação")) return "blocked";
  // Atendida: duração > 0, OU (telefonia) foi atendida/gravada mesmo sem duração informada.
  if (s === "completed" && ((c.duration_seconds || 0) > 0 || !!c.recording_url || !!c.connected_at)) return "answered";
  if (s === "rejected" || s === "declined") return "rejected";
  // Não atendida: RECEBIDA sem atender = Perdida; REALIZADA sem atender = Não atendida (failed).
  if (["missed", "no_answer", "ringing_timeout", "unanswered"].includes(s)) return c.direction === "inbound" ? "missed" : "failed";
  if ((c.duration_seconds || 0) === 0 && c.direction === "inbound" && (s === "ended" || s === "terminated")) return "missed";
  if (["failed", "error"].includes(s)) return "failed";
  return "failed";
}

function categoryMeta(cat: CallCategory, direction: string) {
  const inbound = direction === "inbound";
  switch (cat) {
    case "answered":
      return { icon: inbound ? PhoneIncoming : PhoneOutgoing, color: "bg-success-soft text-success-soft-foreground", label: inbound ? "Recebida" : "Realizada" };
    case "missed":
      return { icon: PhoneMissed, color: "bg-destructive-soft text-destructive-soft-foreground", label: "Perdida" };
    case "rejected":
      return { icon: PhoneOff, color: "bg-destructive-soft text-destructive-soft-foreground", label: "Recusada" };
    case "blocked":
      return { icon: Ban, color: "bg-slate-soft text-slate-soft-foreground", label: "Bloqueada pelo cliente" };
    case "failed":
      return { icon: inbound ? AlertCircle : PhoneOff, color: "bg-warning-soft text-warning-soft-foreground", label: inbound ? "Não completada" : "Não atendida" };
    case "ongoing":
      return { icon: Phone, color: "bg-info-soft text-info-soft-foreground", label: "Ao vivo" };
  }
}

/**
 * INTEG-22: status da ligação em PT-BR no detalhe (antes saía cru:
 * 'completed', 'no_answer', 'ringing', 'answered' da Api4Com…). Ligação
 * encerrada usa o MESMO rótulo da lista (categoryMeta), para o detalhe nunca
 * contradizer a linha ("Encerrada" numa ligação que a lista chama de "Não
 * atendida"); ligação em curso diz em que pé está. A exceção é a atendida: o
 * rótulo da lista ("Realizada"/"Recebida") é o da direção, que já aparece na
 * linha "Direção" ao lado — no Status ela é "Atendida".
 */
const STATUS_EM_CURSO: Record<string, string> = {
  ringing: "Chamando",
  connecting: "Conectando",
  connected: "Em andamento",
  in_progress: "Em andamento",
};

function statusLegivel(c: CallRow): string {
  const cat = categorize(c);
  if (cat === "ongoing") return STATUS_EM_CURSO[(c.status || "").toLowerCase()] ?? "Ao vivo";
  if (cat === "answered") return "Atendida";
  return categoryMeta(cat, c.direction).label;
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
  const { userRole } = useAuth();
  const { podeLigarPorWhatsapp, numerosVisiveis } = useWhatsappCall();
  // INTEG-14: telefonia (Api4Com) pronta para este usuário? null = lendo.
  const [telefoniaPronta, setTelefoniaPronta] = useState<boolean | null>(null);
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<CallCategory | "all">("all");
  const [directionFilter, setDirectionFilter] = useState<"all" | "inbound" | "outbound">("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<CallRow | null>(null);
  const [period, setPeriod] = useState<DateRangeFilterValue>({ preset: "this_month" });
  const [view, setView] = useState<"ligacoes" | "permissoes">("ligacoes");

  const firstLoad = useRef(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      // Só mostra "Carregando…" no 1º load. Refetches do realtime rodam em segundo
      // plano, mantendo a lista visível (evita o painel piscar a cada ligação/UPDATE).
      if (firstLoad.current) setLoading(true);
      const [wa, api4com] = await Promise.all([
        supabase
          .from("whatsapp_calls")
          .select(`
            id, tenant_id, lead_id, from_phone, to_phone, direction, status,
            started_at, connected_at, ended_at, duration_seconds, error_message,
            recording_url, transcription, initiated_by, answered_by,
            lead:crm_leads!whatsapp_calls_lead_id_fkey ( id, name, phone )
          `)
          .order("started_at", { ascending: false, nullsFirst: false })
          .limit(500),
        supabase
          .from("api4com_calls")
          .select(`
            id, tenant_id, lead_id, from_phone, to_phone, direction, status,
            started_at, answered_at, ended_at, duration_seconds,
            recording_url, transcription, created_at,
            lead:crm_leads!api4com_calls_lead_id_fkey ( id, name, phone )
          `)
          .order("created_at", { ascending: false })
          .limit(500),
      ]);
      if (cancelled) return;
      if (wa.error) {
        console.error("[ligacoes] whatsapp load error:", wa.error);
        toast.error("Erro ao carregar ligações");
      }
      // api4com pode não estar configurado ainda — silencioso se der erro.
      if (api4com.error) console.warn("[ligacoes] api4com load:", api4com.error?.message);

      const waRows: CallRow[] = ((wa.data as any) || []).map((r: any) => ({ ...r, source: "whatsapp" as const }));
      const apiRows: CallRow[] = ((api4com.data as any) || []).map(mapApi4comCall);
      const merged = [...waRows, ...apiRows].sort((a, b) => {
        const ta = a.started_at ? new Date(a.started_at).getTime() : 0;
        const tb = b.started_at ? new Date(b.started_at).getTime() : 0;
        return tb - ta;
      });
      setCalls(merged);
      // Mantém o detalhe aberto sincronizado com a versão mais nova da linha
      // (ex.: transcrição que acabou de ser gravada, status atualizado).
      setSelected((prev) => (prev ? merged.find((c) => c.id === prev.id) ?? prev : prev));
      firstLoad.current = false;
      setLoading(false);
    }
    load();

    const channel = supabase
      .channel("ligacoes_all")
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_calls" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "api4com_calls" }, () => load())
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    let ativo = true;
    Promise.resolve(supabase.rpc("api4com_dial_enabled"))
      .then(({ data, error }) => { if (ativo) setTelefoniaPronta(error ? null : !!data); })
      .catch(() => { if (ativo) setTelefoniaPronta(null); });
    return () => { ativo = false; };
  }, []);

  // INTEG-14: sem número que ligue pela API do WhatsApp e sem telefonia, a
  // página explica por que não há como ligar (antes só dizia "Nenhuma ligação
  // encontrada"). Coexistência é o caso da Santa Luzia: os números seguem no
  // app do celular e a Cloud API não faz chamadas neles.
  const avisoSemLigacao = useMemo(() => {
    if (!numerosVisiveis || telefoniaPronta !== false || podeLigarPorWhatsapp()) return null;
    const temCoexistencia = numerosVisiveis.some((n) => numeroConectado(n) && n.is_coexistence);
    return temCoexistencia
      ? "Números em coexistência com o app WhatsApp Business não fazem ligações pela API; conecte a telefonia em Integrações."
      : "Nenhum número de WhatsApp desta clínica faz ligações pela API agora; para ligar pelo CRM, conecte a telefonia em Integrações.";
  }, [numerosVisiveis, telefoniaPronta, podeLigarPorWhatsapp]);
  const podeAbrirIntegracoes = userRole === "crc" || userRole === "gerente" || userRole === "superadmin";

  const dateRange = useMemo(() => getDateRangeFromFilter(period), [period]);

  const dateScoped = useMemo(() => {
    if (!dateRange) return calls;
    return calls.filter((c) => {
      if (!c.started_at) return false;
      const t = new Date(c.started_at).getTime();
      return t >= dateRange.start.getTime() && t <= dateRange.end.getTime();
    });
  }, [calls, dateRange]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return dateScoped.filter((c) => {
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
  }, [dateScoped, filter, directionFilter, search]);

  const kpis = useMemo(() => {
    const scoped = dateScoped.filter((c) => {
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
  }, [dateScoped, directionFilter]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <header className="px-4 pt-4 md:px-6 md:pt-6 lg:px-7 lg:pt-7">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
              <Phone className="h-5 w-5" />
            </span>
            <h1 className="text-[28px] font-bold leading-tight tracking-tight text-foreground sm:text-[32px]">Ligações</h1>
          </div>
          {view === "ligacoes" && <DateRangeFilter value={period} onChange={setPeriod} />}
        </div>

        <div className="mb-5 flex w-fit max-w-full flex-wrap items-center gap-1 rounded-full border border-border/60 bg-card p-1 shadow-xs">
          {([
            { key: "ligacoes", label: "Ligações" },
            { key: "permissoes", label: "Permissões" },
          ] as const).map((t) => (
            <button
              key={t.key}
              onClick={() => setView(t.key)}
              className={`relative isolate inline-flex h-9 items-center justify-center whitespace-nowrap rounded-full px-4 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                view === t.key ? "text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {t.label}
              {view === t.key && <span className="absolute inset-0 -z-10 rounded-full bg-primary shadow-brand" />}
            </button>
          ))}
        </div>

        {avisoSemLigacao && (
          <div role="status" className="mb-5 flex flex-wrap items-center gap-3 rounded-xl bg-warning-soft px-4 py-3">
            <AlertCircle size={16} className="shrink-0 text-warning" />
            <p className="min-w-0 flex-1 basis-60 text-sm text-warning-soft-foreground">{avisoSemLigacao}</p>
            {podeAbrirIntegracoes && (
              <Button size="sm" variant="outline" className="rounded-xl bg-card" onClick={() => navigate("/crm/integracoes")}>
                Abrir Integrações
              </Button>
            )}
          </div>
        )}

        {view === "ligacoes" && (
        <>
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-6">
          <div className="relative">
            <span className="pointer-events-none absolute left-4 top-4 flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
              <Phone className="h-5 w-5" />
            </span>
            <KpiCard label="Total" value={kpis.total} />
          </div>
          <div className="relative">
            <span className="pointer-events-none absolute left-4 top-4 flex h-10 w-10 items-center justify-center rounded-xl bg-success-soft text-success">
              <PhoneCall className="h-5 w-5" />
            </span>
            <KpiCard label="Atendidas" value={kpis.answered} tone="success" />
          </div>
          <div className="relative">
            <span className="pointer-events-none absolute left-4 top-4 flex h-10 w-10 items-center justify-center rounded-xl bg-info-soft text-info">
              <Percent className="h-5 w-5" />
            </span>
            <KpiCard label="Taxa atend." value={`${kpis.rate}%`} />
          </div>
          <div className="relative">
            <span className="pointer-events-none absolute left-4 top-4 flex h-10 w-10 items-center justify-center rounded-xl bg-purple-soft text-purple">
              <Timer className="h-5 w-5" />
            </span>
            <KpiCard label="Duração média" value={kpis.avgDur ? formatDuration(kpis.avgDur) : "—"} />
          </div>
          <div className="relative">
            <span className="pointer-events-none absolute left-4 top-4 flex h-10 w-10 items-center justify-center rounded-xl bg-destructive-soft text-destructive">
              <PhoneMissed className="h-5 w-5" />
            </span>
            <KpiCard label="Perdidas" value={kpis.missed} tone="warn" />
          </div>
          <div className="relative">
            <span className="pointer-events-none absolute left-4 top-4 flex h-10 w-10 items-center justify-center rounded-xl bg-slate-soft text-slate">
              <Ban className="h-5 w-5" />
            </span>
            <KpiCard label="Bloqueadas" value={kpis.blocked} tone="warn" />
          </div>
        </div>

        <div className="rounded-t-card border border-b-0 border-border/60 bg-card p-4">
        <div className="mb-3 flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`inline-flex h-9 items-center justify-center whitespace-nowrap rounded-full px-4 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                filter === f.key
                  ? "bg-primary text-primary-foreground shadow-brand"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative min-w-[220px] max-w-md flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-tertiary" size={18} />
            <Input
              placeholder="Buscar por nome ou telefone"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10 rounded-xl border-transparent bg-surface-sunken pl-10 placeholder:text-tertiary focus-visible:bg-card"
            />
          </div>
          <div className="flex max-w-full flex-wrap gap-1 rounded-xl bg-surface-sunken p-1">
            {(["all", "inbound", "outbound"] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDirectionFilter(d)}
                className={`inline-flex h-8 items-center justify-center whitespace-nowrap rounded-lg px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  directionFilter === d ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {d === "all" ? "Todas direções" : d === "inbound" ? "Recebidas" : "Realizadas"}
              </button>
            ))}
          </div>
        </div>
        </div>
        </>
        )}
      </header>

      {view === "ligacoes" ? (
      <div className="px-4 pb-4 md:px-6 md:pb-6 lg:px-7 lg:pb-7">
        <div className="overflow-hidden rounded-b-card border border-border/60 bg-card shadow-card">
        {loading ? (
          <div className="p-10 text-center text-sm text-muted-foreground">Carregando ligações…</div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-14 text-center">
            <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary-soft text-primary-soft-fg">
              <Phone size={24} />
            </span>
            <p className="text-[15px] font-semibold text-foreground">Nenhuma ligação encontrada</p>
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
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
                  className="flex cursor-pointer items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-sunken/60 md:px-5"
                >
                  <Avatar className="h-10 w-10 flex-shrink-0">
                    <AvatarFallback className="bg-primary-soft text-[13px] font-semibold text-primary-soft-fg">{(name || "?").slice(0, 2).toUpperCase()}</AvatarFallback>

                  </Avatar>
                  <div className="min-w-0 flex-1 md:grid md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.9fr)] md:items-center md:gap-4">
                    <div className="flex min-w-0 items-center justify-between gap-2 md:block">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className={`truncate text-sm font-semibold ${cat === "missed" || cat === "rejected" ? "text-destructive" : "text-foreground"}`}>
                          {name}
                        </span>
                        {c.source === "api4com" && (
                          <span className="inline-flex h-5 flex-shrink-0 items-center rounded-full bg-slate-soft px-2 text-[10px] font-medium text-slate-soft-foreground">
                            Telefonia
                          </span>
                        )}
                      </span>
                      <span className="flex-shrink-0 whitespace-nowrap text-xs text-tertiary md:mt-0.5 md:block">
                        {when ? formatDistanceToNow(when, { locale: ptBR, addSuffix: true }) : ""}
                      </span>
                    </div>
                    <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs md:mt-0 md:contents">
                      <span className="flex min-w-0">
                      <span className={`inline-flex h-6 max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[11px] font-medium ${meta.color}`}>
                      <Icon size={13} className="shrink-0" />
                      <span className="truncate">{meta.label}</span>
                      </span>
                      </span>
                      <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs tabular-nums">
                      {dur && <span className="text-muted-foreground">· {dur}</span>}
                      {c.recording_url && (
                        <span className="text-muted-foreground">· 🎙️ Gravado</span>
                      )}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 justify-end sm:w-[112px]">
                  {c.lead_id && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/crm/conversa/${c.lead_id}`);
                      }}
                      className="flex-shrink-0 rounded-xl border border-border/60 bg-card font-medium hover:bg-muted"
                    >
                      <MessageSquare size={14} className="mr-1" /> Conversa
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
      ) : (
        <div className="px-4 pb-4 md:px-6 md:pb-6 lg:px-7 lg:pb-7">
          <CallPermissionsPanel />
        </div>
      )}

      <Sheet open={!!selected} onOpenChange={(v) => !v && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-3 text-lg font-semibold tracking-tight">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                    <Phone size={18} />
                  </span>
                  Detalhes da ligação
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
  const color = tone === "success" ? "text-foreground"
    : tone === "warn" ? "text-foreground"
    : "text-foreground";
  return (
    <div className="h-full rounded-card border border-border/60 bg-card p-4 pt-[68px] shadow-card">
      <div className="text-[13px] font-medium text-muted-foreground">{label}</div>
      <div className={`mt-1 text-[28px] font-bold leading-tight tracking-tight tabular-nums ${color}`}>{value}</div>
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
    <div className="mt-5 space-y-5">
      <div className="flex items-center gap-3">
        <Avatar className="h-14 w-14">
          <AvatarFallback className="bg-primary-soft text-lg font-semibold text-primary-soft-fg">{(name || "?").slice(0, 2).toUpperCase()}</AvatarFallback>

        </Avatar>
        <div className="min-w-0">
          <div className="truncate text-base font-semibold text-foreground">{name}</div>
          {phone && <div className="text-sm tabular-nums text-muted-foreground">{phone}</div>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={`inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[11px] font-medium ${meta.color}`}>
        <Icon size={13} className="shrink-0" />
        <span className="font-medium">{meta.label}</span>
        </span>
        {call.duration_seconds ? <span className="text-xs tabular-nums text-muted-foreground">· {formatDuration(call.duration_seconds)}</span> : null}
        <span className="ml-auto inline-flex h-6 items-center rounded-full bg-slate-soft px-2.5 text-[11px] font-medium text-slate-soft-foreground">
          {call.source === "api4com" ? "Telefonia" : "WhatsApp"}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-surface-sunken p-4 text-[13px]">
        <Info label="Direção" value={call.direction === "inbound" ? "Recebida" : "Realizada"} />
        <Info label="Status" value={call.status ? statusLegivel(call) : "—"} />
        <Info label="Início" value={call.started_at ? format(new Date(call.started_at), "dd/MM/yyyy HH:mm:ss", { locale: ptBR }) : "—"} />
        <Info label="Atendida" value={call.connected_at ? format(new Date(call.connected_at), "dd/MM/yyyy HH:mm:ss", { locale: ptBR }) : "—"} />
        <Info label="Encerrada" value={call.ended_at ? format(new Date(call.ended_at), "dd/MM/yyyy HH:mm:ss", { locale: ptBR }) : "—"} />
        <Info label="Duração" value={formatDuration(call.duration_seconds) || "—"} />
      </dl>

      {call.error_message && (
        <div className="rounded-xl bg-destructive-soft p-4 text-xs text-destructive-soft-foreground">
          <div className="mb-1 font-semibold">Mensagem de erro</div>
          <div className="whitespace-pre-wrap break-words">{call.error_message}</div>
        </div>
      )}

      {call.recording_url && (
        <div className="rounded-xl border border-border/60 bg-card p-4 shadow-xs">
          <div className="mb-2.5 flex items-center gap-1.5 text-[13px] font-semibold text-foreground">🎙️ Gravação da ligação</div>
          <AudioPlayer src={call.recording_url} />
          {call.source === "api4com" ? (
            <AudioTranscriptionToggle api4comCallId={call.id} initialTranscription={call.transcription} />
          ) : (
            <AudioTranscriptionToggle callId={call.id} initialTranscription={call.transcription} />
          )}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        {call.lead_id && (
          <Button className="h-10 flex-1 rounded-xl" onClick={() => onGoToConversation(call.lead_id!)}>
            <MessageSquare size={14} className="mr-1.5" /> Ir para a conversa
          </Button>
        )}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words font-medium tabular-nums text-foreground">{value}</dd>
    </div>
  );
}
