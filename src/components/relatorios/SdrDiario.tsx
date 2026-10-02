import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, AlertTriangle, MessageCircle, CalendarX, Trophy, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/crm-ui";
import { cn } from "@/lib/utils";
import { dataBR } from "@/lib/exportacaoRelatorios";

export type Situacao = "compareceu" | "falta" | "cancelado" | "remarcado" | "pendente";
export type LinhaDiaria = {
  appointment_id: string; user_id: string; nome: string; lead_id: string;
  dia_marcou: string; dia_consulta: string; situacao: Situacao;
};

export async function buscarSdrDiario(de: string, ate: string): Promise<LinhaDiaria[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("relatorio_sdr_diario", { p_de: de, p_ate: ate });
  if (error) throw new Error(error.message || "Não foi possível carregar.");
  return (data ?? []) as LinhaDiaria[];
}

const SITUACOES: { chave: Situacao; rotulo: string; pill: string }[] = [
  { chave: "compareceu", rotulo: "Compareceram", pill: "bg-success-soft text-success-soft-foreground" },
  { chave: "falta", rotulo: "Faltas", pill: "bg-destructive-soft text-destructive-soft-foreground" },
  { chave: "cancelado", rotulo: "Cancelamentos", pill: "bg-muted text-muted-foreground" },
  { chave: "remarcado", rotulo: "Remarcados", pill: "bg-purple-soft text-purple-soft-foreground" },
  { chave: "pendente", rotulo: "Pendentes", pill: "bg-warning-soft text-warning-soft-foreground" },
];

function diasDoPeriodo(de: string, ate: string): string[] {
  const out: string[] = [];
  const d = new Date(`${de}T12:00:00Z`);
  const fim = new Date(`${ate}T12:00:00Z`);
  while (d <= fim) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}

const semana = (dia: string) =>
  new Date(`${dia}T12:00:00Z`).toLocaleDateString("pt-BR", { weekday: "short", timeZone: "UTC" }).replace(".", "");

const iniciais = (nome: string) =>
  nome.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();

// ---------- Lista de leads (dialogo compartilhado) ----------

export type Lista = { titulo: string; leadIds: string[] };

export function useListaLeads() {
  const [lista, setLista] = useState<Lista | null>(null);
  const [linhas, setLinhas] = useState<any[] | null>(null);
  useEffect(() => {
    if (!lista) return;
    setLinhas(null);
    const ids = Array.from(new Set(lista.leadIds));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc("relatorio_agendamentos_detalhe", { _ids: ids }).then(({ data }: any) => setLinhas(data ?? []));
  }, [lista]);
  return { lista, setLista, linhas };
}

const th = "bg-muted/50 px-3 py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap";
const td = "px-3 py-2.5 text-sm whitespace-nowrap border-t border-border/60";

export function DialogoLeads({ lista, linhas, onClose }: { lista: Lista | null; linhas: any[] | null; onClose: () => void }) {
  const navigate = useNavigate();
  return (
    <Dialog open={!!lista} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl rounded-2xl">
        <DialogHeader><DialogTitle>{lista?.titulo} ({lista ? new Set(lista.leadIds).size : 0})</DialogTitle></DialogHeader>
        {!linhas ? (
          <div className="flex justify-center py-8"><Loader2 className="animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full">
              <thead><tr><th className={th}>Nome</th><th className={th}>Telefone</th><th className={th}>Cidade</th><th className={th}></th></tr></thead>
              <tbody>
                {linhas.map((r: any) => (
                  <tr key={r.lead_id}>
                    <td className={td}>{r.nome}</td>
                    <td className={cn(td, "tabular-nums")}>{r.telefone}</td>
                    <td className={td}>{r.cidade ?? "—"}</td>
                    <td className={cn(td, "text-right")}>
                      <Button size="sm" variant="outline" className="rounded-xl" onClick={() => navigate(`../../conversas?lead=${r.lead_id}`, { relative: "path" })}>
                        <MessageCircle size={14} className="mr-1" /> Ver conversa
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------- Balãozinho com os leads de um dia ----------

function BalaoDia({ titulo, rows, children, className }: { titulo: string; rows: LinhaDiaria[]; children: React.ReactNode; className?: string }) {
  const navigate = useNavigate();
  const [aberto, setAberto] = useState(false);
  const [det, setDet] = useState<any[] | null>(null);
  useEffect(() => {
    if (!aberto) return;
    setDet(null);
    const ids = Array.from(new Set(rows.map((r) => r.lead_id)));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc("relatorio_agendamentos_detalhe", { _ids: ids }).then(({ data }: any) => setDet(data ?? []));
  }, [aberto, rows]);
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button type="button" className={cn("rounded-lg px-2 py-1 tabular-nums transition-colors hover:bg-muted", className)}>
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 rounded-xl p-0">
        <div className="border-b border-border/60 px-4 py-3">
          <p className="text-sm font-semibold text-foreground">{titulo}</p>
          <p className="text-xs text-muted-foreground">{rows.length} {rows.length === 1 ? "agendamento" : "agendamentos"}</p>
        </div>
        <div className="max-h-64 overflow-auto p-2">
          {!det ? (
            <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : det.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">Nenhum lead encontrado.</p>
          ) : (
            det.map((r: any) => (
              <div key={r.lead_id} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/60">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{r.nome}</p>
                  <p className="text-xs tabular-nums text-muted-foreground">{r.telefone}</p>
                </div>
                <Button size="sm" variant="ghost" className="h-8 shrink-0 rounded-lg px-2 text-xs" onClick={() => navigate(`../../conversas?lead=${r.lead_id}`, { relative: "path" })}>
                  <MessageCircle size={13} className="mr-1" /> Conversa
                </Button>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------- Aba "Agendamentos feitos": comparativo por SDR ----------

function CartaoSdrFeitos({ nome, rows, diasUteis, destaque }: { nome: string; rows: LinhaDiaria[]; diasUteis: number; destaque?: boolean }) {
  const porDia = useMemo(() => {
    const m = new Map<string, LinhaDiaria[]>();
    rows.forEach((r) => { const arr = m.get(r.dia_marcou) ?? []; arr.push(r); m.set(r.dia_marcou, arr); });
    return m;
  }, [rows]);
  const diasCom = useMemo(() => Array.from(porDia.keys()).sort(), [porDia]);
  const melhor = useMemo(() => {
    let best: { dia: string; n: number } | null = null;
    porDia.forEach((v, k) => { if (!best || v.length > best.n) best = { dia: k, n: v.length }; });
    return best;
  }, [porDia]);

  return (
    <section className={cn("rounded-2xl border bg-card shadow-card", destaque ? "border-primary/40" : "border-border/60")}>
      <div className="flex items-center gap-3 border-b border-border/60 px-5 py-4">
        <span className={cn("flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold", destaque ? "bg-primary-soft text-primary-soft-fg" : "bg-muted text-muted-foreground")}>
          {destaque ? <Users size={16} /> : iniciais(nome)}
        </span>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-foreground">{nome}</h3>
          <p className="text-xs text-muted-foreground">{rows.length} {rows.length === 1 ? "agendamento" : "agendamentos"} no período</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 px-5 py-4">
        <div className="rounded-xl bg-muted/40 px-3 py-2.5">
          <p className="text-[11px] text-muted-foreground">Média por dia útil</p>
          <p className="text-lg font-semibold tabular-nums text-foreground">{(rows.length / diasUteis).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</p>
        </div>
        <div className="rounded-xl bg-muted/40 px-3 py-2.5">
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground"><Trophy size={11} /> Melhor dia</p>
          {melhor ? (
            <p className="text-lg font-semibold tabular-nums text-foreground">{melhor!.n} <span className="text-xs font-normal text-muted-foreground">em {dataBR(melhor!.dia).slice(0, 5)}</span></p>
          ) : (
            <p className="text-lg font-semibold text-muted-foreground">—</p>
          )}
        </div>
      </div>
      <div className="border-t border-border/60 px-5 py-3">
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Por dia</p>
        {diasCom.length === 0 ? (
          <p className="py-2 text-xs text-muted-foreground">Nenhum agendamento no período.</p>
        ) : (
          <div className="max-h-56 overflow-auto">
            {diasCom.map((d) => {
              const r = porDia.get(d)!;
              return (
                <div key={d} className="flex items-center justify-between border-b border-border/60 py-1 last:border-0">
                  <span className="text-sm text-foreground"><span className="tabular-nums">{dataBR(d).slice(0, 5)}</span> <span className="text-xs text-muted-foreground">{semana(d)}</span></span>
                  <BalaoDia titulo={`${nome} marcou em ${dataBR(d)}`} rows={r} className="text-sm font-semibold text-foreground">
                    {r.length}
                  </BalaoDia>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

// ---------- Aba "Consultas do dia": cartão por dia ----------

function CartaoDia({ dia, rows, onAbrir }: { dia: string | null; rows: LinhaDiaria[]; onAbrir: (titulo: string, rows: LinhaDiaria[]) => void }) {
  const rot = dia ? dataBR(dia) : "no período";
  const soma = SITUACOES.reduce((acc, s) => acc + rows.filter((x) => x.situacao === s.chave).length, 0);
  const fecha = soma === rows.length;
  return (
    <section className={cn("rounded-2xl border bg-card shadow-card", !dia && "border-primary/40", dia && "border-border/60")}>
      <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {dia ? <><span className="tabular-nums">{dataBR(dia)}</span> <span className="text-xs font-normal text-muted-foreground">{semana(dia)}</span></> : "Total no período"}
          </h3>
          <p className="text-xs text-muted-foreground">{rows.length} {rows.length === 1 ? "consulta" : "consultas"} {dia ? "neste dia" : "no período"}</p>
        </div>
        {!fecha && (
          <span className="flex items-center gap-1 rounded-full bg-destructive-soft px-2.5 py-1 text-[11px] font-medium text-destructive-soft-foreground">
            <AlertTriangle size={12} /> Soma não fecha
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2 px-5 py-4">
        {SITUACOES.map((s) => {
          const rs = rows.filter((x) => x.situacao === s.chave);
          return (
            <button
              key={s.chave}
              type="button"
              onClick={() => rs.length > 0 && onAbrir(`${s.rotulo} ${rot}`, rs)}
              className={cn("flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-transform", s.pill, rs.length > 0 && "hover:scale-[1.03]")}
            >
              {s.rotulo}
              <span className="text-sm font-bold tabular-nums">{rs.length}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ---------- Componente principal ----------

export function SdrDiario({ modo, linhas, de, ate }: { modo: "feitos" | "do_dia"; linhas: LinhaDiaria[]; de: string; ate: string }) {
  const { lista, setLista, linhas: det } = useListaLeads();
  const [sdrSel, setSdrSel] = useState("todas");
  const dias = useMemo(() => diasDoPeriodo(de, ate), [de, ate]);
  const sdrs = useMemo(() => {
    const m = new Map<string, string>();
    linhas.forEach((l) => m.set(l.user_id, l.nome));
    return Array.from(m, ([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [linhas]);

  let corpo: React.ReactNode;
  if (modo === "feitos") {
    const feitos = linhas.filter((l) => l.dia_marcou >= de && l.dia_marcou <= ate);
    const diasUteis = dias.filter((d) => new Date(`${d}T12:00:00Z`).getUTCDay() !== 0).length || 1;
    corpo = (
      <div className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Agendamentos feitos por dia</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Quantas consultas cada SDR marcou, pelo dia em que marcou. Clique no número do dia para ver os leads.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sdrs.map((s) => (
            <CartaoSdrFeitos key={s.id} nome={s.nome} rows={feitos.filter((l) => l.user_id === s.id)} diasUteis={diasUteis} />
          ))}
          <CartaoSdrFeitos nome="Equipe" rows={feitos} diasUteis={diasUteis} destaque />
        </div>
      </div>
    );
  } else {
    const doDia = linhas.filter((l) => l.dia_consulta >= de && l.dia_consulta <= ate && (sdrSel === "todas" || l.user_id === sdrSel));
    const porDia = new Map<string, LinhaDiaria[]>();
    doDia.forEach((l) => { const arr = porDia.get(l.dia_consulta) ?? []; arr.push(l); porDia.set(l.dia_consulta, arr); });
    const diasCom = Array.from(porDia.keys()).sort();
    corpo = (
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">Consultas do dia</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Consultas marcadas para acontecer em cada dia e o que aconteceu com elas.</p>
          </div>
          <Select value={sdrSel} onValueChange={setSdrSel}>
            <SelectTrigger className="h-10 w-[220px] rounded-xl"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as SDRs</SelectItem>
              {sdrs.map((s) => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {diasCom.length === 0 ? (
          <div className="rounded-2xl border border-border/60 bg-card shadow-card">
            <EmptyState icon={CalendarX} title="Nenhuma consulta no período" description="Escolha outro período ou outra SDR." />
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {diasCom.map((d) => <CartaoDia key={d} dia={d} rows={porDia.get(d)!} onAbrir={(t, r) => setLista({ titulo: t, leadIds: r.map((x) => x.lead_id) })} />)}
            <CartaoDia dia={null} rows={doDia} onAbrir={(t, r) => setLista({ titulo: t, leadIds: r.map((x) => x.lead_id) })} />
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      {linhas.length === 0 ? (
        <div className="rounded-2xl border border-border/60 bg-card shadow-card">
          <EmptyState icon={CalendarX} title="Nenhum agendamento no período" description="Escolha outro período no filtro." />
        </div>
      ) : corpo}
      <DialogoLeads lista={lista} linhas={det} onClose={() => setLista(null)} />
    </>
  );
}
