import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Search, UserPlus, UserRound, Wallet, X } from "lucide-react";
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
 * Paciente do closer dentro da conversa — mesmo lugar do LeadBudgetPanel do crc,
 * porém sobre closer_pacientes/closer_pagamentos (o painel do crc lê tabelas
 * bloqueadas para este perfil).
 *
 * O formato segue o do crc: um único formulário onde se preenche paciente e
 * pagamento de uma vez. Nome, telefone e cidade vêm do lead; cidade,
 * clínica e especialidade são listas — nada de digitar à mão o que o sistema
 * já sabe.
 */

type LeadMin = { id: string; name: string | null; phone: string | null; cidade?: string | null };

type Paciente = {
  id: string;
  nome: string;
  telefone: string | null;
  cidade: string | null;
  lead_id: string | null;
};

type Pagamento = {
  id: string;
  paciente_id: string;
  valor: number;
  data_pagamento: string;
  forma_pagamento: string | null;
  especialidade: string | null;
  tipo: string | null;
  clinica_id: string | null;
};

type Clinica = { id: string; nome: string; cidade: string | null };

const SEM_CIDADE = "none";

const FORMAS = ["Pix", "Cartão de crédito", "Cartão de débito", "Dinheiro", "Boleto", "Financiamento"];

const brl = (v: number) =>
  Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const dataBR = (iso: string) => {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
};

/** Tira o 55 para exibir como a pessoa digitaria. */
const semDDI = (tel: string | null) => {
  const d = (tel || "").replace(/\D/g, "");
  return d.startsWith("55") ? d.slice(2) : d;
};

/**
 * Vírgula, parênteses e aspas têm significado na sintaxe de filtro do
 * PostgREST: um nome como "Silva, João" quebraria a busca. Aqui eles são
 * removidos do termo antes de montar o filtro.
 */
const termoBusca = (v: string) => v.replace(/[,().*"\\%]/g, " ").trim();

export default function CloserLeadPacientePanel({ lead }: { lead: LeadMin }) {
  const [pacientes, setPacientes] = useState<Paciente[]>([]);
  /** Paciente cujo pagamento está sendo lançado (null = vinculando um novo). */
  const [alvoPagamento, setAlvoPagamento] = useState<Paciente | null>(null);
  /** Pagamento em edição — corrige preenchimento sem apagar e relançar. */
  const [editando, setEditando] = useState<Pagamento | null>(null);
  const [pagamentos, setPagamentos] = useState<Pagamento[]>([]);
  const [clinicas, setClinicas] = useState<Clinica[]>([]);
  const [especialidades, setEspecialidades] = useState<string[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  const [formAberto, setFormAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [resultados, setResultados] = useState<Paciente[]>([]);
  const [buscando, setBuscando] = useState(false);

  /**
   * Um formulário só: dados do paciente + do primeiro pagamento.
   * A data é calculada a cada abertura — o painel vive enquanto a aba do CRM
   * estiver aberta, e quem deixa o sistema aberto de um dia para o outro
   * pegaria a data de ontem já preenchida.
   */
  const formVazio = () => ({
    nome: "",
    telefone: "",
    cidade: SEM_CIDADE,
    clinica_id: "",
    valor: "",
    data_pagamento: hojeNaClinica(),
    tipo: "primeiro",
    especialidade: "",
    forma_pagamento: "",
  });
  const [form, setForm] = useState(formVazio);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data: pac } = await (supabase as any)
      .from("closer_pacientes")
      .select("id, nome, telefone, cidade, lead_id")
      .eq("lead_id", lead.id)
      .order("created_at", { ascending: true });

    const lista = ((pac as Paciente[]) || []);
    setPacientes(lista);

    if (lista.length > 0) {
      const { data: pgs } = await (supabase as any)
        .from("closer_pagamentos")
        .select("id, paciente_id, valor, data_pagamento, forma_pagamento, especialidade, tipo, clinica_id")
        .in("paciente_id", lista.map((p) => p.id))
        .order("data_pagamento", { ascending: false });
      setPagamentos((pgs as Pagamento[]) || []);
    } else {
      setPagamentos([]);
    }
    setCarregando(false);
  }, [lead.id]);

  useEffect(() => { void carregar(); }, [carregar]);

  useEffect(() => {
    (async () => {
      const [{ data: cli }, { data: esp }] = await Promise.all([
        (supabase as any).rpc("closer_clinicas_do_tenant"),
        (supabase as any).rpc("closer_especialidades_do_tenant"),
      ]);
      setClinicas((cli as Clinica[]) || []);
      setEspecialidades((((esp as { especialidade: string }[]) || []).map((e) => e.especialidade)).filter(Boolean));
    })();
  }, []);

  /** Cidades vêm das clínicas do cliente — não é lista fixa nem digitação. */
  const cidades = useMemo(() => {
    const set = new Set<string>();
    clinicas.forEach((c) => c.cidade && set.add(c.cidade));
    if (lead.cidade) set.add(lead.cidade);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [clinicas, lead.cidade]);

  const total = useMemo(() => pagamentos.reduce((s, p) => s + Number(p.valor), 0), [pagamentos]);

  const nomeClinica = useCallback(
    (id: string | null) => (id ? clinicas.find((c) => c.id === id)?.nome ?? "—" : "—"),
    [clinicas],
  );

  /**
   * Abre o formulário. Com um paciente, é para lançar pagamento nele; sem
   * paciente, é para vincular alguém novo a esta conversa — e aí nome,
   * telefone e cidade já vêm do lead.
   */
  const abrirFormulario = (alvo: Paciente | null) => {
    setAlvoPagamento(alvo);
    if (alvo) {
      const dele = pagamentos.filter((x) => x.paciente_id === alvo.id);
      setForm({
        ...formVazio(),
        nome: alvo.nome,
        telefone: alvo.telefone || "",
        cidade: alvo.cidade || SEM_CIDADE,
        // Repete a clínica do último lançamento: normalmente é a mesma.
        clinica_id: dele[0]?.clinica_id || "",
        tipo: dele.length > 0 ? "recorrente" : "primeiro",
      });
    } else {
      setForm({
        ...formVazio(),
        nome: lead.name || "",
        telefone: semDDI(lead.phone),
        cidade: lead.cidade || SEM_CIDADE,
      });
      setBusca(semDDI(lead.phone) || lead.name || "");
      setResultados([]);
    }
    setFormAberto(true);
  };

  const abrirEdicao = (pg: Pagamento) => {
    setEditando(pg);
    setAlvoPagamento(null);
    setForm({
      ...formVazio(),
      valor: formatarMoeda(Number(pg.valor)),
      clinica_id: pg.clinica_id || "",
      forma_pagamento: pg.forma_pagamento || "",
      especialidade: pg.especialidade || "",
      tipo: pg.tipo || "primeiro",
      data_pagamento: pg.data_pagamento.slice(0, 10),
    });
    setFormAberto(true);
  };

  const salvarEdicao = async () => {
    if (!editando) return;
    const valor = centavosParaValor(form.valor);
    if (valor <= 0) { toast.error("Informe um valor válido"); return; }
    setSalvando(true);
    // O `.select()` torna a resposta verificável: update barrado pela regra do
    // banco não devolve erro — devolve sucesso com zero linhas.
    const { data, error } = await (supabase as any)
      .from("closer_pagamentos")
      .update({
        valor,
        clinica_id: form.clinica_id || null,
        forma_pagamento: form.forma_pagamento || null,
        especialidade: form.especialidade || null,
        tipo: form.tipo || null,
        data_pagamento: form.data_pagamento,
      })
      .eq("id", editando.id)
      .select("id");
    setSalvando(false);
    if (error) { toast.error(`Não foi possível salvar: ${error.message}`); return; }
    if (!data || data.length === 0) {
      toast.error("Seu perfil não tem permissão para alterar este pagamento.");
      return;
    }
    toast.success("Pagamento atualizado");
    setEditando(null);
    setFormAberto(false);
    void carregar();
  };

  const buscar = async () => {
    const termo = termoBusca(busca);
    if (!termo) return;
    setBuscando(true);
    const { data } = await (supabase as any)
      .from("closer_pacientes")
      .select("id, nome, telefone, cidade, lead_id")
      .or(`nome.ilike.%${termo}%,telefone.ilike.%${termo}%`)
      .limit(20);
    setResultados((data as Paciente[]) || []);
    setBuscando(false);
  };

  const vincularExistente = async (id: string) => {
    setSalvando(true);
    const { data, error } = await (supabase as any)
      .from("closer_pacientes")
      .update({ lead_id: lead.id, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id");
    setSalvando(false);
    if (error) {
      toast.error(
        error.code === "23505"
          ? "Este paciente já está vinculado a outra conversa."
          : `Não foi possível vincular: ${error.message}`,
      );
      return;
    }
    if (!data || data.length === 0) {
      toast.error("Seu perfil não tem permissão para vincular este paciente.");
      return;
    }
    toast.success("Paciente vinculado");
    setFormAberto(false);
    void carregar();
  };

  const ultimos8 = (tel: string) => String(tel || "").replace(/\D/g, "").slice(-8);

  const lancarPagamentoEm = async (pacienteId: string) => {
    const valor = centavosParaValor(form.valor);
    if (valor <= 0) return true; // nada a lançar
    if (!form.clinica_id) { toast.error("Escolha a clínica do pagamento"); return false; }
    const { error } = await (supabase as any).from("closer_pagamentos").insert({
      paciente_id: pacienteId,
      valor,
      clinica_id: form.clinica_id || null,
      forma_pagamento: form.forma_pagamento || null,
      especialidade: form.especialidade || null,
      tipo: form.tipo || null,
      data_pagamento: form.data_pagamento,
    });
    if (error) { toast.error(`Não foi possível lançar: ${error.message}`); return false; }
    return true;
  };

  /** Vincula (e opcionalmente lança o pagamento) numa transação só. */
  const salvar = async () => {
    const nome = form.nome.trim() || lead.name?.trim() || "";
    const valor = centavosParaValor(form.valor);

    if (alvoPagamento) {
      if (valor <= 0) { toast.error("Informe um valor válido"); return; }
      if (!form.clinica_id) { toast.error("Escolha a clínica do pagamento"); return; }
      setSalvando(true);
      const { error } = await (supabase as any).from("closer_pagamentos").insert({
        paciente_id: alvoPagamento.id,
        valor,
        clinica_id: form.clinica_id || null,
        forma_pagamento: form.forma_pagamento || null,
        especialidade: form.especialidade || null,
        tipo: form.tipo || null,
        data_pagamento: form.data_pagamento,
      });
      setSalvando(false);

      if (error) { toast.error(`Não foi possível lançar: ${error.message}`); return; }
      toast.success("Pagamento lançado");
      setFormAberto(false);
      void carregar();
      return;
    }

    if (!nome) { toast.error("Informe o nome do paciente"); return; }
    if (form.valor.trim() && valor <= 0) { toast.error("Informe um valor válido"); return; }
    if (valor > 0 && !form.clinica_id) { toast.error("Escolha a clínica do pagamento"); return; }

    const telChave = ultimos8(form.telefone);
    if (telChave) {
      const { data: candidatos } = await (supabase as any)
        .from("closer_pacientes")
        .select("id, nome, telefone, lead_id")
        .ilike("telefone", `%${telChave}%`)
        .limit(5);

      const existente = ((candidatos as Paciente[]) || []).find((p) => ultimos8(p.telefone) === telChave);

      if (existente) {
        if (!existente.lead_id || existente.lead_id === lead.id) {
          setSalvando(true);
          const { data: vinculado, error } = await (supabase as any)
            .from("closer_pacientes")
            .update({ lead_id: lead.id, updated_at: new Date().toISOString() })
            .eq("id", existente.id)
            .select("id");
          if (error) {
            setSalvando(false);
            toast.error(
              error.code === "23505"
                ? "Este paciente já está vinculado a outra conversa."
                : `Não foi possível vincular: ${error.message}`,
            );
            return;
          }
          // Sem esta conferência, o pagamento abaixo seria lançado num
          // paciente que não ficou vinculado a esta conversa.
          if (!vinculado || vinculado.length === 0) {
            setSalvando(false);
            toast.error("Seu perfil não tem permissão para vincular este paciente.");
            return;
          }
          const ok = await lancarPagamentoEm(existente.id);
          setSalvando(false);
          if (!ok) return;
          toast.success("Paciente já existia — vinculei este lead a ele");
          setFormAberto(false);
          setForm(formVazio());
          void carregar();
          return;
        }

        toast.error("Já existe um paciente com esse telefone vinculado a outra conversa.");
        return;
      }
    }

    setSalvando(true);
    const { error } = await (supabase as any).rpc("closer_vincular_paciente", {
      p_lead_id: lead.id,
      p_nome: nome,
      p_telefone: form.telefone.trim() || null,
      p_cidade: form.cidade === SEM_CIDADE ? null : form.cidade,
      p_valor: valor > 0 ? valor : null,
      p_clinica_id: form.clinica_id || null,
      p_data_pagamento: form.data_pagamento,
      p_tipo: form.tipo || null,
      p_especialidade: form.especialidade || null,
      p_forma_pagamento: form.forma_pagamento || null,
    });
    setSalvando(false);
    if (error) { toast.error(`Não foi possível vincular: ${error.message}`); return; }

    toast.success(valor > 0 ? "Paciente vinculado e pagamento lançado" : "Paciente vinculado");
    setFormAberto(false);
    setForm(formVazio());
    void carregar();
  };


  const desvincular = async (p: Paciente) => {
    const { data, error } = await (supabase as any)
      .from("closer_pacientes")
      .update({ lead_id: null })
      .eq("id", p.id)
      .select("id");
    if (error) {
      toast.error(`Não foi possível desvincular: ${error.message}`);
      return;
    }
    if (!data || data.length === 0) {
      toast.error("Seu perfil não tem permissão para remover este vínculo.");
      return;
    }
    toast.success("Vínculo removido — o paciente continua na sua aba Pacientes");
    void carregar();
  };

  if (carregando) {
    return (
      <div className="flex items-center gap-2 border-b border-border/60 px-5 py-5 text-[13px] text-muted-foreground">
        <Loader2 size={16} strokeWidth={1.75} className="animate-spin text-tertiary" /> Carregando paciente…
      </div>
    );
  }

  const pagamentosDe = (pacienteId: string) => pagamentos.filter((p) => p.paciente_id === pacienteId);

  return (
    <div className="space-y-4 border-b border-border/60 px-5 py-5">
      <div className="flex items-center gap-2">
        <UserRound size={16} strokeWidth={1.75} className="shrink-0 text-tertiary" />
        <span className="text-[15px] font-semibold text-foreground">
          {pacientes.length > 1 ? `Pacientes (${pacientes.length})` : "Paciente"}
        </span>
      </div>

      {pacientes.length === 0 ? (
        <div className="space-y-3 rounded-xl border border-dashed border-border bg-surface-sunken/60 p-4 text-center">
          <p className="text-[13px] text-muted-foreground">Nenhum paciente vinculado</p>
          <Button size="sm" variant="outline" className="h-10 w-full gap-1.5 rounded-xl text-[13px] font-medium" onClick={() => abrirFormulario(null)}>
            <UserPlus size={15} strokeWidth={1.75} /> Vincular Paciente
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {pacientes.map((p) => {
            const lista = pagamentosDe(p.id);
            const somaP = lista.reduce((s, x) => s + Number(x.valor), 0);
            return (
              <div key={p.id} className="space-y-3 rounded-xl border border-border/60 bg-card p-3.5 shadow-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground [overflow-wrap:anywhere]">{p.nome}</p>
                    <p className="mt-0.5 text-xs tabular-nums text-tertiary [overflow-wrap:anywhere]">
                      {[p.telefone, p.cidade].filter(Boolean).join(" · ") || "Sem contato"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="whitespace-nowrap text-sm font-bold tabular-nums text-primary">{brl(somaP)}</span>
                    <button
                      onClick={() => desvincular(p)}
                      className="-mr-1 grid h-7 w-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive-soft hover:text-destructive"
                      title="Remover vínculo"
                    >
                      <X size={15} strokeWidth={1.75} />
                    </button>
                  </div>
                </div>

                {lista.length > 0 && (
                  <ul className="space-y-1.5">
                    {lista.map((pg) => (
                      <li key={pg.id} className="flex items-start justify-between gap-2 rounded-lg bg-surface-sunken px-2.5 py-2 text-xs">
                        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-muted-foreground">
                          <Wallet size={14} strokeWidth={1.75} className="shrink-0 text-tertiary" />
                          <span className="font-medium tabular-nums text-foreground">{dataBR(pg.data_pagamento)}</span>
                          <span className="min-w-0 [overflow-wrap:anywhere]">
                            {nomeClinica(pg.clinica_id)}{pg.especialidade ? ` · ${pg.especialidade}` : ""}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          <span className="whitespace-nowrap font-semibold tabular-nums text-foreground">{brl(Number(pg.valor))}</span>
                          <button
                            type="button"
                            onClick={() => abrirEdicao(pg)}
                            className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-card hover:text-primary"
                            aria-label="Editar pagamento"
                          >
                            <Pencil size={13} strokeWidth={1.75} />
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 w-full gap-1.5 rounded-xl text-[13px] font-medium"
                  onClick={() => abrirFormulario(p)}
                >
                  <Plus size={15} strokeWidth={1.75} /> Lançar pagamento
                </Button>
              </div>
            );
          })}

          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl bg-primary-soft-2 px-4 py-3.5">
            <span className="text-[13px] font-medium text-muted-foreground">Total desta conversa</span>
            <span className="text-2xl font-bold leading-tight tracking-tight tabular-nums text-primary">{brl(total)}</span>
          </div>

          {/* Mesma ideia do crc: familiar que usa o mesmo telefone. */}
          <Button
            size="sm"
            variant="ghost"
            className="h-auto min-h-9 w-full gap-1.5 whitespace-normal rounded-xl py-2 text-[13px] font-medium text-muted-foreground hover:bg-surface-sunken hover:text-foreground"
            onClick={() => abrirFormulario(null)}
          >
            <UserPlus size={15} strokeWidth={1.75} /> Vincular outra pessoa deste contato
          </Button>
        </div>
      )}

      <Dialog open={formAberto} onOpenChange={(o) => { setFormAberto(o); if (!o) setEditando(null); }}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold tracking-tight">{editando ? "Editar pagamento" : alvoPagamento ? "Lançar pagamento" : "Vincular Paciente"}</DialogTitle>
            <DialogDescription>
              {alvoPagamento
                ? alvoPagamento.nome
                : "Preencha os dados do paciente e do pagamento. O que o lead já sabe vem preenchido."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Buscar alguém já cadastrado — só faz sentido antes de haver vínculo */}
            {!alvoPagamento && !editando && (
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-muted-foreground">Já cadastrou este paciente antes?</Label>
                <div className="flex gap-2">
                  <Input
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder="Buscar por nome ou telefone…"
                    className="h-10 rounded-xl"
                    onKeyDown={(e) => { if (e.key === "Enter") void buscar(); }}
                  />
                  <Button size="sm" variant="outline" className="h-10 w-10 shrink-0 rounded-xl p-0" onClick={buscar} disabled={buscando}>
                    {buscando ? <Loader2 size={16} strokeWidth={1.75} className="animate-spin" /> : <Search size={16} strokeWidth={1.75} />}
                  </Button>
                </div>
                {resultados.length > 0 && (
                  <div className="max-h-32 space-y-1 overflow-y-auto rounded-xl border border-border/60 p-1">
                    {resultados.map((p) => {
                      const ocupado = !!p.lead_id && p.lead_id !== lead.id;
                      return (
                        <button
                          key={p.id}
                          onClick={() => !ocupado && vincularExistente(p.id)}
                          disabled={ocupado || salvando}
                          className="w-full rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <span className="font-medium text-foreground">{p.nome}</span>
                          <span className="ml-2 tabular-nums text-muted-foreground">{p.telefone}</span>
                          {ocupado && <span className="ml-2 text-xs font-medium text-primary">(já vinculado)</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {!alvoPagamento && !editando && (
              <div className="space-y-3 border-t border-border/60 pt-4">
                <Label className="text-sm font-semibold text-foreground">Dados do paciente</Label>
                <div className="space-y-1.5">
                  <Label htmlFor="nome" className="text-[13px] font-medium text-muted-foreground">Nome</Label>
                  <Input className="h-10 rounded-xl" id="nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="tel" className="text-[13px] font-medium text-muted-foreground">Telefone</Label>
                    <Input className="h-10 rounded-xl" id="tel" value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[13px] font-medium text-muted-foreground">Cidade</Label>
                    <Select value={form.cidade} onValueChange={(v) => setForm({ ...form, cidade: v })}>
                      <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SEM_CIDADE}>Sem localização</SelectItem>
                        {cidades.map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-3 border-t border-border/60 pt-4">
              <Label className="text-sm font-semibold text-foreground">
                Pagamento {!alvoPagamento && <span className="font-normal text-muted-foreground">(opcional agora)</span>}
              </Label>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="valor" className="text-[13px] font-medium text-muted-foreground">Valor</Label>
                  <Input
                    id="valor"
                    className="h-10 rounded-xl tabular-nums"
                    inputMode="numeric"
                    placeholder="0,00"
                    value={form.valor}
                    onChange={(e) => setForm({ ...form, valor: mascaraMoeda(e.target.value) })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="data" className="text-[13px] font-medium text-muted-foreground">Data do pagamento</Label>
                  <Input
                    id="data"
                    className="h-10 rounded-xl"
                    type="date"
                    value={form.data_pagamento}
                    onChange={(e) => setForm({ ...form, data_pagamento: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[13px] font-medium text-muted-foreground">Clínica</Label>
                <Select value={form.clinica_id} onValueChange={(v) => setForm({ ...form, clinica_id: v })}>
                  <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="Selecione a clínica" /></SelectTrigger>
                  <SelectContent>
                    {clinicas.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.nome}{c.cidade ? ` — ${c.cidade}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[13px] font-medium text-muted-foreground">Tipo</Label>
                  <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v })}>
                    <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="primeiro">Primeiro pagamento</SelectItem>
                      <SelectItem value="recorrente">Recorrente</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px] font-medium text-muted-foreground">Especialidade</Label>
                  <Select value={form.especialidade} onValueChange={(v) => setForm({ ...form, especialidade: v })}>
                    <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {especialidades.map((e) => (<SelectItem key={e} value={e}>{e}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[13px] font-medium text-muted-foreground">Forma de pagamento</Label>
                <Select
                  value={form.forma_pagamento}
                  onValueChange={(v) => setForm({ ...form, forma_pagamento: v })}
                >
                  <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {FORMAS.map((f) => (<SelectItem key={f} value={f}>{f}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-10 rounded-xl px-4" onClick={() => setFormAberto(false)}>Cancelar</Button>
            <Button className="h-10 gap-1.5 rounded-xl px-5" onClick={editando ? salvarEdicao : salvar} disabled={salvando}>
              {salvando ? <Loader2 size={15} strokeWidth={1.75} className="animate-spin" /> : <UserPlus size={15} strokeWidth={1.75} />}
              {editando ? "Salvar" : alvoPagamento ? "Lançar" : "Vincular"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
