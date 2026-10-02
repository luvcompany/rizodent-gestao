import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, AlertTriangle, MessageCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/crm-ui";
import { CalendarX } from "lucide-react";
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

const SITUACOES: { chave: Situacao; rotulo: string; cor: string }[] = [
  { chave: "compareceu", rotulo: "Compareceram", cor: "text-success" },
  { chave: "falta", rotulo: "Faltas", cor: "text-destructive" },
  { chave: "cancelado", rotulo: "Cancelamentos", cor: "text-muted-foreground" },
  { chave: "remarcado", rotulo: "Remarcados", cor: "text-purple" },
  { chave: "pendente", rotulo: "Pendentes", cor: "text-warning" },
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

type Lista = { titulo: string; leadIds: string[] };

function useListaLeads() {
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

function Num({ v, onClick, cor }: { v: number; onClick?: () => void; cor?: string }) {
  if (!v) return <span className="text-muted-foreground/60">0</span>;
  return (
    <button type="button" onClick={onClick} className={cn("font-semibold tabular-nums underline-offset-2 hover:underline", cor)}>
      {v}
    </button>
  );
}

function Cartao({ titulo, subtitulo, children }: { titulo: string; subtitulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border/60 bg-card shadow-card">
      <div className="border-b border-border/60 px-5 py-4">
        <h2 className="text-base font-semibold text-foreground">{titulo}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{subtitulo}</p>
      </div>
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}

const th = "bg-muted/50 px-3 py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap";
const td = "px-3 py-2.5 text-sm whitespace-nowrap border-t border-border/60";

export function SdrDiario({ modo, linhas, de, ate }: { modo: "feitos" | "do_dia"; linhas: LinhaDiaria[]; de: string; ate: string }) {
  const navigate = useNavigate();
  const { lista, setLista, linhas: det } = useListaLeads();
  const [sdrSel, setSdrSel] = useState("todas");
  const dias = useMemo(() => diasDoPeriodo(de, ate), [de, ate]);
  const sdrs = useMemo(() => {
    const m = new Map<string, string>();
    linhas.forEach((l) => m.set(l.user_id, l.nome));
    return Array.from(m, ([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [linhas]);
  const abrir = (titulo: string, rows: LinhaDiaria[]) => setLista({ titulo, leadIds: rows.map((r) => r.lead_id) });

  let corpo: React.ReactNode;
  if (modo === "feitos") {
    const feitos = linhas.filter((l) => l.dia_marcou >= de && l.dia_marcou <= ate);
    const de_ = (dia: string | null, uid: string | null) =>
      feitos.filter((l) => (!dia || l.dia_marcou === dia) && (!uid || l.user_id === uid));
    const diasUteis = dias.filter((d) => new Date(`${d}T12:00:00Z`).getUTCDay() !== 0).length || 1;
    corpo = (
      <Cartao titulo="Agendamentos feitos por dia" subtitulo="Quantas consultas cada SDR marcou, pelo dia em que marcou.">
        <table className="w-full">
          <thead><tr>
            <th className={th}>Dia</th>
            {sdrs.map((s) => <th key={s.id} className={cn(th, "text-right")}>{s.nome}</th>)}
            <th className={cn(th, "text-right")}>Total</th>
          </tr></thead>
          <tbody>
            {dias.map((d) => (
              <tr key={d}>
                <td className={td}><span className="tabular-nums">{dataBR(d).slice(0, 5)}</span> <span className="text-xs text-muted-foreground">{semana(d)}</span></td>
                {sdrs.map((s) => { const r = de_(d, s.id); return <td key={s.id} className={cn(td, "text-right")}><Num v={r.length} onClick={() => abrir(`${s.nome} marcou em ${dataBR(d)}`, r)} /></td>; })}
                <td className={cn(td, "text-right")}><Num v={de_(d, null).length} onClick={() => abrir(`Marcados em ${dataBR(d)}`, de_(d, null))} /></td>
              </tr>
            ))}
            <tr className="bg-muted/30 font-semibold">
              <td className={td}>Total</td>
              {sdrs.map((s) => { const r = de_(null, s.id); return <td key={s.id} className={cn(td, "text-right")}><Num v={r.length} onClick={() => abrir(`${s.nome}: marcados no período`, r)} /></td>; })}
              <td className={cn(td, "text-right")}><Num v={feitos.length} onClick={() => abrir("Marcados no período", feitos)} /></td>
            </tr>
            <tr>
              <td className={cn(td, "text-muted-foreground")}>Média por dia útil</td>
              {sdrs.map((s) => <td key={s.id} className={cn(td, "text-right tabular-nums text-muted-foreground")}>{(de_(null, s.id).length / diasUteis).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</td>)}
              <td className={cn(td, "text-right tabular-nums text-muted-foreground")}>{(feitos.length / diasUteis).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</td>
            </tr>
          </tbody>
        </table>
      </Cartao>
    );
  } else {
    const doDia = linhas.filter((l) => l.dia_consulta >= de && l.dia_consulta <= ate && (sdrSel === "todas" || l.user_id === sdrSel));
    const doDiaD = (dia: string | null) => doDia.filter((l) => !dia || l.dia_consulta === dia);
    const nomeSel = sdrSel === "todas" ? "Todas" : sdrs.find((s) => s.id === sdrSel)?.nome ?? "";
    corpo = (
      <div className="space-y-3">
        <div className="flex justify-end">
          <Select value={sdrSel} onValueChange={setSdrSel}>
            <SelectTrigger className="h-10 w-[220px] rounded-xl"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as SDRs</SelectItem>
              {sdrs.map((s) => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Cartao titulo="Consultas do dia" subtitulo="Consultas marcadas para acontecer em cada dia e o que aconteceu com elas.">
          <table className="w-full">
            <thead><tr>
              <th className={th}>Dia</th>
              <th className={cn(th, "text-right")}>Consultas do dia</th>
              {SITUACOES.map((s) => <th key={s.chave} className={cn(th, "text-right")}>{s.rotulo}</th>)}
            </tr></thead>
            <tbody>
              {[...dias.map((d) => d as string | null), null].map((d) => {
                const r = doDiaD(d);
                const fecha = SITUACOES.reduce((acc, s) => acc + r.filter((x) => x.situacao === s.chave).length, 0) === r.length;
                const rot = d ? dataBR(d) : "no período";
                return (
                  <tr key={d ?? "total"} className={cn(!d && "bg-muted/30 font-semibold")}>
                    <td className={td}>
                      {d ? <><span className="tabular-nums">{dataBR(d).slice(0, 5)}</span> <span className="text-xs text-muted-foreground">{semana(d)}</span></> : "Total"}
                      {!fecha && <AlertTriangle className="ml-1 inline h-3.5 w-3.5 text-destructive" />}
                    </td>
                    <td className={cn(td, "text-right")}><Num v={r.length} onClick={() => abrir(`${nomeSel}: consultas ${rot}`, r)} /></td>
                    {SITUACOES.map((s) => {
                      const rs = r.filter((x) => x.situacao === s.chave);
                      return <td key={s.chave} className={cn(td, "text-right")}><Num v={rs.length} cor={s.cor} onClick={() => abrir(`${nomeSel}: ${s.rotulo} ${rot}`, rs)} /></td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Cartao>
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
      <Dialog open={!!lista} onOpenChange={(o) => !o && setLista(null)}>
        <DialogContent className="max-w-3xl rounded-2xl">
          <DialogHeader><DialogTitle>{lista?.titulo} ({lista ? new Set(lista.leadIds).size : 0})</DialogTitle></DialogHeader>
          {!det ? (
            <div className="flex justify-center py-8"><Loader2 className="animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="max-h-[60vh] overflow-auto">
              <table className="w-full">
                <thead><tr><th className={th}>Nome</th><th className={th}>Telefone</th><th className={th}>Cidade</th><th className={th}></th></tr></thead>
                <tbody>
                  {det.map((r: any) => (
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
    </>
  );
}
