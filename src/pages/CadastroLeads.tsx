import { useState, useEffect, useCallback } from "react";
import { toLocalDateISO } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Save, TrendingUp, CalendarDays, Pencil, Trash2, List, RefreshCw, Users, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Tables } from "@/integrations/supabase/types";
import { format } from "date-fns";

type LeadWithClinica = Tables<"leads_diarios"> & { clinicas?: { nome: string } | null };

// Leitura de campo numérico que distingue "não preenchido" de "0 de verdade":
// - campo vazio => valor null (nunca é coagido para 0);
// - valor não inteiro ou negativo => invalido (nunca é "consertado" silenciosamente).
type CampoNum = { valor: number | null; invalido: boolean };
const lerCampo = (s: string): CampoNum => {
  const t = s.trim();
  if (t === "") return { valor: null, invalido: false };
  const n = Number(t);
  if (!Number.isInteger(n) || n < 0) return { valor: null, invalido: true };
  return { valor: n, invalido: false };
};

const CadastroLeads = () => {
  const { user } = useAuth();
  const [clinicas, setClinicas] = useState<Tables<"clinicas">[]>([]);

  // Leads Novos - separate date, clinic, value
  const [dataLeads, setDataLeads] = useState(() => toLocalDateISO());
  const [clinicaIdLeads, setClinicaIdLeads] = useState("");
  const [leadsNovos, setLeadsNovos] = useState("");
  const [savingLeads, setSavingLeads] = useState(false);
  const [tentouSalvarLeads, setTentouSalvarLeads] = useState(false);
  const [existingIdLeads, setExistingIdLeads] = useState<string | null>(null);

  // Agendados + Reagendados - separate date, clinic
  const [dataAgendados, setDataAgendados] = useState(() => toLocalDateISO());
  const [clinicaIdAgendados, setClinicaIdAgendados] = useState("");
  const [agendaram, setAgendaram] = useState("");
  const [compareceram, setCompareceram] = useState("");
  const [contrataram, setContrataram] = useState("");
  const [remarcados, setRemarcados] = useState("");
  const [reagendadosCompareceram, setReagendadosCompareceram] = useState("");
  const [reagendadosContrataram, setReagendadosContrataram] = useState("");
  const [savingAgendados, setSavingAgendados] = useState(false);
  const [tentouSalvarAgendados, setTentouSalvarAgendados] = useState(false);
  const [existingIdAgendados, setExistingIdAgendados] = useState<string | null>(null);

  const [registros, setRegistros] = useState<LeadWithClinica[]>([]);

  // Campos lidos (null = não preenchido; nunca coagido para 0)
  const cLeadsNovos = lerCampo(leadsNovos);
  const cAgendaram = lerCampo(agendaram);
  const cCompareceram = lerCampo(compareceram);
  const cContrataram = lerCampo(contrataram);
  const cRemarcados = lerCampo(remarcados);
  const cReagComp = lerCampo(reagendadosCompareceram);
  const cReagContr = lerCampo(reagendadosContrataram);

  // Derivados SEM clamp: um valor negativo aqui indica lançamento impossível
  // (ex.: compareceram > agendados) e gera erro visível que bloqueia o salvamento,
  // em vez de ser silenciosamente zerado por Math.max(..., 0).
  const faltaram = cAgendaram.valor !== null && cCompareceram.valor !== null
    ? cAgendaram.valor - cCompareceram.valor : null;
  const naoContrataram = cCompareceram.valor !== null && cContrataram.valor !== null
    ? cCompareceram.valor - cContrataram.valor : null;
  const reagendadosFaltaram = cRemarcados.valor !== null && cReagComp.valor !== null
    ? cRemarcados.valor - cReagComp.valor : null;
  const reagendadosNaoContrataram = cReagComp.valor !== null && cReagContr.valor !== null
    ? cReagComp.valor - cReagContr.valor : null;
  // Pode ser negativo de verdade: os reagendados de hoje vêm de faltas de dias
  // anteriores, então não é limitado às faltas do próprio dia.
  const faltasLiquidas = faltaram !== null && cRemarcados.valor !== null && reagendadosFaltaram !== null
    ? faltaram - cRemarcados.valor + reagendadosFaltaram : null;

  // ---- Validação do card "Leads Novos" ----
  const erroLeadsNovos = cLeadsNovos.invalido
    ? "Quantidade de leads novos inválida — use um número inteiro maior ou igual a 0."
    : tentouSalvarLeads && cLeadsNovos.valor === null
      ? "Quantidade de leads novos não preenchida. Digite 0 se não houve leads novos."
      : null;

  // ---- Validação do card "Agendados + Reagendados" ----
  const camposAgendados: { rotulo: string; campo: CampoNum }[] = [
    { rotulo: "Agendados", campo: cAgendaram },
    { rotulo: "Compareceram (agendados)", campo: cCompareceram },
    { rotulo: "Contrataram (agendados)", campo: cContrataram },
    { rotulo: "Reagendados", campo: cRemarcados },
    { rotulo: "Compareceram (reagendados)", campo: cReagComp },
    { rotulo: "Contrataram (reagendados)", campo: cReagContr },
  ];

  const errosInvalidosAgendados = camposAgendados
    .filter(({ campo }) => campo.invalido)
    .map(({ rotulo }) => `${rotulo}: valor inválido — use um número inteiro maior ou igual a 0.`);

  const errosConsistenciaAgendados: string[] = [];
  if (faltaram !== null && faltaram < 0)
    errosConsistenciaAgendados.push(`Compareceram (${cCompareceram.valor}) não podem exceder os agendados do dia (${cAgendaram.valor}).`);
  if (naoContrataram !== null && naoContrataram < 0)
    errosConsistenciaAgendados.push(`Contrataram (${cContrataram.valor}) não podem exceder os que compareceram (${cCompareceram.valor}).`);
  if (reagendadosFaltaram !== null && reagendadosFaltaram < 0)
    errosConsistenciaAgendados.push(`Compareceram (reagendados) (${cReagComp.valor}) não podem exceder os reagendados do dia (${cRemarcados.valor}).`);
  if (reagendadosNaoContrataram !== null && reagendadosNaoContrataram < 0)
    errosConsistenciaAgendados.push(`Contrataram (reagendados) (${cReagContr.valor}) não podem exceder os reagendados que compareceram (${cReagComp.valor}).`);

  // Campo vazio ("não preenchido") é diferente de 0: o zero precisa ser digitado.
  // Esses erros só ficam visíveis depois de uma tentativa de salvar.
  const errosVaziosAgendados = camposAgendados
    .filter(({ campo }) => !campo.invalido && campo.valor === null)
    .map(({ rotulo }) => `${rotulo}: não preenchido. Digite 0 se o valor real for zero.`);

  const errosVisiveisAgendados = [
    ...errosInvalidosAgendados,
    ...errosConsistenciaAgendados,
    ...(tentouSalvarAgendados ? errosVaziosAgendados : []),
  ];

  useEffect(() => {
    supabase.from("clinicas").select("*").eq("ativa", true).then(({ data }) => {
      if (data) setClinicas(data);
    });
  }, []);

  const fetchRegistros = useCallback(async () => {
    const { data } = await supabase
      .from("leads_diarios")
      .select("*, clinicas(nome)")
      .order("data", { ascending: false })
      .limit(50);
    if (data) setRegistros(data);
  }, []);

  useEffect(() => { fetchRegistros(); }, [fetchRegistros]);

  // Auto-load for Leads Novos
  useEffect(() => {
    if (!clinicaIdLeads || !dataLeads) { setExistingIdLeads(null); return; }
    supabase.from("leads_diarios").select("*").eq("data", dataLeads).eq("clinica_id", clinicaIdLeads).maybeSingle()
      .then(({ data: existing }) => {
        if (existing) { setExistingIdLeads(existing.id); setLeadsNovos(String(existing.leads_novos)); }
        else { setExistingIdLeads(null); setLeadsNovos(""); setTentouSalvarLeads(false); }
      });
  }, [clinicaIdLeads, dataLeads]);

  // Auto-load for Agendados
  useEffect(() => {
    if (!clinicaIdAgendados || !dataAgendados) { setExistingIdAgendados(null); return; }
    supabase.from("leads_diarios").select("*").eq("data", dataAgendados).eq("clinica_id", clinicaIdAgendados).maybeSingle()
      .then(({ data: existing }) => {
        if (existing) {
          setExistingIdAgendados(existing.id);
          setAgendaram(String(existing.agendaram));
          setCompareceram(String(existing.compareceram));
          setContrataram(String(existing.contrataram));
          setRemarcados(String(existing.remarcados));
          setReagendadosCompareceram(String((existing as any).reagendados_compareceram ?? 0));
          setReagendadosContrataram(String((existing as any).reagendados_contrataram ?? 0));
        } else {
          setExistingIdAgendados(null);
          setAgendaram(""); setCompareceram(""); setContrataram("");
          setRemarcados(""); setReagendadosCompareceram(""); setReagendadosContrataram("");
          setTentouSalvarAgendados(false);
        }
      });
  }, [clinicaIdAgendados, dataAgendados]);

  // Save Leads Novos
  const handleSaveLeads = async () => {
    setTentouSalvarLeads(true);
    if (!dataLeads) { toast.error("Informe a data."); return; }
    if (!clinicaIdLeads) { toast.error("Selecione uma clínica."); return; }
    if (cLeadsNovos.invalido || cLeadsNovos.valor === null) {
      toast.error("Não foi possível salvar: corrija a quantidade de leads novos.");
      return;
    }
    setSavingLeads(true);
    try {
      // Upsert idempotente (UNIQUE data,clinica_id). Evita colisão quando "Agendados"
      // é salvo antes/depois de "Leads Novos" e o existingId está desatualizado.
      const { data: up, error } = await supabase
        .from("leads_diarios")
        .upsert(
          {
            data: dataLeads, clinica_id: clinicaIdLeads, leads_novos: cLeadsNovos.valor,
            created_by: user?.id,
          },
          { onConflict: "data,clinica_id", ignoreDuplicates: false },
        )
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (up?.id) setExistingIdLeads(up.id);
      toast.success("Leads novos salvos!");
      setTentouSalvarLeads(false);
      fetchRegistros();
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    } finally {
      setSavingLeads(false);
    }
  };

  // Save Agendados + Reagendados
  const handleSaveAgendados = async () => {
    setTentouSalvarAgendados(true);
    if (!dataAgendados) { toast.error("Informe a data."); return; }
    if (!clinicaIdAgendados) { toast.error("Selecione uma clínica."); return; }
    if (errosInvalidosAgendados.length > 0 || errosConsistenciaAgendados.length > 0 || errosVaziosAgendados.length > 0) {
      toast.error("Não foi possível salvar: corrija os campos indicados no formulário.");
      return;
    }
    const vAgendaram = cAgendaram.valor;
    const vCompareceram = cCompareceram.valor;
    const vContrataram = cContrataram.valor;
    const vRemarcados = cRemarcados.valor;
    const vReagComp = cReagComp.valor;
    const vReagContr = cReagContr.valor;
    if (vAgendaram === null || vCompareceram === null || vContrataram === null || vRemarcados === null || vReagComp === null || vReagContr === null) {
      // Inalcançável: campos vazios já foram bloqueados acima (errosVaziosAgendados).
      return;
    }
    setSavingAgendados(true);
    try {
      const payload = {
        data: dataAgendados,
        clinica_id: clinicaIdAgendados,
        agendaram: vAgendaram,
        compareceram: vCompareceram,
        contrataram: vContrataram,
        // Derivados garantidos >= 0 pela validação de consistência acima.
        faltaram: vAgendaram - vCompareceram,
        nao_contrataram: vCompareceram - vContrataram,
        remarcados: vRemarcados,
        reagendados_compareceram: vReagComp,
        reagendados_contrataram: vReagContr,
        created_by: user?.id,
      };
      // Upsert idempotente (UNIQUE data,clinica_id) — preserva leads_novos existente
      // (não enviado no payload) e evita erro/duplicação quando "Leads Novos" foi
      // salvo antes.
      const { data: up, error } = await supabase
        .from("leads_diarios")
        .upsert(payload, { onConflict: "data,clinica_id", ignoreDuplicates: false })
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (up?.id) setExistingIdAgendados(up.id);
      toast.success("Dados de agendados salvos!");
      setTentouSalvarAgendados(false);
      fetchRegistros();
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    } finally {
      setSavingAgendados(false);
    }
  };

  const handleEdit = (registro: LeadWithClinica) => {
    setDataLeads(registro.data);
    setDataAgendados(registro.data);
    setClinicaIdLeads(registro.clinica_id);
    setClinicaIdAgendados(registro.clinica_id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase.from("leads_diarios").delete().eq("id", id);
      if (error) throw error;
      toast.success("Registro excluído!");
      fetchRegistros();
    } catch (err: any) {
      toast.error("Erro ao excluir: " + err.message);
    }
  };

  const getClinicaNome = (r: LeadWithClinica) => r.clinicas?.nome || "—";



  return (
    <div className="mx-auto max-w-4xl animate-fade-in space-y-6">
      <div className="mb-2">
        <h1 className="text-2xl font-bold">Cadastro de Leads</h1>
        <p className="text-sm text-muted-foreground">Gerencie o funil de vendas diário</p>
      </div>

      {/* CARD 1: Leads Novos */}
      <Card className="gradient-card border-border shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users size={18} className="text-primary" />
            Leads Novos
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Data</Label>
              <div className="relative">
                <CalendarDays size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input type="date" value={dataLeads} onChange={(e) => setDataLeads(e.target.value)} className="bg-secondary border-border pl-10" required />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Clínica</Label>
              <Select value={clinicaIdLeads} onValueChange={(v) => { setClinicaIdLeads(v); setLeadsNovos(""); }}>
                <SelectTrigger className="bg-secondary border-border"><SelectValue placeholder="Selecione a clínica" /></SelectTrigger>
                <SelectContent>
                  {clinicas.map((c) => (<SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {existingIdLeads && (
            <div className="rounded-lg bg-primary/10 p-3 text-sm text-primary">
              ⚠️ Já existe registro para esta data/clínica. O valor será atualizado.
            </div>
          )}

          <div className="space-y-2">
            <Label>Quantidade de Leads Novos</Label>
            <Input type="number" min="0" step="1" placeholder="0" value={leadsNovos} onChange={(e) => setLeadsNovos(e.target.value)} className="bg-secondary border-border" />
            {erroLeadsNovos && (
              <p className="text-sm text-destructive flex items-center gap-1.5" role="alert">
                <AlertCircle size={14} /> {erroLeadsNovos}
              </p>
            )}
          </div>

          <Button onClick={handleSaveLeads} disabled={savingLeads} className="w-full gradient-orange text-primary-foreground font-semibold shadow-orange hover:opacity-90 transition-opacity">
            <Save size={18} className="mr-2" />
            {savingLeads ? "Salvando..." : "Salvar Leads Novos"}
          </Button>
        </CardContent>
      </Card>

      {/* CARD 2: Agendados + Reagendados */}
      <Card className="gradient-card border-border shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp size={18} className="text-primary" />
            Agendados do Dia + Reagendados
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Data</Label>
              <div className="relative">
                <CalendarDays size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input type="date" value={dataAgendados} onChange={(e) => setDataAgendados(e.target.value)} className="bg-secondary border-border pl-10" required />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Clínica</Label>
              <Select value={clinicaIdAgendados} onValueChange={setClinicaIdAgendados}>
                <SelectTrigger className="bg-secondary border-border"><SelectValue placeholder="Selecione a clínica" /></SelectTrigger>
                <SelectContent>
                  {clinicas.map((c) => (<SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {existingIdAgendados && (
            <div className="rounded-lg bg-primary/10 p-3 text-sm text-primary">
              ⚠️ Já existe registro para esta data/clínica. Os dados serão atualizados.
            </div>
          )}

          {/* BLOCO AGENDADOS */}
          <div className="space-y-4">
            <div>
              <p className="text-sm font-semibold text-foreground">📅 Agendados do Dia</p>
              <p className="text-xs text-muted-foreground">Pacientes que estavam agendados para comparecer hoje</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Agendados</Label>
                <p className="text-xs text-muted-foreground">Total agendado para o dia</p>
                <Input type="number" min="0" step="1" placeholder="0" value={agendaram} onChange={(e) => setAgendaram(e.target.value)} className="bg-secondary border-border" />
              </div>
              <div className="space-y-2">
                <Label>Compareceram</Label>
                <p className="text-xs text-muted-foreground">Quantos vieram à consulta</p>
                <Input type="number" min="0" step="1" placeholder="0" value={compareceram} onChange={(e) => setCompareceram(e.target.value)} className="bg-secondary border-border" />
              </div>
              <div className="space-y-2">
                <Label>Contrataram</Label>
                <p className="text-xs text-muted-foreground">Dos que compareceram, quantos fecharam</p>
                <Input type="number" min="0" step="1" placeholder="0" value={contrataram} onChange={(e) => setContrataram(e.target.value)} className="bg-secondary border-border" />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-center justify-between rounded-lg bg-destructive/10 p-3">
                <span className="text-sm text-muted-foreground">Faltaram</span>
                <span className="text-lg font-bold text-destructive">{faltaram ?? "—"}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-muted p-3">
                <span className="text-sm text-muted-foreground">Não Contrataram</span>
                <span className={`text-lg font-bold ${naoContrataram !== null && naoContrataram < 0 ? "text-destructive" : "text-muted-foreground"}`}>{naoContrataram ?? "—"}</span>
              </div>
            </div>
          </div>

          {/* BLOCO REAGENDADOS */}
          <div className="border-t border-border pt-4 space-y-4">
            <div>
              <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                <RefreshCw size={16} className="text-primary" />
                Reagendados
              </p>
              <p className="text-xs text-muted-foreground">Pacientes que faltaram anteriormente e foram reagendados para hoje</p>
              <p className="text-xs text-primary/80 mt-1">💡 Reagendados são descontados das faltas. Se faltarem novamente, voltam ao total de faltas.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Reagendados</Label>
                <p className="text-xs text-muted-foreground">Total reagendado para o dia</p>
                <Input type="number" min="0" step="1" placeholder="0" value={remarcados} onChange={(e) => setRemarcados(e.target.value)} className="bg-secondary border-border" />
              </div>
              <div className="space-y-2">
                <Label>Compareceram</Label>
                <p className="text-xs text-muted-foreground">Reagendados que vieram</p>
                <Input type="number" min="0" step="1" placeholder="0" value={reagendadosCompareceram} onChange={(e) => setReagendadosCompareceram(e.target.value)} className="bg-secondary border-border" />
              </div>
              <div className="space-y-2">
                <Label>Contrataram</Label>
                <p className="text-xs text-muted-foreground">Reagendados que fecharam</p>
                <Input type="number" min="0" step="1" placeholder="0" value={reagendadosContrataram} onChange={(e) => setReagendadosContrataram(e.target.value)} className="bg-secondary border-border" />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-center justify-between rounded-lg bg-destructive/10 p-3">
                <span className="text-sm text-muted-foreground">Faltaram (reagendados)</span>
                <span className="text-lg font-bold text-destructive">{reagendadosFaltaram ?? "—"}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-muted p-3">
                <span className="text-sm text-muted-foreground">Não Contrataram (reagendados)</span>
                <span className={`text-lg font-bold ${reagendadosNaoContrataram !== null && reagendadosNaoContrataram < 0 ? "text-destructive" : "text-muted-foreground"}`}>{reagendadosNaoContrataram ?? "—"}</span>
              </div>
            </div>
          </div>

          {/* Resumo de faltas líquidas */}
          <div className="border-t border-border pt-4">
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <p className="text-sm font-semibold text-foreground mb-2">📊 Resumo de Faltas</p>
              <div className="grid gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Faltas brutas (agendados)</span>
                  <span className="font-medium">{faltaram ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">− Reagendados (recuperados)</span>
                  <span className="font-medium text-primary">{cRemarcados.valor !== null ? `-${cRemarcados.valor}` : "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">+ Faltaram no reagendamento</span>
                  <span className="font-medium text-destructive">{reagendadosFaltaram !== null ? `+${reagendadosFaltaram}` : "—"}</span>
                </div>
                <div className="flex justify-between border-t border-border pt-2">
                  <span className="font-semibold">Total de faltas líquidas</span>
                  <span className="text-lg font-bold text-destructive">{faltasLiquidas ?? "—"}</span>
                </div>
              </div>
            </div>
          </div>

          {errosVisiveisAgendados.length > 0 && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 space-y-1" role="alert">
              <p className="text-sm font-semibold text-destructive flex items-center gap-1.5">
                <AlertCircle size={14} /> Corrija antes de salvar:
              </p>
              <ul className="list-disc pl-5 text-sm text-destructive space-y-0.5">
                {errosVisiveisAgendados.map((erro) => (<li key={erro}>{erro}</li>))}
              </ul>
            </div>
          )}

          <Button onClick={handleSaveAgendados} disabled={savingAgendados} className="w-full gradient-orange text-primary-foreground font-semibold shadow-orange hover:opacity-90 transition-opacity">
            <Save size={18} className="mr-2" />
            {savingAgendados ? "Salvando..." : existingIdAgendados ? "Atualizar Agendados" : "Salvar Agendados"}
          </Button>
        </CardContent>
      </Card>

      {/* Histórico */}
      <Card className="gradient-card border-border shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <List size={18} className="text-primary" />
            Registros Cadastrados
          </CardTitle>
        </CardHeader>
        <CardContent>
          {registros.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Nenhum registro encontrado.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Clínica</TableHead>
                    <TableHead className="text-center">Leads</TableHead>
                    <TableHead className="text-center">Agend.</TableHead>
                    <TableHead className="text-center">Comp.</TableHead>
                    <TableHead className="text-center">Contr.</TableHead>
                    <TableHead className="text-center">Falt.</TableHead>
                    <TableHead className="text-center">Reag.</TableHead>
                    <TableHead className="text-center">R.Comp.</TableHead>
                    <TableHead className="text-center">R.Contr.</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {registros.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{format(new Date(r.data + "T00:00:00"), "dd/MM/yyyy")}</TableCell>
                      <TableCell>{getClinicaNome(r)}</TableCell>
                      <TableCell className="text-center">{r.leads_novos}</TableCell>
                      <TableCell className="text-center">{r.agendaram}</TableCell>
                      <TableCell className="text-center">{r.compareceram}</TableCell>
                      <TableCell className="text-center">{r.contrataram}</TableCell>
                      <TableCell className="text-center">{r.faltaram}</TableCell>
                      <TableCell className="text-center">{r.remarcados}</TableCell>
                      <TableCell className="text-center">{(r as any).reagendados_compareceram ?? 0}</TableCell>
                      <TableCell className="text-center">{(r as any).reagendados_contrataram ?? 0}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => handleEdit(r)} title="Editar">
                            <Pencil size={16} className="text-primary" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" title="Excluir">
                                <Trash2 size={16} className="text-destructive" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Deseja realmente excluir o registro de {format(new Date(r.data + "T00:00:00"), "dd/MM/yyyy")}? Esta ação não pode ser desfeita.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleDelete(r.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                  Excluir
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default CadastroLeads;
