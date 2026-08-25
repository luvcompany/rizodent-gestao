import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Plus, Search, UserPlus, Wallet, X } from "lucide-react";
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
 * Painel de paciente do closer, dentro da conversa — mesmo lugar e mesmo papel
 * do LeadBudgetPanel do crc, porém sobre closer_pacientes/closer_pagamentos.
 * O painel do crc lê `pacientes`/`pagamentos`, que são bloqueadas para o closer
 * por policy: era por isso que o botão "Vincular Paciente" não funcionava.
 *
 * Aqui o vínculo é manual e parte do lead: busca entre os pacientes que ele já
 * cadastrou ou cria um novo, com nome e telefone já preenchidos a partir do lead.
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
  clinica_id: string | null;
};

type Clinica = { id: string; nome: string; cidade: string | null };

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

/** Tira o 55 do começo para exibir/preencher como a pessoa digitaria. */
const semDDI = (tel: string | null) => {
  const d = (tel || "").replace(/\D/g, "");
  return d.startsWith("55") ? d.slice(2) : d;
};

export default function CloserLeadPacientePanel({ lead }: { lead: LeadMin }) {
  const [paciente, setPaciente] = useState<Paciente | null>(null);
  const [pagamentos, setPagamentos] = useState<Pagamento[]>([]);
  const [clinicas, setClinicas] = useState<Clinica[]>([]);
  const [carregando, setCarregando] = useState(true);

  const [vincularAberto, setVincularAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [resultados, setResultados] = useState<Paciente[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [novoTelefone, setNovoTelefone] = useState("");
  const [novaCidade, setNovaCidade] = useState("");
  const [salvando, setSalvando] = useState(false);

  const [pagamentoAberto, setPagamentoAberto] = useState(false);
  const [formPag, setFormPag] = useState({
    valor: "",
    clinica_id: "",
    forma_pagamento: "",
    especialidade: "",
    data_pagamento: hojeBahia(),
  });

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
        .select("id, valor, data_pagamento, forma_pagamento, especialidade, clinica_id")
        .eq("paciente_id", pac.id)
        .order("data_pagamento", { ascending: false });
      setPagamentos((pgs as Pagamento[]) || []);
    } else {
      setPagamentos([]);
    }
    setCarregando(false);
  }, [lead.id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any).rpc("closer_clinicas_do_tenant");
      setClinicas((data as Clinica[]) || []);
    })();
  }, []);

  const total = useMemo(
    () => pagamentos.reduce((s, p) => s + Number(p.valor), 0),
    [pagamentos],
  );

  const nomeClinica = useCallback(
    (id: string | null) => (id ? clinicas.find((c) => c.id === id)?.nome ?? "—" : "—"),
    [clinicas],
  );

  const abrirVinculo = () => {
    setBusca(semDDI(lead.phone) || lead.name || "");
    setResultados([]);
    setNovoNome(lead.name || "");
    setNovoTelefone(semDDI(lead.phone));
    setNovaCidade(lead.cidade || "");
    setVincularAberto(true);
  };

  const buscar = async () => {
    const termo = busca.trim();
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

  /** Liga um paciente já cadastrado a este lead. */
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
    setVincularAberto(false);
    void carregar();
  };

  const criarEVincular = async () => {
    const nome = (novoNome || lead.name || "").trim();
    if (!nome) {
      toast.error("Informe o nome do paciente");
      return;
    }
    setSalvando(true);
    const { error } = await (supabase as any).from("closer_pacientes").insert({
      lead_id: lead.id,
      nome,
      telefone: novoTelefone.trim() || null,
      cidade: novaCidade.trim() || null,
    });
    setSalvando(false);
    if (error) {
      toast.error(
        error.code === "23505"
          ? "Esta conversa já tem um paciente vinculado."
          : `Não foi possível vincular: ${error.message}`,
      );
      return;
    }
    toast.success("Paciente vinculado");
    setVincularAberto(false);
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

  const lancarPagamento = async () => {
    if (!paciente) return;
    const valor = Number(String(formPag.valor).replace(/\./g, "").replace(",", "."));
    if (!valor || valor <= 0) {
      toast.error("Informe um valor válido");
      return;
    }
    setSalvando(true);
    const { error } = await (supabase as any).from("closer_pagamentos").insert({
      paciente_id: paciente.id,
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
    setPagamentoAberto(false);
    setFormPag({ valor: "", clinica_id: "", forma_pagamento: "", especialidade: "", data_pagamento: hojeBahia() });
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
          <Button size="sm" variant="outline" className="w-full" onClick={abrirVinculo}>
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
                    <span className="truncate">{nomeClinica(p.clinica_id)}</span>
                  </span>
                  <span className="font-medium tabular-nums text-foreground">{brl(Number(p.valor))}</span>
                </li>
              ))}
            </ul>
          )}

          <Button size="sm" variant="outline" className="w-full" onClick={() => setPagamentoAberto(true)}>
            <Plus size={14} className="mr-1" /> Lançar pagamento
          </Button>
        </div>
      )}

      {/* Vincular: buscar existente ou criar a partir do lead */}
      <Dialog open={vincularAberto} onOpenChange={setVincularAberto}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Vincular Paciente</DialogTitle>
            <DialogDescription>
              Busque um paciente que você já cadastrou, ou crie um novo a partir desta conversa.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por nome ou telefone…"
                onKeyDown={(e) => { if (e.key === "Enter") void buscar(); }}
              />
              <Button size="sm" onClick={buscar} disabled={buscando}>
                {buscando ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              </Button>
            </div>

            {resultados.length > 0 && (
              <div className="max-h-48 space-y-1 overflow-y-auto">
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

            {resultados.length === 0 && busca && !buscando && (
              <p className="text-center text-sm text-muted-foreground">Nenhum paciente encontrado.</p>
            )}

            <div className="space-y-2 border-t border-border pt-3">
              <Label className="text-xs font-medium">Ou criar a partir desta conversa</Label>
              <Input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="Nome" />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={novoTelefone}
                  onChange={(e) => setNovoTelefone(e.target.value)}
                  placeholder="Telefone"
                />
                <Input
                  value={novaCidade}
                  onChange={(e) => setNovaCidade(e.target.value)}
                  placeholder="Cidade"
                />
              </div>
              <p className="text-[11px] italic text-muted-foreground">
                Nome, telefone e cidade vieram do lead — ajuste se precisar.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setVincularAberto(false)}>Cancelar</Button>
            <Button onClick={criarEVincular} disabled={salvando}>
              {salvando ? <Loader2 size={14} className="mr-1 animate-spin" /> : <UserPlus size={14} className="mr-1" />}
              Criar e Vincular
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lançar pagamento */}
      <Dialog open={pagamentoAberto} onOpenChange={setPagamentoAberto}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Lançar pagamento</DialogTitle>
            <DialogDescription>{paciente?.nome}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="v">Valor</Label>
                <Input
                  id="v"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={formPag.valor}
                  onChange={(e) => setFormPag({ ...formPag, valor: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="d">Data do pagamento</Label>
                <Input
                  id="d"
                  type="date"
                  value={formPag.data_pagamento}
                  onChange={(e) => setFormPag({ ...formPag, data_pagamento: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Clínica</Label>
              <Select value={formPag.clinica_id} onValueChange={(v) => setFormPag({ ...formPag, clinica_id: v })}>
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
                <Label htmlFor="f">Forma de pagamento</Label>
                <Input
                  id="f"
                  placeholder="Pix, cartão…"
                  value={formPag.forma_pagamento}
                  onChange={(e) => setFormPag({ ...formPag, forma_pagamento: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="e">Especialidade</Label>
                <Input
                  id="e"
                  placeholder="Implante, orto…"
                  value={formPag.especialidade}
                  onChange={(e) => setFormPag({ ...formPag, especialidade: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPagamentoAberto(false)}>Cancelar</Button>
            <Button onClick={lancarPagamento} disabled={salvando}>
              {salvando && <Loader2 size={14} className="mr-1 animate-spin" />} Lançar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
