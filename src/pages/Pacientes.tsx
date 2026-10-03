import { useState, useEffect, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Eye, Plus, Pencil, MessageCircle, Trash2, MoreHorizontal } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { DateRangeFilter, type DateRangeFilterValue, getDateRangeFromFilter } from "@/components/ui/date-range-filter";
import { InitialsAvatar, PageHeader, StatusPill } from "@/components/crm-ui";

interface PacienteView {
  id: string;
  nome: string;
  telefone: string;
  cidade: string | null;
  created_at: string;
  valor_contratado: number;
  ultimo_valor_pago: number | null;
  ultima_visita: string | null;
  clinica_nome: string | null;
  is_recorrente: boolean;
  valor_orto: number;
  ultimo_orto: number | null;
  lead_id: string | null;
}

const brl = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2 });

const Pacientes = () => {
  const [busca, setBusca] = useState("");
  const [dateFilter, setDateFilter] = useState<DateRangeFilterValue>({ preset: "all" });
  const [pacientes, setPacientes] = useState<PacienteView[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const [tipo, setTipo] = useState<"todos" | "recorrente" | "novo">("todos");
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [excluir, setExcluir] = useState<string[] | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  const [editar, setEditar] = useState<PacienteView | null>(null);
  const [form, setForm] = useState({ nome: "", telefone: "", cidade: "" });
  const [salvando, setSalvando] = useState(false);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);

      const buscarPaginas = async (tabela: string, colunas: string, ordem: string) => {
        const todas: any[] = [];
        for (let from = 0; ; from += 1000) {
          const { data } = await supabase.from(tabela).select(colunas).order(ordem, { ascending: false }).range(from, from + 999);
          if (!data || data.length === 0) break;
          todas.push(...data);
          if (data.length < 1000) break;
        }
        return todas;
      };

      const [{ data: pacs }, pagamentos, { data: clinicas }, vinculos] = await Promise.all([
        supabase.from("pacientes").select("id, nome, telefone, cidade, created_at").order("created_at", { ascending: false }),
        buscarPaginas("pagamentos", "paciente_id, valor, data_pagamento, clinica_id, tipo, recorrencia_orto", "data_pagamento"),
        supabase.from("clinicas").select("id, nome"),
        buscarPaginas("crm_lead_pacientes", "paciente_id, lead_id", "paciente_id"),
      ]);
      const leadMap = new Map<string, string>();
      (vinculos || []).forEach((v: any) => { if (!leadMap.has(v.paciente_id)) leadMap.set(v.paciente_id, v.lead_id); });

      if (!pacs) { setLoading(false); return; }

      const clinicaMap = new Map<string, string>();
      clinicas?.forEach((c) => clinicaMap.set(c.id, c.nome));

      // Hoje (local) — ignora pagamentos com data futura
      const hojeLocal = (() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      })();
      const pagamentosValidos = (pagamentos || []).filter((p: any) => !p.data_pagamento || p.data_pagamento <= hojeLocal);

      // Mensalidade de ortodontia (recorrencia_orto=true) NÃO soma no valor
      // exibido — a mesma regra do Dashboard, pra as duas telas baterem.
      // O paciente continua aparecendo na lista normalmente.
      const isFat = (p: any) => p.recorrencia_orto !== true;

      const contratadoMap = new Map<string, number>();
      pagamentosValidos.forEach((p: any) => {
        if (!isFat(p)) return;
        contratadoMap.set(p.paciente_id, (contratadoMap.get(p.paciente_id) || 0) + Number(p.valor || 0));
      });

      const pagMap = new Map<string, any[]>();
      pagamentosValidos.forEach((p: any) => {
        if (!pagMap.has(p.paciente_id)) pagMap.set(p.paciente_id, []);
        pagMap.get(p.paciente_id)!.push(p);
      });

      const toLocal = (d: Date) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
      };
      const range = getDateRangeFromFilter(dateFilter);
      const dataMinima = range ? toLocal(range.start) : null;
      const dataMaxima = range ? toLocal(range.end) : null;

      const result: PacienteView[] = [];
      const periodActive = !!(dataMinima || dataMaxima);
      for (const p of pacs) {
        const valorContratadoTotal = contratadoMap.get(p.id) || 0;
        let pags = pagMap.get(p.id) || [];

        if (periodActive) {
          pags = pags.filter((pg: any) => {
            if (dataMinima && pg.data_pagamento < dataMinima) return false;
            if (dataMaxima && pg.data_pagamento > dataMaxima) return false;
            return true;
          });
          if (pags.length === 0) continue;
        }

        const pagsFat = pags.filter(isFat);
        const valorContratado = periodActive
          ? pagsFat.reduce((s: number, pg: any) => s + Number(pg.valor || 0), 0)
          : valorContratadoTotal;
        // pags[0] é o pagamento mais recente porque o select já ordena por data_pagamento DESC.
        // "Última visita" reflete qualquer pagamento; "Último pagamento" (valor exibido)
        // considera só faturamento (exclui mensalidade de orto).
        const ultimaVisita = pags[0]?.data_pagamento || null;
        const pagsOrto = pags.filter((pg: any) => !isFat(pg));
        const valorOrto = pagsOrto.reduce((s: number, pg: any) => s + Number(pg.valor || 0), 0);
        const ultimoOrto = pagsOrto[0]?.valor != null ? Number(pagsOrto[0].valor) : null;
        const ultimoValorPago = pagsFat[0]?.valor != null ? Number(pagsFat[0].valor) : null;
        const clinicaNome = pags[0]?.clinica_id ? clinicaMap.get(pags[0].clinica_id) || null : null;
        const isRecorrente = (pagMap.get(p.id) || []).some((pg: any) => pg.tipo === "recorrente");

        result.push({
          ...p,
          valor_contratado: valorContratado,
          ultimo_valor_pago: ultimoValorPago,
          ultima_visita: ultimaVisita,
          clinica_nome: clinicaNome,
          is_recorrente: isRecorrente,
          valor_orto: valorOrto,
          ultimo_orto: ultimoOrto,
          lead_id: leadMap.get(p.id) ?? null,
        });
      }

      result.sort((a, b) => {
        if (a.ultima_visita && b.ultima_visita) return b.ultima_visita.localeCompare(a.ultima_visita);
        if (a.ultima_visita) return -1;
        if (b.ultima_visita) return 1;
        return 0;
      });

      setPacientes(result);
      setLoading(false);
    };
    fetchAll();
  }, [dateFilter, recarga]);

  const filtered = useMemo(() => {
    return pacientes.filter(
      (p) =>
        (tipo === "todos" || (tipo === "recorrente") === p.is_recorrente) &&
        (p.nome.toLowerCase().includes(busca.toLowerCase()) ||
        p.telefone.includes(busca))
    );
  }, [pacientes, busca, tipo]);

  const todosMarcados = filtered.length > 0 && filtered.every((p) => selecionados.has(p.id));
  const alternar = (id: string) => setSelecionados((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const alternarTodos = () => setSelecionados(todosMarcados ? new Set() : new Set(filtered.map((p) => p.id)));

  const confirmarExclusao = async () => {
    if (!excluir) return;
    setExcluindo(true);
    let ok = 0;
    for (const id of excluir) {
      const { error: e1 } = await supabase.from("pagamentos").delete().eq("paciente_id", id);
      if (e1) continue;
      const { error: e2 } = await supabase.from("tratamentos").delete().eq("paciente_id", id);
      if (e2) continue;
      const { data, error } = await supabase.from("pacientes").delete().eq("id", id).select("id");
      if (!error && data && data.length) ok++;
    }
    const falhas = excluir.length - ok;
    if (ok) toast.success(`${ok} ${ok === 1 ? "paciente excluído" : "pacientes excluídos"}`);
    if (falhas) toast.error(`${falhas} não ${falhas === 1 ? "pôde" : "puderam"} ser excluído(s) (sem permissão ou erro).`);
    setExcluindo(false);
    setExcluir(null);
    setSelecionados(new Set());
    setRecarga((n) => n + 1);
  };

  const abrirEditar = (p: PacienteView) => { setEditar(p); setForm({ nome: p.nome, telefone: p.telefone || "", cidade: p.cidade || "" }); };
  const salvarEdicao = async () => {
    if (!editar || !form.nome.trim()) return;
    setSalvando(true);
    const { error } = await supabase.from("pacientes").update({ nome: form.nome.trim(), telefone: form.telefone.trim(), cidade: form.cidade.trim() || null }).eq("id", editar.id);
    setSalvando(false);
    if (error) { toast.error("Não foi possível salvar: " + error.message); return; }
    toast.success("Paciente atualizado");
    setEditar(null);
    setRecarga((n) => n + 1);
  };

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader title="Pacientes" subtitle={`${pacientes.length} pacientes cadastrados`} actions={<Button
          onClick={() => navigate("/atendimento")}
        >
          <Plus size={18} className="mr-2" />
          Novo Atendimento
        </Button>} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="relative flex-1 space-y-1">
          <span className="text-xs text-muted-foreground">Busca</span>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome ou telefone..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="bg-secondary border-border pl-10"
            />
          </div>
        </div>
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">Período</span>
          <DateRangeFilter value={dateFilter} onChange={setDateFilter} />
        </div>
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">Tipo</span>
          <Select value={tipo} onValueChange={(v) => setTipo(v as typeof tipo)}>
            <SelectTrigger className="h-10 w-full rounded-xl sm:w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="recorrente">Recorrente</SelectItem>
              <SelectItem value="novo">Cliente novo</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {!loading && filtered.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border/60 bg-card px-4 py-2.5 shadow-xs">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={todosMarcados} onCheckedChange={alternarTodos} />
            Selecionar todos ({filtered.length})
          </label>
          {selecionados.size > 0 && (
            <>
              <span className="text-sm text-muted-foreground">{selecionados.size} selecionado(s)</span>
              <Button variant="destructive" className="ml-auto h-10 rounded-xl" onClick={() => setExcluir([...selecionados])}>
                <Trash2 size={16} className="mr-2" /> Excluir selecionados
              </Button>
            </>
          )}
        </div>
      )}

      {loading ? (
        <div className="text-center text-muted-foreground animate-pulse py-12">Carregando pacientes...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">Nenhum paciente encontrado.</div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((pac) => (
            <Card key={pac.id} className="border-border/60 bg-card transition-colors hover:border-primary/30">
              <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <Checkbox checked={selecionados.has(pac.id)} onCheckedChange={() => alternar(pac.id)} aria-label={`Selecionar ${pac.nome}`} />
                  <InitialsAvatar name={pac.nome} className="h-11 w-11 shrink-0" />
                  <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="break-words font-semibold">{pac.nome}</p>
                    {pac.is_recorrente ? (
                      <StatusPill tone="info">Recorrente</StatusPill>
                    ) : (
                      <StatusPill tone="primary">Cliente novo</StatusPill>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {pac.telefone} {pac.clinica_nome && `• ${pac.clinica_nome}`}
                  </p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-4 sm:justify-end">
                  <div className="space-y-0.5 sm:text-right">
                    {pac.valor_contratado > 0 && (
                      <p className="whitespace-nowrap text-sm font-semibold text-primary">
                        Contratado: R$ {brl(pac.valor_contratado)}
                      </p>
                    )}
                    {pac.valor_orto > 0 && (
                      <p className="whitespace-nowrap text-sm font-semibold text-info">
                        Mensalidade orto: R$ {brl(pac.valor_orto)}
                      </p>
                    )}
                    {pac.valor_contratado <= 0 && pac.ultimo_orto != null && (
                      <p className="whitespace-nowrap text-xs text-muted-foreground">Último pagamento orto: R$ {brl(pac.ultimo_orto)}</p>
                    )}
                    {pac.ultimo_valor_pago != null && (
                      <p className="whitespace-nowrap text-xs text-success">
                        Último pagamento: R$ {pac.ultimo_valor_pago.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </p>
                    )}
                    {pac.ultima_visita && (
                      <p className="text-xs text-muted-foreground">
                        Última visita: {new Date(pac.ultima_visita + "T12:00:00").toLocaleDateString("pt-BR")}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" size="icon" title="Ver ficha" className="text-muted-foreground hover:text-foreground" onClick={() => navigate(`/pacientes/${pac.id}`)}>
                      <Eye size={18} />
                    </Button>
                    <div className="hidden items-center gap-1 sm:flex">
                      <Button variant="ghost" size="icon" title="Editar" className="text-muted-foreground hover:text-foreground" onClick={() => abrirEditar(pac)}><Pencil size={17} /></Button>
                      {pac.lead_id && <Button variant="ghost" size="icon" title="Ver conversa" className="text-muted-foreground hover:text-foreground" onClick={() => navigate(`/crm/conversas?lead=${pac.lead_id}`)}><MessageCircle size={17} /></Button>}
                      <Button variant="ghost" size="icon" title="Excluir" className="text-muted-foreground hover:text-destructive" onClick={() => setExcluir([pac.id])}><Trash2 size={17} /></Button>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="text-muted-foreground sm:hidden" aria-label="Ações"><MoreHorizontal size={18} /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => abrirEditar(pac)}><Pencil size={15} className="mr-2" />Editar</DropdownMenuItem>
                        {pac.lead_id && <DropdownMenuItem onClick={() => navigate(`/crm/conversas?lead=${pac.lead_id}`)}><MessageCircle size={15} className="mr-2" />Ver conversa</DropdownMenuItem>}
                        <DropdownMenuItem className="text-destructive" onClick={() => setExcluir([pac.id])}><Trash2 size={15} className="mr-2" />Excluir</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog open={!!excluir} onOpenChange={(o) => !o && !excluindo && setExcluir(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {excluir?.length === 1 ? "paciente" : `${excluir?.length} pacientes`}?</AlertDialogTitle>
            <AlertDialogDescription>Os pagamentos e tratamentos {excluir?.length === 1 ? "dele" : "deles"} também serão apagados. Essa ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluindo}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={excluindo} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={(e) => { e.preventDefault(); void confirmarExclusao(); }}>
              {excluindo ? "Excluindo..." : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!editar} onOpenChange={(o) => !o && setEditar(null)}>
        <DialogContent className="rounded-2xl">
          <DialogHeader><DialogTitle>Editar paciente</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><span className="text-xs text-muted-foreground">Nome</span><Input className="h-10 rounded-xl" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
            <div className="space-y-1"><span className="text-xs text-muted-foreground">Telefone</span><Input className="h-10 rounded-xl" value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} /></div>
            <div className="space-y-1"><span className="text-xs text-muted-foreground">Cidade</span><Input className="h-10 rounded-xl" value={form.cidade} onChange={(e) => setForm({ ...form, cidade: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="h-10 rounded-xl" onClick={() => setEditar(null)}>Cancelar</Button>
            <Button className="h-10 rounded-xl" disabled={salvando || !form.nome.trim()} onClick={salvarEdicao}>{salvando ? "Salvando..." : "Salvar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Pacientes;
