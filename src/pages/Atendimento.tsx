import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, Search, UserCheck, CalendarIcon, FileText, Plus, CreditCard, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Tables } from "@/integrations/supabase/types";

const formasPagamento = ["Dinheiro", "Pix", "Cartão de Crédito", "Cartão de Débito", "Boleto", "Financiamento"];
const origens = ["Instagram", "Google Ads", "Facebook", "Indicação", "Site", "Outros"];

const formatCurrencyInput = (value: string): string => {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  const num = parseInt(digits, 10) / 100;
  return num.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};

const parseCurrency = (value: string): number => {
  if (!value) return 0;
  const digits = value.replace(/\D/g, "");
  return parseInt(digits || "0", 10) / 100;
};

const formatCurrencyDisplay = (value: number): string => {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};

type ModoAtendimento = "selecionar" | "novo_tratamento" | "novo_pagamento";

interface TipoProcedimento {
  id: string;
  nome: string;
  valor_referencia: number | null;
  especialidade: string | null;
  especialidade_secundaria: string | null;
}

interface ProcedimentoEntry {
  id: string;
  procedimento: string;
  especialidade: string;
}

const createEmptyProcedimento = (): ProcedimentoEntry => ({
  id: crypto.randomUUID(),
  procedimento: "",
  especialidade: "",
});

const Atendimento = () => {
  const { user } = useAuth();
  const [clinicas, setClinicas] = useState<Tables<"clinicas">[]>([]);
  const [tiposProcedimento, setTiposProcedimento] = useState<TipoProcedimento[]>([]);
  const [telefone, setTelefone] = useState("");
  const [nome, setNome] = useState("");
  const [clinicaId, setClinicaId] = useState("");
  const [cidade, setCidade] = useState("");
  const [procedimentos, setProcedimentos] = useState<ProcedimentoEntry[]>([createEmptyProcedimento()]);
  const [valorOrcadoGeral, setValorOrcadoGeral] = useState("");
  const [valorContratadoGeral, setValorContratadoGeral] = useState("");
  const [formaPagamento, setFormaPagamento] = useState("");
  const [tipoPagamento, setTipoPagamento] = useState("");
  const [origem, setOrigem] = useState("");
  const [valorPago, setValorPago] = useState("");
  const [nomeAnuncio, setNomeAnuncio] = useState("");
  const [dataPagamento, setDataPagamento] = useState(() => new Date().toISOString().split("T")[0]);
  const [sugestoes, setSugestoes] = useState<Tables<"pacientes">[]>([]);
  const [pacienteSelecionadoId, setPacienteSelecionadoId] = useState<string | null>(null);
  const [tratamentosExistentes, setTratamentosExistentes] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [modo, setModo] = useState<ModoAtendimento>("selecionar");
  const [tratamentoSelecionadoId, setTratamentoSelecionadoId] = useState<string | null>(null);

  // Legacy single-procedure state for payment mode
  const [procedimentoPayment, setProcedimentoPayment] = useState("");

  useEffect(() => {
    supabase.from("clinicas").select("*").eq("ativa", true).then(({ data }) => {
      if (data) setClinicas(data);
    });
    supabase.from("tipos_procedimento").select("id, nome, valor_referencia, especialidade, especialidade_secundaria").eq("ativo", true).order("nome").then(({ data }) => {
      if (data) setTiposProcedimento(data as TipoProcedimento[]);
    });
  }, []);

  const getEspecialidadesDisponiveis = (procNome: string) => {
    if (!procNome) return [];
    const tp = tiposProcedimento.find(t => t.nome === procNome);
    if (!tp) return [];
    const list: string[] = [];
    if (tp.especialidade) list.push(tp.especialidade);
    if (tp.especialidade_secundaria) list.push(tp.especialidade_secundaria);
    return list;
  };

  const formatPhone = (value: string) => {
    const digits = value.replace(/\D/g, "");
    if (digits.length <= 2) return `(${digits}`;
    if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
  };

  const handlePhoneChange = async (value: string) => {
    const formatted = formatPhone(value);
    setTelefone(formatted);
    setPacienteSelecionadoId(null);
    setTratamentosExistentes([]);
    setModo("selecionar");
    setTratamentoSelecionadoId(null);

    const digits = value.replace(/\D/g, "");
    if (digits.length >= 4) {
      const { data } = await supabase
        .from("pacientes")
        .select("*")
        .ilike("telefone", `%${formatted}%`)
        .limit(5);
      setSugestoes(data || []);
    } else {
      setSugestoes([]);
    }
  };

  const carregarTratamentos = async (pacienteId: string) => {
    const { data } = await supabase
      .from("tratamentos")
      .select("*, clinicas(nome)")
      .eq("paciente_id", pacienteId)
      .order("created_at", { ascending: false });

    if (data) {
      const enriched = await Promise.all(data.map(async (t) => {
        const { data: pags } = await supabase
          .from("pagamentos")
          .select("valor")
          .eq("tratamento_id", t.id);
        const totalPago = pags?.reduce((s, p) => s + Number(p.valor), 0) || 0;
        return { ...t, totalPago };
      }));
      setTratamentosExistentes(enriched);
    }
  };

  const selecionarPaciente = async (pac: Tables<"pacientes">) => {
    setTelefone(pac.telefone);
    setNome(pac.nome);
    setCidade(pac.cidade || "");
    setOrigem(pac.origem || "");
    setNomeAnuncio(pac.nome_anuncio || "");
    setPacienteSelecionadoId(pac.id);
    setSugestoes([]);
    setModo("selecionar");
    setTratamentoSelecionadoId(null);
    await carregarTratamentos(pac.id);
    toast.success(`Paciente ${pac.nome} selecionado!`);
  };

  const selecionarTratamento = (tratamento: any) => {
    setTratamentoSelecionadoId(tratamento.id);
    setModo("novo_pagamento");
    setClinicaId(tratamento.clinica_id);
    setProcedimentoPayment(tratamento.procedimento);
    const cl = clinicas.find(c => c.id === tratamento.clinica_id);
    if (cl) setCidade(cl.cidade);
    toast.info(`Registrar pagamento para: ${tratamento.procedimento}`);
  };

  const iniciarNovoTratamento = () => {
    setModo("novo_tratamento");
    setTratamentoSelecionadoId(null);
    setClinicaId("");
    setProcedimentos([createEmptyProcedimento()]);
    setCidade("");
  };

  const resetForm = () => {
    setTelefone(""); setNome(""); setClinicaId(""); setCidade("");
    setProcedimentos([createEmptyProcedimento()]);
    setValorPago(""); setFormaPagamento(""); setTipoPagamento("");
    setOrigem(""); setNomeAnuncio(""); setPacienteSelecionadoId(null);
    setDataPagamento(new Date().toISOString().split("T")[0]);
    setValorOrcadoGeral(""); setValorContratadoGeral("");
    setModo("selecionar");
    setTratamentoSelecionadoId(null);
    setProcedimentoPayment("");
  };

  const updateProcedimento = (index: number, field: keyof ProcedimentoEntry, value: string) => {
    setProcedimentos(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };

      // Auto-select single specialty when changing procedimento
      if (field === "procedimento") {
        const tp = tiposProcedimento.find(t => t.nome === value);
        if (tp && tp.especialidade && !tp.especialidade_secundaria) {
          updated[index].especialidade = tp.especialidade;
        } else {
          updated[index].especialidade = "";
        }
      }

      return updated;
    });
  };

  const addProcedimento = () => {
    setProcedimentos(prev => [...prev, createEmptyProcedimento()]);
  };

  const removeProcedimento = (index: number) => {
    if (procedimentos.length <= 1) return;
    setProcedimentos(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (modo === "novo_pagamento") {
      if (!tratamentoSelecionadoId || !valorPago || parseCurrency(valorPago) <= 0) {
        toast.error("Preencha o valor do pagamento.");
        return;
      }
      if (!formaPagamento) {
        toast.error("Selecione a forma de pagamento.");
        return;
      }
      setSaving(true);
      try {
        const { error: pagError } = await supabase
          .from("pagamentos")
          .insert({
            tratamento_id: tratamentoSelecionadoId,
            paciente_id: pacienteSelecionadoId!,
            clinica_id: clinicaId,
            valor: parseCurrency(valorPago),
            forma_pagamento: formaPagamento,
            tipo: tipoPagamento || "recorrente",
            data_pagamento: dataPagamento,
            created_by: user?.id,
          });
        if (pagError) throw pagError;
        toast.success("Pagamento registrado com sucesso!");
        resetForm();
      } catch (err: any) {
        toast.error("Erro ao salvar: " + err.message);
      } finally {
        setSaving(false);
      }
      return;
    }

    // New treatment flow
    if (!clinicaId) {
      toast.error("Selecione a clínica.");
      return;
    }

    // Validate all procedures
    for (let i = 0; i < procedimentos.length; i++) {
      const p = procedimentos[i];
      if (!p.procedimento) {
        toast.error(`Selecione o procedimento ${i + 1}.`);
        return;
      }
      const espDisp = getEspecialidadesDisponiveis(p.procedimento);
      if (espDisp.length > 0 && !p.especialidade) {
        toast.error(`Selecione a especialidade do procedimento "${p.procedimento}".`);
        return;
      }
    }

    setSaving(true);

    try {
      let pacienteId = pacienteSelecionadoId;

      if (!pacienteId) {
        const { data: newPac, error } = await supabase
          .from("pacientes")
          .insert({ nome, telefone, cidade: cidade || null, origem: origem || null, nome_anuncio: nomeAnuncio || null })
          .select("id")
          .single();
        if (error) throw error;
        pacienteId = newPac.id;
      }

      const totalOrcado = parseCurrency(valorOrcadoGeral);
      const totalContratado = parseCurrency(valorContratadoGeral);
      const valorPorProc = procedimentos.length > 0 ? totalOrcado / procedimentos.length : totalOrcado;
      const contratadoPorProc = procedimentos.length > 0 ? totalContratado / procedimentos.length : totalContratado;

      // Create all treatments
      for (const proc of procedimentos) {
        const { data: trat, error: tratError } = await supabase
          .from("tratamentos")
          .insert({
            paciente_id: pacienteId,
            clinica_id: clinicaId,
            procedimento: proc.procedimento,
            especialidade: proc.especialidade || null,
            valor_orcado: valorPorProc,
            valor_contratado: contratadoPorProc,
            created_by: user?.id,
          })
          .select("id")
          .single();
        if (tratError) throw tratError;

        // Add first payment using valor_contratado
        if (proc === procedimentos[0] && contratadoPorProc > 0) {
          const { error: pagError } = await supabase
            .from("pagamentos")
            .insert({
              tratamento_id: trat.id,
              paciente_id: pacienteId,
              clinica_id: clinicaId,
              valor: contratadoPorProc,
              forma_pagamento: formaPagamento || "Pix",
              tipo: tipoPagamento || "primeiro",
              data_pagamento: dataPagamento,
              created_by: user?.id,
            });
          if (pagError) throw pagError;
        }
      }

      toast.success(`${procedimentos.length > 1 ? `${procedimentos.length} procedimentos registrados` : "Atendimento registrado"} com sucesso!`);
      resetForm();
    } catch (err: any) {
      toast.error("Erro ao salvar: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const tratamentoSelecionado = tratamentosExistentes.find(t => t.id === tratamentoSelecionadoId);
  const showTratamentoSelector = pacienteSelecionadoId && tratamentosExistentes.length > 0 && modo === "selecionar";
  const showNovoTratamentoFields = !pacienteSelecionadoId || modo === "novo_tratamento";
  const showPagamentoFields = modo === "novo_pagamento";

  return (
    <div className="mx-auto max-w-3xl animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Novo Atendimento</h1>
        <p className="text-sm text-muted-foreground">Cadastro único de atendimento</p>
      </div>

      <Card className="gradient-card border-border shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserCheck size={18} className="text-primary" />
            Dados do Atendimento
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Phone with smart search */}
            <div className="relative space-y-2">
              <Label>Telefone do Paciente</Label>
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="(00) 00000-0000"
                  value={telefone}
                  onChange={(e) => handlePhoneChange(e.target.value)}
                  className="bg-secondary border-border pl-10"
                  maxLength={15}
                  required
                />
              </div>
              {sugestoes.length > 0 && !pacienteSelecionadoId && (
                <div className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-popover p-1 shadow-card">
                  {sugestoes.map((pac) => (
                    <button
                      key={pac.id}
                      type="button"
                      onClick={() => selecionarPaciente(pac)}
                      className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors"
                    >
                      <UserCheck size={14} className="text-primary" />
                      <span className="font-medium">{pac.nome}</span>
                      <span className="text-muted-foreground">{pac.telefone}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Treatment selector */}
            {showTratamentoSelector && (
              <Card className="border-primary/30 bg-primary/5">
                <CardContent className="pt-4 pb-3">
                  <p className="text-sm font-semibold text-primary mb-3 flex items-center gap-2">
                    <FileText size={14} /> O que deseja fazer?
                  </p>
                  <div className="space-y-2">
                    {tratamentosExistentes.map((t) => {
                      const saldo = Number(t.valor_contratado || 0) - t.totalPago;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => selecionarTratamento(t)}
                          className="flex w-full items-center justify-between rounded-lg border border-border bg-background px-4 py-3 text-sm hover:border-primary/50 hover:bg-primary/5 transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <CreditCard size={16} className="text-primary" />
                            <div className="text-left">
                              <p className="font-medium text-foreground">{t.procedimento}</p>
                              <p className="text-xs text-muted-foreground">{(t.clinicas as any)?.nome}{t.especialidade ? ` · ${t.especialidade}` : ""}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-muted-foreground">
                              Pago: {formatCurrencyDisplay(t.totalPago)} / {formatCurrencyDisplay(Number(t.valor_contratado || 0))}
                            </p>
                            <p className={`text-xs font-semibold ${saldo > 0 ? "text-destructive" : "text-green-600"}`}>
                              {saldo > 0 ? `Restam: ${formatCurrencyDisplay(saldo)}` : "Quitado"}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={iniciarNovoTratamento}
                      className="flex w-full items-center gap-3 rounded-lg border border-dashed border-border bg-background px-4 py-3 text-sm hover:border-primary/50 hover:bg-primary/5 transition-colors"
                    >
                      <Plus size={16} className="text-primary" />
                      <span className="font-medium text-foreground">Novo tratamento / orçamento</span>
                    </button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Selected treatment summary for payment mode */}
            {showPagamentoFields && tratamentoSelecionado && (
              <Card className="border-green-500/30 bg-green-500/5">
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <CreditCard size={14} className="text-green-600" />
                        Registrar pagamento: {tratamentoSelecionado.procedimento}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Pago: {formatCurrencyDisplay(tratamentoSelecionado.totalPago)} / {formatCurrencyDisplay(Number(tratamentoSelecionado.valor_contratado || 0))}
                        {" — "}Restam: {formatCurrencyDisplay(Number(tratamentoSelecionado.valor_contratado || 0) - tratamentoSelecionado.totalPago)}
                      </p>
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={() => { setModo("selecionar"); setTratamentoSelecionadoId(null); }}>
                      Voltar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="space-y-2">
              <Label>Nome do Paciente</Label>
              <Input placeholder="Nome completo" value={nome} onChange={(e) => setNome(e.target.value)} className="bg-secondary border-border" required readOnly={!!pacienteSelecionadoId} />
            </div>

            {/* New treatment fields */}
            {showNovoTratamentoFields && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Clínica</Label>
                    <Select value={clinicaId} onValueChange={(v) => {
                      setClinicaId(v);
                      const cl = clinicas.find(c => c.id === v);
                      if (cl) setCidade(cl.cidade);
                    }}>
                      <SelectTrigger className="bg-secondary border-border"><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {clinicas.map((c) => (<SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Cidade</Label>
                    <Input placeholder="Cidade" value={cidade} onChange={(e) => setCidade(e.target.value)} className="bg-secondary border-border" />
                  </div>
                </div>

                {/* Procedures list */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-semibold">Procedimentos</Label>
                    <Button type="button" variant="outline" size="sm" onClick={addProcedimento} className="gap-1 text-xs">
                      <Plus size={14} /> Adicionar Procedimento
                    </Button>
                  </div>

                  {procedimentos.map((proc, index) => {
                    const espDisp = getEspecialidadesDisponiveis(proc.procedimento);
                    const temMultiplas = espDisp.length > 1;

                    return (
                      <Card key={proc.id} className="border-border bg-secondary/30">
                        <CardContent className="pt-4 pb-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-muted-foreground">
                              Procedimento {procedimentos.length > 1 ? `${index + 1}` : ""}
                            </span>
                            {procedimentos.length > 1 && (
                              <Button type="button" variant="ghost" size="sm" onClick={() => removeProcedimento(index)} className="h-7 w-7 p-0 text-destructive hover:text-destructive">
                                <Trash2 size={14} />
                              </Button>
                            )}
                          </div>

                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1.5">
                              <Label className="text-xs">Procedimento</Label>
                              <Select value={proc.procedimento} onValueChange={(v) => updateProcedimento(index, "procedimento", v)}>
                                <SelectTrigger className="bg-secondary border-border"><SelectValue placeholder="Selecione" /></SelectTrigger>
                                <SelectContent>
                                  {tiposProcedimento.map((p) => (<SelectItem key={p.id} value={p.nome}>{p.nome}</SelectItem>))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs">Especialidade</Label>
                              {temMultiplas ? (
                                <Select value={proc.especialidade} onValueChange={(v) => updateProcedimento(index, "especialidade", v)}>
                                  <SelectTrigger className="bg-secondary border-border"><SelectValue placeholder="Selecione" /></SelectTrigger>
                                  <SelectContent>
                                    {espDisp.map((e) => (<SelectItem key={e} value={e}>{e}</SelectItem>))}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <Input
                                  readOnly
                                  value={proc.especialidade || "Selecione um procedimento"}
                                  className="bg-muted border-border cursor-not-allowed text-sm"
                                />
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>

                {/* Valores gerais do orçamento */}
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Valor Orçado (R$)</Label>
                    <Input
                      inputMode="numeric"
                      placeholder="R$ 0,00"
                      value={valorOrcadoGeral}
                      onChange={(e) => setValorOrcadoGeral(formatCurrencyInput(e.target.value))}
                      className="bg-secondary border-border"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Valor Contratado (R$)</Label>
                    <Input
                      inputMode="numeric"
                      placeholder="R$ 0,00"
                      value={valorContratadoGeral}
                      onChange={(e) => setValorContratadoGeral(formatCurrencyInput(e.target.value))}
                      className="bg-secondary border-border"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Não Contratado (R$)</Label>
                    <Input readOnly value={formatCurrencyDisplay(Math.max(0, parseCurrency(valorOrcadoGeral) - parseCurrency(valorContratadoGeral)))} className="bg-muted border-border cursor-not-allowed text-sm" />
                  </div>
                </div>

              </>
            )}

            {/* Payment-only fields */}
            {showPagamentoFields && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Valor do Pagamento (R$)</Label>
                  <Input inputMode="numeric" placeholder="R$ 0,00" value={valorPago} onChange={(e) => setValorPago(formatCurrencyInput(e.target.value))} className="bg-secondary border-border [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                </div>
              </div>
            )}

            {/* Payment details */}
            {(showNovoTratamentoFields || showPagamentoFields) && (
              <>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Data do Pagamento</Label>
                    <div className="relative">
                      <CalendarIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <Input type="date" value={dataPagamento} onChange={(e) => setDataPagamento(e.target.value)} className="bg-secondary border-border pl-10" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Forma de Pagamento</Label>
                    <Select value={formaPagamento} onValueChange={setFormaPagamento}>
                      <SelectTrigger className="bg-secondary border-border"><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {formasPagamento.map((f) => (<SelectItem key={f} value={f}>{f}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Tipo de Pagamento</Label>
                    <Select value={tipoPagamento} onValueChange={setTipoPagamento}>
                      <SelectTrigger className="bg-secondary border-border"><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="primeiro">Primeiro Pagamento</SelectItem>
                        <SelectItem value="recorrente">Recorrente</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {showNovoTratamentoFields && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Origem do Lead</Label>
                      <Select value={origem} onValueChange={setOrigem}>
                        <SelectTrigger className="bg-secondary border-border"><SelectValue placeholder="Selecione" /></SelectTrigger>
                        <SelectContent>
                          {origens.map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Nome do Anúncio</Label>
                      <Input placeholder="Ex: Campanha Implante Jan" value={nomeAnuncio} onChange={(e) => setNomeAnuncio(e.target.value)} className="bg-secondary border-border" />
                    </div>
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={saving}
                  className="w-full gradient-orange text-primary-foreground font-semibold shadow-orange hover:opacity-90 transition-opacity"
                >
                  <Save size={18} className="mr-2" />
                  {saving ? "Salvando..." : modo === "novo_pagamento" ? "Registrar Pagamento" : `Salvar Atendimento${procedimentos.length > 1 ? ` (${procedimentos.length} procedimentos)` : ""}`}
                </Button>
              </>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default Atendimento;
