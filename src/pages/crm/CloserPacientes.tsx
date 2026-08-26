import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Search, Trash2, UserPlus, Wallet } from "lucide-react";
import { centavosParaValor, formatarMoeda, hojeNaClinica, mascaraMoeda } from "@/lib/moeda";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Pacientes do closer — universo próprio, separado do que vem do Dontus para o
 * crc. O vínculo aqui é MANUAL: é o closer quem cadastra o paciente e lança o
 * que foi pago. As tabelas closer_pacientes/closer_pagamentos já nascem
 * carimbadas com o número dele por gatilho no servidor, então cada closer
 * enxerga apenas os seus.
 */

type Paciente = {
  id: string;
  nome: string;
  telefone: string | null;
  cidade: string | null;
  observacoes: string | null;
  created_at: string;
  lead_id: string | null;
};

type Pagamento = {
  id: string;
  paciente_id: string;
  valor: number;
  data_pagamento: string;
  forma_pagamento: string | null;
  especialidade: string | null;
  clinica_id: string | null;
};

type Clinica = { id: string; nome: string; cidade: string | null };

const FORMAS = ["Pix", "Cartão de crédito", "Cartão de débito", "Dinheiro", "Boleto", "Financiamento"];

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const dataBR = (iso: string) => {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
};

export default function CloserPacientes() {
  const [pacientes, setPacientes] = useState<Paciente[]>([]);
  const [pagamentos, setPagamentos] = useState<Pagamento[]>([]);
  const [clinicas, setClinicas] = useState<Clinica[]>([]);
  const [especialidades, setEspecialidades] = useState<string[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");

  const [novoAberto, setNovoAberto] = useState(false);
  const [editandoPaciente, setEditandoPaciente] = useState<Paciente | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [form, setForm] = useState({ nome: "", telefone: "", cidade: "", observacoes: "" });


  const [pagamentoPara, setPagamentoPara] = useState<Paciente | null>(null);
  /** Pagamento em edição — corrigir preenchimento sem precisar apagar e relançar. */
  const [editando, setEditando] = useState<Pagamento | null>(null);
  const [formPag, setFormPag] = useState({
    valor: "",
    clinica_id: "",
    forma_pagamento: "",
    especialidade: "",
    data_pagamento: hojeNaClinica(),
  });

  const carregar = useCallback(async () => {
    setCarregando(true);
    const [pac, pag, cli, esp] = await Promise.all([
      (supabase as any)
        .from("closer_pacientes")
        .select("id, nome, telefone, cidade, observacoes, created_at, lead_id")
        .order("created_at", { ascending: false }),
      (supabase as any)
        .from("closer_pagamentos")
        .select("id, paciente_id, valor, data_pagamento, forma_pagamento, especialidade, clinica_id")
        .order("data_pagamento", { ascending: false }),
      (supabase as any).rpc("closer_clinicas_do_tenant"),
      (supabase as any).rpc("closer_especialidades_do_tenant"),
    ]);

    if (pac.error) toast.error(`Erro ao carregar pacientes: ${pac.error.message}`);
    setPacientes((pac.data as Paciente[]) || []);
    setPagamentos((pag.data as Pagamento[]) || []);
    setClinicas((cli.data as Clinica[]) || []);
    setEspecialidades((((esp.data as { especialidade: string }[]) || []).map((e) => e.especialidade)).filter(Boolean));
    setCarregando(false);
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const totalPorPaciente = useMemo(() => {
    const mapa = new Map<string, number>();
    pagamentos.forEach((p) => mapa.set(p.paciente_id, (mapa.get(p.paciente_id) || 0) + Number(p.valor)));
    return mapa;
  }, [pagamentos]);

  const pagamentosPorPaciente = useMemo(() => {
    const mapa = new Map<string, Pagamento[]>();
    pagamentos.forEach((p) => {
      const lista = mapa.get(p.paciente_id) || [];
      lista.push(p);
      mapa.set(p.paciente_id, lista);
    });
    return mapa;
  }, [pagamentos]);

  const nomeClinica = useCallback(
    (id: string | null) => (id ? clinicas.find((c) => c.id === id)?.nome ?? "—" : "—"),
    [clinicas],
  );

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return pacientes;
    return pacientes.filter(
      (p) =>
        p.nome.toLowerCase().includes(termo) ||
        (p.telefone || "").includes(termo) ||
        (p.cidade || "").toLowerCase().includes(termo),
    );
  }, [busca, pacientes]);

  /** Cidades vêm das clínicas do cliente — não é digitação livre. */
  const cidades = useMemo(() => {
    const set = new Set<string>();
    clinicas.forEach((c) => c.cidade && set.add(c.cidade));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [clinicas]);

  const totalGeral = useMemo(
    () => pagamentos.reduce((s, p) => s + Number(p.valor), 0),
    [pagamentos],
  );

  const salvarPaciente = async () => {
    if (!form.nome.trim()) {
      toast.error("Informe o nome do paciente");
      return;
    }
    setSalvando(true);
    const { error } = await (supabase as any).from("closer_pacientes").insert({
      nome: form.nome.trim(),
      telefone: form.telefone.trim() || null,
      cidade: form.cidade.trim() || null,
      observacoes: form.observacoes.trim() || null,
    });
    setSalvando(false);
    if (error) {
      toast.error(`Não foi possível salvar: ${error.message}`);
      return;
    }
    toast.success("Paciente vinculado");
    setForm({ nome: "", telefone: "", cidade: "", observacoes: "" });
    setNovoAberto(false);
    void carregar();
  };

  const salvarPagamento = async () => {
    if (!pagamentoPara) return;
    const valor = centavosParaValor(formPag.valor);
    if (!valor || valor <= 0) {
      toast.error("Informe um valor válido");
      return;
    }
    setSalvando(true);
    const { error } = await (supabase as any).from("closer_pagamentos").insert({
      paciente_id: pagamentoPara.id,
      valor,
      clinica_id: formPag.clinica_id || null,
      forma_pagamento: formPag.forma_pagamento.trim() || null,
      especialidade: formPag.especialidade.trim() || null,
      data_pagamento: formPag.data_pagamento,
    });
    setSalvando(false);
    if (error) {
      toast.error(`Não foi possível lançar: ${error.message}`);
      return;
    }
    toast.success("Pagamento lançado");
    setPagamentoPara(null);
    setFormPag({ valor: "", clinica_id: "", forma_pagamento: "", especialidade: "", data_pagamento: hojeNaClinica() });
    void carregar();
  };

  const abrirEdicao = (pg: Pagamento) => {
    setEditando(pg);
    setFormPag({
      valor: formatarMoeda(Number(pg.valor)),
      clinica_id: pg.clinica_id || "",
      forma_pagamento: pg.forma_pagamento || "",
      especialidade: pg.especialidade || "",
      data_pagamento: pg.data_pagamento.slice(0, 10),
    });
  };

  const salvarEdicao = async () => {
    if (!editando) return;
    const valor = centavosParaValor(formPag.valor);
    if (!valor || valor <= 0) {
      toast.error("Informe um valor válido");
      return;
    }
    setSalvando(true);
    const { error } = await (supabase as any)
      .from("closer_pagamentos")
      .update({
        valor,
        clinica_id: formPag.clinica_id || null,
        forma_pagamento: formPag.forma_pagamento || null,
        especialidade: formPag.especialidade || null,
        data_pagamento: formPag.data_pagamento,
      })
      .eq("id", editando.id);
    setSalvando(false);
    if (error) {
      toast.error(`Não foi possível salvar: ${error.message}`);
      return;
    }
    toast.success("Pagamento atualizado");
    setEditando(null);
    void carregar();
  };

  /**
   * Apagar é a última saída — com a edição disponível, o caminho normal para
   * corrigir um valor é editar. O botão
   * fica no caminho de quem quer consertar — e não pode disparar num toque
   * torto: confirma citando valor e data.
   */
  const apagarPagamento = async (pg: Pagamento) => {
    const ok = window.confirm(
      `Apagar o pagamento de ${brl(Number(pg.valor))} de ${dataBR(pg.data_pagamento)}?\n\nIsto não pode ser desfeito.`,
    );
    if (!ok) return;
    const { error } = await (supabase as any).from("closer_pagamentos").delete().eq("id", pg.id);
    if (error) {
      toast.error(`Não foi possível apagar: ${error.message}`);
      return;
    }
    toast.success("Pagamento removido");
    void carregar();
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Pacientes</h1>
          <p className="text-sm text-muted-foreground">
            Pacientes que você fechou e o que já foi pago por eles.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="rounded-xl border border-border bg-card px-4 py-2 text-right">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Total gerado</div>
            <div className="text-lg font-semibold tabular-nums text-foreground">{brl(totalGeral)}</div>
          </div>
          <Button onClick={() => setNovoAberto(true)}>
            <UserPlus size={16} className="mr-1.5" /> Vincular paciente
          </Button>
        </div>
      </header>

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome, telefone ou cidade"
          className="pl-9"
        />
      </div>

      {carregando ? (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 size={18} className="animate-spin" /> Carregando…
        </div>
      ) : filtrados.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {busca ? "Nenhum paciente encontrado." : "Nenhum paciente vinculado ainda."}
          </p>
          {!busca && (
            <Button variant="outline" className="mt-3" onClick={() => setNovoAberto(true)}>
              <UserPlus size={16} className="mr-1.5" /> Vincular o primeiro
            </Button>
          )}
        </div>
      ) : (
        <ul className="space-y-3">
          {filtrados.map((p) => {
            const lista = pagamentosPorPaciente.get(p.id) || [];
            return (
              <li key={p.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">{p.nome}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {[p.telefone, p.cidade].filter(Boolean).join(" · ") || "Sem contato informado"}
                    </div>
                    {p.observacoes && (
                      <p className="mt-1.5 text-xs text-muted-foreground">{p.observacoes}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Pago</div>
                      <div className="font-semibold tabular-nums text-foreground">
                        {brl(totalPorPaciente.get(p.id) || 0)}
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setPagamentoPara(p)}>
                      <Plus size={14} className="mr-1" /> Pagamento
                    </Button>
                  </div>
                </div>

                {lista.length > 0 && (
                  <ul className="mt-3 space-y-1.5 border-t border-border pt-3">
                    {lista.map((pg) => (
                      <li key={pg.id} className="flex items-center justify-between gap-3 text-sm">
                        <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                          <Wallet size={14} className="shrink-0" />
                          <span className="tabular-nums">{dataBR(pg.data_pagamento)}</span>
                          <span className="truncate">
                            {nomeClinica(pg.clinica_id)}
                            {pg.especialidade ? ` · ${pg.especialidade}` : ""}
                            {pg.forma_pagamento ? ` · ${pg.forma_pagamento}` : ""}
                          </span>
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="font-medium tabular-nums text-foreground">{brl(Number(pg.valor))}</span>
                          <button
                            type="button"
                            onClick={() => abrirEdicao(pg)}
                            className="text-muted-foreground transition-colors hover:text-primary"
                            aria-label="Editar pagamento"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => apagarPagamento(pg)}
                            className="text-muted-foreground transition-colors hover:text-destructive"
                            aria-label="Remover pagamento"
                          >
                            <Trash2 size={14} />
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Vincular paciente */}
      <Dialog open={novoAberto} onOpenChange={setNovoAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vincular paciente</DialogTitle>
            <DialogDescription>
              O paciente fica ligado a você e entra no seu faturamento quando você lançar o pagamento.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="nome">Nome</Label>
              <Input id="nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="tel">Telefone</Label>
                <Input id="tel" value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Cidade</Label>
                <Select value={form.cidade || "none"} onValueChange={(v) => setForm({ ...form, cidade: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem localização</SelectItem>
                    {cidades.map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="obs">Observações</Label>
              <Input id="obs" value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNovoAberto(false)}>Cancelar</Button>
            <Button onClick={salvarPaciente} disabled={salvando}>
              {salvando && <Loader2 size={16} className="mr-1.5 animate-spin" />} Vincular
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lançar pagamento */}
      <Dialog
        open={!!pagamentoPara || !!editando}
        onOpenChange={(o) => { if (!o) { setPagamentoPara(null); setEditando(null); } }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editando ? "Editar pagamento" : "Lançar pagamento"}</DialogTitle>
            <DialogDescription>
              {editando
                ? pacientes.find((p) => p.id === editando.paciente_id)?.nome
                : pagamentoPara?.nome}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="valor">Valor</Label>
                <Input
                  id="valor"
                  inputMode="numeric"
                  placeholder="0,00"
                  value={formPag.valor}
                  onChange={(e) => setFormPag({ ...formPag, valor: mascaraMoeda(e.target.value) })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="data">Data do pagamento</Label>
                <Input
                  id="data"
                  type="date"
                  value={formPag.data_pagamento}
                  onChange={(e) => setFormPag({ ...formPag, data_pagamento: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Clínica</Label>
              <Select
                value={formPag.clinica_id}
                onValueChange={(v) => setFormPag({ ...formPag, clinica_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a clínica" />
                </SelectTrigger>
                <SelectContent>
                  {clinicas.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome}
                      {c.cidade ? ` — ${c.cidade}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Forma de pagamento</Label>
                <Select value={formPag.forma_pagamento} onValueChange={(v) => setFormPag({ ...formPag, forma_pagamento: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {FORMAS.map((f) => (<SelectItem key={f} value={f}>{f}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Especialidade</Label>
                <Select value={formPag.especialidade} onValueChange={(v) => setFormPag({ ...formPag, especialidade: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {especialidades.map((e) => (<SelectItem key={e} value={e}>{e}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setPagamentoPara(null); setEditando(null); }}>
              Cancelar
            </Button>
            <Button onClick={editando ? salvarEdicao : salvarPagamento} disabled={salvando}>
              {salvando && <Loader2 size={16} className="mr-1.5 animate-spin" />}
              {editando ? "Salvar" : "Lançar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
