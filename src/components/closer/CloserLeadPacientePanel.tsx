import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Plus, Search, UserPlus, Wallet, X } from "lucide-react";
import { centavosParaValor, mascaraMoeda } from "@/lib/moeda";
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

const hojeBahia = () => {
  const bahia = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Bahia" }));
  return bahia.toISOString().slice(0, 10);
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
  const [paciente, setPaciente] = useState<Paciente | null>(null);
  const [pagamentos, setPagamentos] = useState<Pagamento[]>([]);
  const [clinicas, setClinicas] = useState<Clinica[]>([]);
  const [especialidades, setEspecialidades] = useState<string[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  const [formAberto, setFormAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [resultados, setResultados] = useState<Paciente[]>([]);
  const [buscando, setBuscando] = useState(false);

  /** Um formulário só: dados do paciente + do primeiro pagamento. */
  const vazio = useMemo(
    () => ({
      nome: "",
      telefone: "",
      cidade: SEM_CIDADE,
      clinica_id: "",
      valor: "",
      data_pagamento: hojeBahia(),
      tipo: "primeiro",
      especialidade: "",
      forma_pagamento: "",
    }),
    [],
  );
  const [form, setForm] = useState(vazio);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data: pac } = await (supabase as any)
      .from("closer_pacientes")
      .select("id, nome, telefone, cidade, lead_id")
      .eq("lead_id", lead.id)
      .maybeSingle();

    setPaciente((pac as Paciente) || null);

    if (pac?.id) {
      const { data: pgs } = await (supabase as any)
        .from("closer_pagamentos")
        .select("id, valor, data_pagamento, forma_pagamento, especialidade, tipo, clinica_id")
        .eq("paciente_id", pac.id)
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

  /** Abre já preenchido com o que o lead sabe — inclusive a cidade. */
  const abrirFormulario = (paraPagamento = false) => {
    if (paraPagamento && paciente) {
      setForm({
        ...vazio,
        nome: paciente.nome,
        telefone: paciente.telefone || "",
        cidade: paciente.cidade || SEM_CIDADE,
        // Repete a clínica do último lançamento: normalmente é a mesma.
        clinica_id: pagamentos[0]?.clinica_id || "",
        tipo: pagamentos.length > 0 ? "recorrente" : "primeiro",
      });
    } else {
      setForm({
        ...vazio,
        nome: lead.name || "",
        telefone: semDDI(lead.phone),
        cidade: lead.cidade || SEM_CIDADE,
      });
      setBusca(semDDI(lead.phone) || lead.name || "");
      setResultados([]);
    }
    setFormAberto(true);
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
    const { error } = await (supabase as any)
      .from("closer_pacientes")
      .update({ lead_id: lead.id, updated_at: new Date().toISOString() })
      .eq("id", id);
    setSalvando(false);
    if (error) {
      toast.error(
        error.code === "23505"
          ? "Este paciente já está vinculado a outra conversa."
          : `Não foi possível vincular: ${error.message}`,
      );
      return;
    }
    toast.success("Paciente vinculado");
    setFormAberto(false);
    void carregar();
  };

  /** Salva paciente e pagamento numa tacada — o valor é opcional. */
  const salvar = async () => {
    const nome = form.nome.trim() || lead.name?.trim() || "";
    if (!nome) {
      toast.error("Informe o nome do paciente");
      return;
    }
    const valor = centavosParaValor(form.valor);
    if (form.valor.trim() && valor <= 0) {
      toast.error("Informe um valor válido");
      return;
    }
    if (valor > 0 && !form.clinica_id) {
      toast.error("Escolha a clínica do pagamento");
      return;
    }

    setSalvando(true);
    let pacienteId = paciente?.id ?? null;

    if (!pacienteId) {
      const { data, error } = await (supabase as any)
        .from("closer_pacientes")
        .insert({
          lead_id: lead.id,
          nome,
          telefone: form.telefone.trim() || null,
          cidade: form.cidade === SEM_CIDADE ? null : form.cidade,
        })
        .select("id")
        .single();
      if (error) {
        setSalvando(false);
        toast.error(
          error.code === "23505"
            ? "Esta conversa já tem um paciente vinculado."
            : `Não foi possível vincular: ${error.message}`,
        );
        return;
      }
      pacienteId = data.id as string;
    }

    if (valor > 0 && pacienteId) {
      const { error } = await (supabase as any).from("closer_pagamentos").insert({
        paciente_id: pacienteId,
        valor,
        clinica_id: form.clinica_id || null,
        forma_pagamento: form.forma_pagamento || null,
        especialidade: form.especialidade || null,
        tipo: form.tipo || null,
        data_pagamento: form.data_pagamento,
      });
      if (error) {
        setSalvando(false);
        toast.error(`Paciente vinculado, mas o pagamento falhou: ${error.message}`);
        setFormAberto(false);
        void carregar();
        return;
      }
    }

    setSalvando(false);
    toast.success(valor > 0 ? "Paciente vinculado e pagamento lançado" : "Paciente vinculado");
    setFormAberto(false);
    setForm(vazio);
    void carregar();
  };

  const desvincular = async () => {
    if (!paciente) return;
    const { error } = await (supabase as any)
      .from("closer_pacientes")
      .update({ lead_id: null })
      .eq("id", paciente.id);
    if (error) {
      toast.error(`Não foi possível desvincular: ${error.message}`);
      return;
    }
    toast.success("Vínculo removido — o paciente continua na sua aba Pacientes");
    void carregar();
  };

  if (carregando) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">
        <Loader2 size={14} className="animate-spin" /> Carregando paciente…
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Paciente</span>
        {paciente && (
          <button
            onClick={desvincular}
            className="text-muted-foreground transition-colors hover:text-destructive"
            title="Remover vínculo"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {!paciente ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Nenhum paciente vinculado</p>
          <Button size="sm" variant="outline" className="w-full" onClick={() => abrirFormulario(false)}>
            <UserPlus size={14} className="mr-1" /> Vincular Paciente
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <p className="truncate font-medium text-foreground">{paciente.nome}</p>
            <p className="truncate text-xs text-muted-foreground">
              {[paciente.telefone, paciente.cidade].filter(Boolean).join(" · ") || "Sem contato"}
            </p>
          </div>

          <div className="border-t border-border pt-2">
            <span className="text-xs text-muted-foreground">Valor contratado (pago)</span>
            <p className="text-lg font-bold text-primary">{brl(total)}</p>
          </div>

          {pagamentos.length > 0 && (
            <ul className="space-y-1 border-t border-border pt-2">
              {pagamentos.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                    <Wallet size={12} className="shrink-0" />
                    <span className="tabular-nums">{dataBR(p.data_pagamento)}</span>
                    <span className="truncate">
                      {nomeClinica(p.clinica_id)}{p.especialidade ? ` · ${p.especialidade}` : ""}
                    </span>
                  </span>
                  <span className="font-medium tabular-nums text-foreground">{brl(Number(p.valor))}</span>
                </li>
              ))}
            </ul>
          )}

          <Button size="sm" variant="outline" className="w-full" onClick={() => abrirFormulario(true)}>
            <Plus size={14} className="mr-1" /> Lançar pagamento
          </Button>
        </div>
      )}

      <Dialog open={formAberto} onOpenChange={setFormAberto}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{paciente ? "Lançar pagamento" : "Vincular Paciente"}</DialogTitle>
            <DialogDescription>
              {paciente
                ? paciente.nome
                : "Preencha os dados do paciente e do pagamento. O que o lead já sabe vem preenchido."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Buscar alguém já cadastrado — só faz sentido antes de haver vínculo */}
            {!paciente && (
              <div className="space-y-2">
                <Label className="text-xs">Já cadastrou este paciente antes?</Label>
                <div className="flex gap-2">
                  <Input
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder="Buscar por nome ou telefone…"
                    onKeyDown={(e) => { if (e.key === "Enter") void buscar(); }}
                  />
                  <Button size="sm" variant="outline" onClick={buscar} disabled={buscando}>
                    {buscando ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                  </Button>
                </div>
                {resultados.length > 0 && (
                  <div className="max-h-32 space-y-1 overflow-y-auto rounded border border-border p-1">
                    {resultados.map((p) => {
                      const ocupado = !!p.lead_id && p.lead_id !== lead.id;
                      return (
                        <button
                          key={p.id}
                          onClick={() => !ocupado && vincularExistente(p.id)}
                          disabled={ocupado || salvando}
                          className="w-full rounded p-2 text-left text-sm transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <span className="font-medium text-foreground">{p.nome}</span>
                          <span className="ml-2 text-muted-foreground">{p.telefone}</span>
                          {ocupado && <span className="ml-2 text-xs text-primary">(já vinculado)</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {!paciente && (
              <div className="space-y-3 border-t border-border pt-3">
                <Label className="text-xs font-semibold">Dados do paciente</Label>
                <div className="space-y-1.5">
                  <Label htmlFor="nome" className="text-xs">Nome</Label>
                  <Input id="nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="tel" className="text-xs">Telefone</Label>
                    <Input id="tel" value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Cidade</Label>
                    <Select value={form.cidade} onValueChange={(v) => setForm({ ...form, cidade: v })}>
                      <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SEM_CIDADE}>Sem localização</SelectItem>
                        {cidades.map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-3 border-t border-border pt-3">
              <Label className="text-xs font-semibold">
                Pagamento {!paciente && <span className="font-normal text-muted-foreground">(opcional agora)</span>}
              </Label>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="valor" className="text-xs">Valor</Label>
                  <Input
                    id="valor"
                    inputMode="numeric"
                    placeholder="0,00"
                    value={form.valor}
                    onChange={(e) => setForm({ ...form, valor: mascaraMoeda(e.target.value) })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="data" className="text-xs">Data do pagamento</Label>
                  <Input
                    id="data"
                    type="date"
                    value={form.data_pagamento}
                    onChange={(e) => setForm({ ...form, data_pagamento: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Clínica</Label>
                <Select value={form.clinica_id} onValueChange={(v) => setForm({ ...form, clinica_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecione a clínica" /></SelectTrigger>
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
                  <Label className="text-xs">Tipo</Label>
                  <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="primeiro">Primeiro pagamento</SelectItem>
                      <SelectItem value="recorrente">Recorrente</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Especialidade</Label>
                  <Select value={form.especialidade} onValueChange={(v) => setForm({ ...form, especialidade: v })}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {especialidades.map((e) => (<SelectItem key={e} value={e}>{e}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Forma de pagamento</Label>
                <Select
                  value={form.forma_pagamento}
                  onValueChange={(v) => setForm({ ...form, forma_pagamento: v })}
                >
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {FORMAS.map((f) => (<SelectItem key={f} value={f}>{f}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFormAberto(false)}>Cancelar</Button>
            <Button onClick={salvar} disabled={salvando}>
              {salvando ? <Loader2 size={14} className="mr-1 animate-spin" /> : <UserPlus size={14} className="mr-1" />}
              {paciente ? "Lançar" : "Vincular"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
