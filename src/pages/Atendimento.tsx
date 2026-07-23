import { useState, useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Save, Search, UserCheck, CalendarIcon, Plus, CreditCard, Trash2, UserPlus, Stethoscope } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Tables } from "@/integrations/supabase/types";

const origens = ["Anúncio", "Instagram", "Google Ads", "Facebook", "Indicação", "Site", "Outros"];

// Retorna "YYYY-MM-DD" do dia atual em horário LOCAL (BRT). Usar toISOString aqui
// causaria deslocamento de fuso (à noite o sistema gravaria o dia seguinte).
const todayLocalISO = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

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

interface TipoProcedimento {
  especialidade: string | null;
  especialidade_secundaria: string | null;
}

type EspMode = "existente" | "nova";

interface PagamentoEntry {
  id: string;
  mode: EspMode;
  especialidade: string;
  valor: string;
  // Regra oficial (conciliação com Dontus 07/2026): ORTODONTIA só conta no
  // faturamento quando há PANORÂMICA ou APARELHO no dia (início de tratamento).
  // Manutenção/mensalidade/braquete/moldagem/contenção = recorrência (não conta).
  // null = ainda não respondido (obrigatório quando especialidade = ORTODONTIA).
  recorrenciaOrto: boolean | null;
}

// Detecta ORTODONTIA independente de acento/caixa.
const isOrto = (esp: string) =>
  esp.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim() === "ORTODONTIA";

const createEmptyEntry = (mode: EspMode = "nova"): PagamentoEntry => ({
  id: crypto.randomUUID(),
  mode,
  especialidade: "",
  valor: "",
  recorrenciaOrto: null,
});

const Atendimento = () => {
  const { user } = useAuth();
  const location = useLocation();
  const [clinicas, setClinicas] = useState<Tables<"clinicas">[]>([]);
  const [especialidadesDisponiveis, setEspecialidadesDisponiveis] = useState<string[]>([]);
  const [telefone, setTelefone] = useState("");
  const [nome, setNome] = useState("");
  const [clinicaId, setClinicaId] = useState("");
  const [cidade, setCidade] = useState("");
  const [origem, setOrigem] = useState("");
  const [nomeAnuncio, setNomeAnuncio] = useState("");
  const [origemOutrosDesc, setOrigemOutrosDesc] = useState("");
  const [tipoPagamento, setTipoPagamento] = useState("primeiro");
  const [dataPagamento, setDataPagamento] = useState(() => todayLocalISO());
  const [sugestoes, setSugestoes] = useState<Tables<"pacientes">[]>([]);
  const [pacienteSelecionadoId, setPacienteSelecionadoId] = useState<string | null>(null);
  const [especialidadesDoLead, setEspecialidadesDoLead] = useState<{ especialidade: string; total: number }[]>([]);
  const [entries, setEntries] = useState<PagamentoEntry[]>([createEmptyEntry("nova")]);
  const [saving, setSaving] = useState(false);
  const [initialPatientLoaded, setInitialPatientLoaded] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [duplicates, setDuplicates] = useState<Tables<"pacientes">[]>([]);
  const [forceCreateNew, setForceCreateNew] = useState(false);

  useEffect(() => {
    supabase.from("clinicas").select("*").eq("ativa", true).then(({ data }) => {
      if (data) setClinicas(data);
    });
    supabase
      .from("tipos_procedimento")
      .select("especialidade, especialidade_secundaria")
      .eq("ativo", true)
      .then(({ data }) => {
        const set = new Set<string>();
        (data as TipoProcedimento[] | null)?.forEach((t) => {
          if (t.especialidade) set.add(t.especialidade);
          if (t.especialidade_secundaria) set.add(t.especialidade_secundaria);
        });
        setEspecialidadesDisponiveis(Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR")));
      });
  }, []);

  const especialidadesJaCadastradas = useMemo(
    () => new Set(especialidadesDoLead.map((e) => e.especialidade)),
    [especialidadesDoLead]
  );

  const especialidadesNovasDisponiveis = useMemo(
    () => especialidadesDisponiveis.filter((e) => !especialidadesJaCadastradas.has(e)),
    [especialidadesDisponiveis, especialidadesJaCadastradas]
  );

  const carregarEspecialidadesDoLead = async (pacienteId: string) => {
    const { data } = await supabase
      .from("pagamentos")
      .select("valor, especialidade")
      .eq("paciente_id", pacienteId);
    const map = new Map<string, number>();
    (data || []).forEach((p: any) => {
      const esp = p.especialidade || "Sem especialidade";
      map.set(esp, (map.get(esp) || 0) + Number(p.valor || 0));
    });
    const list = Array.from(map.entries())
      .map(([especialidade, total]) => ({ especialidade, total }))
      .sort((a, b) => b.total - a.total);
    setEspecialidadesDoLead(list);
    // Ajusta modo dos entries vazios para o padrão certo
    const defaultMode: EspMode = list.length > 0 ? "existente" : "nova";
    setEntries((prev) =>
      prev.map((e) => (!e.especialidade && !e.valor ? { ...e, mode: defaultMode } : e))
    );
    return list;
  };

  const preencherPacienteSelecionado = async (paciente: {
    id: string;
    nome?: string;
    telefone?: string;
    cidade?: string | null;
    origem?: string | null;
    nome_anuncio?: string | null;
  }) => {
    const rawPhone = paciente.telefone || "";
    const formatted = rawPhone.includes("(") ? rawPhone : formatPhone(rawPhone);

    setTelefone(formatted);
    setNome(paciente.nome || "");
    setCidade(paciente.cidade || "");
    setOrigem(paciente.origem || "");
    setNomeAnuncio(paciente.nome_anuncio || "");
    setPacienteSelecionadoId(paciente.id);
    setSugestoes([]);
    setClinicaId("");

    const list = await carregarEspecialidadesDoLead(paciente.id);
    setEntries([createEmptyEntry(list.length > 0 ? "existente" : "nova")]);
  };

  useEffect(() => {
    const state = location.state as { pacienteId?: string; pacienteNome?: string; pacienteTelefone?: string; pacienteCidade?: string; pacienteOrigem?: string; pacienteNomeAnuncio?: string } | null;
    if (state?.pacienteId && !initialPatientLoaded) {
      setInitialPatientLoaded(true);
      void preencherPacienteSelecionado({
        id: state.pacienteId,
        nome: state.pacienteNome,
        telefone: state.pacienteTelefone,
        cidade: state.pacienteCidade,
        origem: state.pacienteOrigem,
        nome_anuncio: state.pacienteNomeAnuncio,
      });
    }
  }, [location.state, initialPatientLoaded]);

  // Auto-pick clinic: single active clinic, otherwise first match by city
  useEffect(() => {
    if (clinicaId || clinicas.length === 0) return;
    const activeClinicas = clinicas.filter((c) => c.ativa);
    if (activeClinicas.length === 1) {
      setClinicaId(activeClinicas[0].id);
      return;
    }
    if (!cidade) return;
    const matches = activeClinicas.filter((c) => c.cidade === cidade);
    if (matches.length > 0) {
      setClinicaId(matches[0].id);
    }
  }, [cidade, clinicas, clinicaId]);

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
    setEspecialidadesDoLead([]);
    setEntries([createEmptyEntry("nova")]);

    const digits = value.replace(/\D/g, "");
    if (digits.length >= 4) {
      const { data } = await supabase
        .from("pacientes")
        .select("*")
        .or(`telefone.ilike.%${digits}%,telefone.ilike.%${formatted}%`)
        .limit(5);
      setSugestoes(data || []);
    } else {
      setSugestoes([]);
    }
  };

  const selecionarPaciente = async (pac: Tables<"pacientes">) => {
    await preencherPacienteSelecionado(pac);
    toast.success(`Paciente ${pac.nome} selecionado!`);
  };

  const updateEntry = <K extends keyof PagamentoEntry>(index: number, field: K, value: PagamentoEntry[K]) => {
    setEntries((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      if (field === "mode" || field === "especialidade") {
        // Reset da flag de recorrência sempre que a especialidade muda (ou o modo).
        if (field === "mode") updated[index].especialidade = "";
        updated[index].recorrenciaOrto = false;
      }
      return updated;
    });
  };

  const addEntry = () => {
    const defaultMode: EspMode = especialidadesDoLead.length > 0 ? "existente" : "nova";
    setEntries((prev) => [...prev, createEmptyEntry(defaultMode)]);
  };

  const removeEntry = (index: number) => {
    setEntries((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  // Após registrar pagamento, move leads vinculados ao paciente para etapa "contratado"
  const moveLinkedLeadsToContratado = async (pacienteId: string) => {
    try {
      // Busca leads vinculados a este paciente
      const { data: links } = await supabase
        .from("crm_lead_pacientes")
        .select("lead_id")
        .eq("paciente_id", pacienteId);

      if (!links || links.length === 0) return;

      const leadIds = links.map((l: any) => l.lead_id);

      // Busca stage e pipeline de cada lead
      const { data: leadsData } = await supabase
        .from("crm_leads")
        .select("id, stage_id, pipeline_id")
        .in("id", leadIds);

      if (!leadsData || leadsData.length === 0) return;

      // Agrupa leads por pipeline para minimizar queries
      const pipelineMap = new Map<string, { leadId: string; stageId: string | null }[]>();
      for (const l of leadsData as any[]) {
        if (!l.pipeline_id) continue;
        const arr = pipelineMap.get(l.pipeline_id) || [];
        arr.push({ leadId: l.id, stageId: l.stage_id });
        pipelineMap.set(l.pipeline_id, arr);
      }

      for (const [pipelineId, leads] of pipelineMap.entries()) {
        const { data: stages } = await supabase
          .from("crm_stages")
          .select("id, name, position")
          .eq("pipeline_id", pipelineId)
          .order("position");

        if (!stages || stages.length === 0) continue;

        const contratadoStage = (stages as any[]).find((s) => /contrat/i.test(s.name));
        if (!contratadoStage) continue;

        for (const lead of leads) {
          const currentStage = (stages as any[]).find((s) => s.id === lead.stageId);
          const currentPos = currentStage?.position ?? -1;
          if (currentPos >= contratadoStage.position) continue; // já está em etapa igual ou posterior

          await supabase
            .from("crm_leads")
            .update({ stage_id: contratadoStage.id, updated_at: new Date().toISOString() })
            .eq("id", lead.leadId);
        }
      }
    } catch {
      // Silencia erros — o pagamento já foi salvo com sucesso
    }
  };

  const resetForm = () => {
    setTelefone("");
    setNome("");
    setClinicaId("");
    setCidade("");
    setOrigem("");
    setNomeAnuncio("");
    setOrigemOutrosDesc("");
    setTipoPagamento("primeiro");
    setDataPagamento(todayLocalISO());
    setPacienteSelecionadoId(null);
    setEspecialidadesDoLead([]);
    setEntries([createEmptyEntry("nova")]);
  };

  const totalLancamento = entries.reduce((s, e) => s + parseCurrency(e.valor), 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!nome.trim()) {
      toast.error("Informe o nome do paciente.");
      return;
    }
    if (!clinicaId) {
      toast.error("Selecione a clínica.");
      return;
    }

    for (let i = 0; i < entries.length; i++) {
      const ent = entries[i];
      if (!ent.especialidade) {
        toast.error(`Selecione a especialidade do pagamento ${entries.length > 1 ? i + 1 : ""}.`);
        return;
      }
      if (parseCurrency(ent.valor) <= 0) {
        toast.error(`Informe o valor do pagamento ${entries.length > 1 ? i + 1 : ""}.`);
        return;
      }
      if (isOrto(ent.especialidade) && ent.recorrenciaOrto === null) {
        toast.error(`Responda a pergunta de ortodontia do pagamento ${entries.length > 1 ? i + 1 : ""}.`);
        return;
      }
    }

    setSaving(true);
    try {
      let pacienteId = pacienteSelecionadoId;

      if (!pacienteId) {
        if (!forceCreateNew) {
          const phoneClean = telefone.replace(/\D/g, "");
          if (phoneClean.length >= 8) {
            const tail = phoneClean.slice(-8);
            // Busca ampla por subsequência curta e filtra client-side comparando
            // apenas dígitos. Evita falsos positivos do padrão frouxo anterior
            // (%d1%d2%d3...%) que casava dígitos com qualquer coisa entre eles.
            const { data: candidates } = await supabase
              .from("pacientes")
              .select("*")
              .ilike("telefone", `%${tail.slice(-4)}%`)
              .limit(50);
            const existing = (candidates || []).filter((p: any) => {
              const d = String(p.telefone || "").replace(/\D/g, "");
              return d.length >= 8 && d.endsWith(tail);
            });
            if (existing.length > 0) {
              setDuplicates(existing);
              setDuplicateOpen(true);
              setSaving(false);
              return;
            }
          }
        }

        const nomeAnuncioFinal = origem === "Anúncio" ? nomeAnuncio : origem === "Outros" ? origemOutrosDesc : null;
        const { data: newPac, error } = await supabase
          .from("pacientes")
          .insert({ nome, telefone, cidade: cidade || null, origem: origem || null, nome_anuncio: nomeAnuncioFinal || null })
          .select("id")
          .single();
        if (error) throw error;
        pacienteId = newPac.id;
        setForceCreateNew(false);
      }

      for (const ent of entries) {
        const isOrtodontia = isOrto(ent.especialidade);
        const { error: pagError } = await supabase.from("pagamentos").insert({
          paciente_id: pacienteId,
          clinica_id: clinicaId,
          especialidade: ent.especialidade,
          valor: parseCurrency(ent.valor),
          forma_pagamento: "Não informado",
          tipo: tipoPagamento,
          data_pagamento: dataPagamento,
          created_by: user?.id,
          // Só ortodontia usa a resposta; outras especialidades gravam sempre false.
          recorrencia_orto: isOrtodontia ? ent.recorrenciaOrto === true : false,
        } as any);
        if (pagError) throw pagError;
      }

      // Move leads vinculados ao paciente para etapa "contratado" automaticamente
      await moveLinkedLeadsToContratado(pacienteId!);

      toast.success(
        entries.length > 1
          ? `${entries.length} pagamentos registrados com sucesso!`
          : "Pagamento registrado com sucesso!"
      );
      resetForm();
    } catch (err: any) {
      toast.error("Erro ao salvar: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const isExistingPatient = !!pacienteSelecionadoId;

  return (
    <div className="mx-auto max-w-3xl animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Novo Atendimento</h1>
        <p className="text-sm text-muted-foreground">Cadastro de pagamento por especialidade</p>
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
                  <div className="border-t border-border my-1" />
                  <button
                    type="button"
                    onClick={() => {
                      setSugestoes([]);
                      setPacienteSelecionadoId("");
                      setForceCreateNew(true);
                      toast.info("Preencha o nome e demais dados — será criado um novo paciente com este telefone.");
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-primary hover:bg-accent transition-colors"
                  >
                    <UserPlus size={14} />
                    <span className="font-medium">Cadastrar nova pessoa com este telefone</span>
                  </button>
                </div>
              )}
              {pacienteSelecionadoId && (
                <button
                  type="button"
                  onClick={() => {
                    setPacienteSelecionadoId("");
                    setNome("");
                    setEspecialidadesDoLead([]);
                    setEntries([createEmptyEntry("nova")]);
                    setForceCreateNew(true);
                    toast.info("Preencha o nome — será criado um novo paciente com este telefone.");
                  }}
                  className="mt-1 flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <UserPlus size={12} />
                  Cadastrar outra pessoa com este mesmo telefone
                </button>
              )}
            </div>

            {isExistingPatient && especialidadesDoLead.length > 0 && (
              <Card className="border-primary/30 bg-primary/5">
                <CardContent className="pt-4 pb-3">
                  <p className="text-sm font-semibold text-primary mb-3 flex items-center gap-2">
                    <Stethoscope size={14} /> Especialidades já contratadas
                  </p>
                  <div className="space-y-1">
                    {especialidadesDoLead.map((e) => (
                      <div key={e.especialidade} className="flex items-center justify-between text-sm px-3 py-1.5 rounded bg-background/50">
                        <span className="font-medium text-foreground">{e.especialidade}</span>
                        <span className="text-xs text-primary font-semibold">{formatCurrencyDisplay(e.total)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
                    <span className="text-sm font-semibold">Total contratado</span>
                    <span className="text-sm font-bold text-primary">
                      {formatCurrencyDisplay(especialidadesDoLead.reduce((s, e) => s + e.total, 0))}
                    </span>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="space-y-2">
              <Label>Nome do Paciente</Label>
              <Input
                placeholder="Nome completo"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                className="bg-secondary border-border"
                required
                readOnly={!!pacienteSelecionadoId}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Clínica</Label>
                <Select
                  value={clinicaId}
                  onValueChange={(v) => {
                    setClinicaId(v);
                    const cl = clinicas.find((c) => c.id === v);
                    if (cl) setCidade(cl.cidade);
                  }}
                >
                  <SelectTrigger className="bg-secondary border-border">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {clinicas.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Cidade</Label>
                <Input
                  placeholder="Cidade"
                  value={cidade}
                  onChange={(e) => setCidade(e.target.value)}
                  className="bg-secondary border-border"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Data do Pagamento</Label>
                <div className="relative">
                  <CalendarIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="date"
                    value={dataPagamento}
                    onChange={(e) => setDataPagamento(e.target.value)}
                    className="bg-secondary border-border pl-10"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Tipo de Pagamento</Label>
                <Select value={tipoPagamento} onValueChange={setTipoPagamento}>
                  <SelectTrigger className="bg-secondary border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="primeiro">Primeiro pagamento</SelectItem>
                    <SelectItem value="recorrente">Recorrente</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold flex items-center gap-2">
                  <CreditCard size={14} className="text-primary" />
                  Pagamentos por especialidade
                </Label>
                <Button type="button" variant="outline" size="sm" onClick={addEntry} className="gap-1 text-xs">
                  <Plus size={14} /> Adicionar pagamento
                </Button>
              </div>

              {entries.map((ent, index) => {
                const opcoesParaModo =
                  ent.mode === "existente"
                    ? especialidadesDoLead.map((e) => e.especialidade)
                    : especialidadesNovasDisponiveis;

                return (
                  <Card key={ent.id} className="border-border bg-secondary/30">
                    <CardContent className="pt-4 pb-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-muted-foreground">
                          Pagamento {entries.length > 1 ? `${index + 1}` : ""}
                        </span>
                        {entries.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeEntry(index)}
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                          >
                            <Trash2 size={14} />
                          </Button>
                        )}
                      </div>

                      {isExistingPatient && especialidadesDoLead.length > 0 && (
                        <div className="space-y-1.5">
                          <Label className="text-xs">Tipo</Label>
                          <Select
                            value={ent.mode}
                            onValueChange={(v) => updateEntry(index, "mode", v as EspMode)}
                          >
                            <SelectTrigger className="bg-secondary border-border">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="existente">Especialidade já cadastrada (somar)</SelectItem>
                              <SelectItem value="nova">Nova especialidade</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Especialidade</Label>
                          <Select
                            value={ent.especialidade}
                            onValueChange={(v) => updateEntry(index, "especialidade", v)}
                          >
                            <SelectTrigger className="bg-secondary border-border">
                              <SelectValue placeholder="Selecione" />
                            </SelectTrigger>
                            <SelectContent>
                              {opcoesParaModo.length === 0 ? (
                                <div className="px-3 py-2 text-xs text-muted-foreground">
                                  {ent.mode === "existente"
                                    ? "Nenhuma especialidade cadastrada"
                                    : "Todas as especialidades já estão cadastradas para este paciente"}
                                </div>
                              ) : (
                                opcoesParaModo.map((esp) => {
                                  const total = especialidadesDoLead.find((e) => e.especialidade === esp)?.total;
                                  return (
                                    <SelectItem key={esp} value={esp}>
                                      {esp}
                                      {ent.mode === "existente" && total !== undefined
                                        ? ` (atual: ${formatCurrencyDisplay(total)})`
                                        : ""}
                                    </SelectItem>
                                  );
                                })
                              )}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Valor contratado (R$)</Label>
                          <Input
                            inputMode="numeric"
                            placeholder="R$ 0,00"
                            value={ent.valor}
                            onChange={(e) => updateEntry(index, "valor", formatCurrencyInput(e.target.value))}
                            className="bg-secondary border-border"
                          />
                        </div>
                      </div>

                      {isOrto(ent.especialidade) && (
                        <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
                          <p className="text-xs font-semibold text-foreground">
                            Houve panorâmica ou aparelho neste atendimento?
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            Regra oficial: ortodontia só conta no faturamento quando é <strong>início de tratamento</strong>. Manutenção, mensalidade, braquete, moldagem ou contenção contam como recorrência e não entram nos relatórios.
                          </p>
                          <label className="flex items-start gap-2 cursor-pointer text-xs">
                            <input
                              type="radio"
                              name={`recorrencia-${ent.id}`}
                              checked={ent.recorrenciaOrto === false}
                              onChange={() => updateEntry(index, "recorrenciaOrto", false)}
                              className="mt-0.5"
                            />
                            <span>
                              <strong>Sim</strong>, início de tratamento <span className="text-muted-foreground">(conta no faturamento)</span>
                            </span>
                          </label>
                          <label className="flex items-start gap-2 cursor-pointer text-xs">
                            <input
                              type="radio"
                              name={`recorrencia-${ent.id}`}
                              checked={ent.recorrenciaOrto === true}
                              onChange={() => updateEntry(index, "recorrenciaOrto", true)}
                              className="mt-0.5"
                            />
                            <span>
                              <strong>Não</strong>, é recorrência <span className="text-muted-foreground">(manutenção/mensalidade/braquete/moldagem — não conta)</span>
                            </span>
                          </label>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}

              <div className="rounded-lg bg-secondary/30 p-3 text-sm flex items-center justify-between">
                <span className="text-muted-foreground">Total deste lançamento</span>
                <span className="font-semibold text-primary">{formatCurrencyDisplay(totalLancamento)}</span>
              </div>
            </div>

            {!isExistingPatient && (
              <>
                <div className="space-y-2">
                  <Label>Origem do Lead</Label>
                  <Select
                    value={origem}
                    onValueChange={(v) => {
                      setOrigem(v);
                      setNomeAnuncio("");
                      setOrigemOutrosDesc("");
                    }}
                  >
                    <SelectTrigger className="bg-secondary border-border">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {origens.map((o) => (
                        <SelectItem key={o} value={o}>
                          {o}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {origem === "Anúncio" && (
                  <div className="space-y-2">
                    <Label>Nome do Anúncio</Label>
                    <Input
                      placeholder="Ex: Campanha Implante Jan"
                      value={nomeAnuncio}
                      onChange={(e) => setNomeAnuncio(e.target.value)}
                      className="bg-secondary border-border"
                    />
                  </div>
                )}
                {origem === "Outros" && (
                  <div className="space-y-2">
                    <Label>De onde veio o lead?</Label>
                    <Input
                      placeholder="Descreva a origem do lead"
                      value={origemOutrosDesc}
                      onChange={(e) => setOrigemOutrosDesc(e.target.value)}
                      className="bg-secondary border-border"
                    />
                  </div>
                )}
              </>
            )}

            <Button
              type="submit"
              disabled={saving}
              className="w-full gradient-orange text-primary-foreground font-semibold shadow-orange hover:opacity-90 transition-opacity"
            >
              <Save size={18} className="mr-2" />
              {saving
                ? "Salvando..."
                : entries.length > 1
                ? `Registrar ${entries.length} pagamentos`
                : "Registrar Pagamento"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Dialog open={duplicateOpen} onOpenChange={setDuplicateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Telefone já cadastrado</DialogTitle>
            <DialogDescription>
              Encontramos {duplicates.length} paciente{duplicates.length > 1 ? "s" : ""} com este telefone. Selecione um existente ou cadastre como pessoa diferente (mesmo telefone).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {duplicates.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 p-2 rounded border border-border bg-secondary/50">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{p.nome}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {p.telefone}
                    {p.cidade ? ` · ${p.cidade}` : ""}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={async () => {
                    setDuplicateOpen(false);
                    await preencherPacienteSelecionado(p);
                    toast.success(`Paciente ${p.nome} selecionado!`);
                  }}
                >
                  Selecionar
                </Button>
              </div>
            ))}
          </div>
          <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <Button variant="outline" type="button" onClick={() => setDuplicateOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => {
                setForceCreateNew(true);
                setDuplicateOpen(false);
                setTimeout(() => {
                  const form = document.querySelector("form");
                  if (form) form.requestSubmit();
                }, 0);
              }}
            >
              Cadastrar como pessoa diferente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Atendimento;
