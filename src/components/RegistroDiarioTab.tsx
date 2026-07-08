import { useState, useEffect, useCallback } from "react";
import { toLocalDateISO } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Save, ClipboardList, Pencil, Trash2, List, Phone, CalendarDays, PhoneCall, CalendarCheck, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Tables } from "@/integrations/supabase/types";
import { format } from "date-fns";

type RegistroRow = {
  id: string;
  data: string;
  clinica_id: string;
  leads_agendados_futuro: number;
  leads_reagendados: number;
  leads_reagendados_ligacao: number;
  total_ligacoes: number;
  ligacoes_atendidas: number;
  agendamentos_por_ligacao: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  clinicas?: { nome: string } | null;
};

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

const fmtPct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);

const RegistroDiarioTab = () => {
  const { user } = useAuth();
  const [clinicas, setClinicas] = useState<Tables<"clinicas">[]>([]);
  const [clinicaId, setClinicaId] = useState("");
  const [data, setData] = useState(() => toLocalDateISO());
  const [leadsAgendadosFuturo, setLeadsAgendadosFuturo] = useState("");
  const [leadsReagendados, setLeadsReagendados] = useState("");
  const [leadsReagendadosLigacao, setLeadsReagendadosLigacao] = useState("");
  const [totalLigacoes, setTotalLigacoes] = useState("");
  const [ligacoesAtendidas, setLigacoesAtendidas] = useState("");
  const [agendamentosPorLigacao, setAgendamentosPorLigacao] = useState("");
  const [saving, setSaving] = useState(false);
  const [tentouSalvar, setTentouSalvar] = useState(false);
  const [existingId, setExistingId] = useState<string | null>(null);
  const [registros, setRegistros] = useState<RegistroRow[]>([]);

  useEffect(() => {
    supabase.from("clinicas").select("*").eq("ativa", true).then(({ data }) => {
      if (data) setClinicas(data);
    });
  }, []);

  const fetchRegistros = useCallback(async () => {
    const { data } = await supabase
      .from("registros_diarios_atendimento")
      .select("*, clinicas(nome)")
      .order("data", { ascending: false })
      .limit(50);
    if (data) setRegistros(data as unknown as RegistroRow[]);
  }, []);

  useEffect(() => { fetchRegistros(); }, [fetchRegistros]);

  useEffect(() => {
    if (!clinicaId || !data) { setExistingId(null); return; }
    supabase
      .from("registros_diarios_atendimento")
      .select("*")
      .eq("data", data)
      .eq("clinica_id", clinicaId)
      .maybeSingle()
      .then(({ data: existing }) => {
        if (existing) {
          const r = existing as unknown as RegistroRow;
          setExistingId(r.id);
          setLeadsAgendadosFuturo(String(r.leads_agendados_futuro));
          setLeadsReagendados(String(r.leads_reagendados));
          setLeadsReagendadosLigacao(String(r.leads_reagendados_ligacao));
          setTotalLigacoes(String(r.total_ligacoes));
          setLigacoesAtendidas(String(r.ligacoes_atendidas));
          setAgendamentosPorLigacao(String(r.agendamentos_por_ligacao));
        } else {
          setExistingId(null);
          resetFields();
        }
      });
  }, [clinicaId, data]);

  const resetFields = () => {
    setLeadsAgendadosFuturo("");
    setLeadsReagendados("");
    setLeadsReagendadosLigacao("");
    setTotalLigacoes("");
    setLigacoesAtendidas("");
    setAgendamentosPorLigacao("");
    setTentouSalvar(false);
  };

  // Campos lidos (null = não preenchido; nunca coagido para 0)
  const cAgendados = lerCampo(leadsAgendadosFuturo);
  const cAgendLigacao = lerCampo(agendamentosPorLigacao);
  const cReagendados = lerCampo(leadsReagendados);
  const cReagLigacao = lerCampo(leadsReagendadosLigacao);
  const cTotalLig = lerCampo(totalLigacoes);
  const cAtendidas = lerCampo(ligacoesAtendidas);

  const camposForm: { rotulo: string; campo: CampoNum }[] = [
    { rotulo: "Total de leads agendados (datas futuras)", campo: cAgendados },
    { rotulo: "Agendamentos por ligação", campo: cAgendLigacao },
    { rotulo: "Total de leads reagendados", campo: cReagendados },
    { rotulo: "Reagendamentos por ligação", campo: cReagLigacao },
    { rotulo: "Total de ligações realizadas", campo: cTotalLig },
    { rotulo: "Ligações atendidas", campo: cAtendidas },
  ];

  // Derivados SEM clamp: valor impossível aparece como está e gera erro visível,
  // em vez de ser "consertado" silenciosamente (Math.max/Math.min mascaravam o problema).
  const agendEspontaneos = cAgendados.valor !== null && cAgendLigacao.valor !== null
    ? cAgendados.valor - cAgendLigacao.valor : null;
  const reagEspontaneos = cReagendados.valor !== null && cReagLigacao.valor !== null
    ? cReagendados.valor - cReagLigacao.valor : null;

  // Taxa de atendimento de ligações (sem clamp; >100% indica lançamento errado)
  const taxaAtendimento = cTotalLig.valor !== null && cTotalLig.valor > 0 && cAtendidas.valor !== null
    ? (cAtendidas.valor / cTotalLig.valor) * 100 : null;

  // Taxa de conversão sobre ligações atendidas
  const totalConvertidosLigacao = cAgendLigacao.valor !== null && cReagLigacao.valor !== null
    ? cAgendLigacao.valor + cReagLigacao.valor : null;
  const taxaConversaoAtendidas = cAtendidas.valor !== null && cAtendidas.valor > 0 && totalConvertidosLigacao !== null
    ? (totalConvertidosLigacao / cAtendidas.valor) * 100 : null;

  // Taxa de agendamento por ligação atendida
  const taxaAgendLigacao = cAtendidas.valor !== null && cAtendidas.valor > 0 && cAgendLigacao.valor !== null
    ? (cAgendLigacao.valor / cAtendidas.valor) * 100 : null;

  // Taxa de reagendamento por ligação atendida
  const taxaReagLigacao = cAtendidas.valor !== null && cAtendidas.valor > 0 && cReagLigacao.valor !== null
    ? (cReagLigacao.valor / cAtendidas.valor) * 100 : null;

  // Erros de valor inválido (não inteiro ou negativo)
  const errosInvalidos = camposForm
    .filter(({ campo }) => campo.invalido)
    .map(({ rotulo }) => `${rotulo}: valor inválido — use um número inteiro maior ou igual a 0.`);

  // Erros de consistência entre campos já preenchidos (avaliados ao vivo)
  const errosConsistencia: string[] = [];
  if (cAtendidas.valor !== null && cTotalLig.valor !== null && cAtendidas.valor > cTotalLig.valor)
    errosConsistencia.push(`Ligações atendidas (${cAtendidas.valor}) não podem exceder o total de ligações realizadas (${cTotalLig.valor}).`);
  if (cAgendLigacao.valor !== null && cAgendados.valor !== null && cAgendLigacao.valor > cAgendados.valor)
    errosConsistencia.push(`Agendamentos por ligação (${cAgendLigacao.valor}) não podem exceder o total de leads agendados (${cAgendados.valor}).`);
  if (cReagLigacao.valor !== null && cReagendados.valor !== null && cReagLigacao.valor > cReagendados.valor)
    errosConsistencia.push(`Reagendamentos por ligação (${cReagLigacao.valor}) não podem exceder o total de leads reagendados (${cReagendados.valor}).`);
  if (totalConvertidosLigacao !== null && cAtendidas.valor !== null && totalConvertidosLigacao > cAtendidas.valor)
    errosConsistencia.push(`Agendamentos + reagendamentos por ligação (${totalConvertidosLigacao}) não podem exceder as ligações atendidas (${cAtendidas.valor}).`);

  // Campo vazio ("não preenchido") é diferente de 0: o zero precisa ser digitado.
  // Esses erros só ficam visíveis depois de uma tentativa de salvar.
  const errosVazios = camposForm
    .filter(({ campo }) => !campo.invalido && campo.valor === null)
    .map(({ rotulo }) => `${rotulo}: não preenchido. Digite 0 se o valor real for zero.`);

  const errosVisiveis = [...errosInvalidos, ...errosConsistencia, ...(tentouSalvar ? errosVazios : [])];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTentouSalvar(true);
    if (!data) { toast.error("Informe a data do registro."); return; }
    if (!clinicaId) { toast.error("Selecione uma clínica."); return; }
    if (errosInvalidos.length > 0 || errosConsistencia.length > 0 || errosVazios.length > 0) {
      toast.error("Não foi possível salvar: corrija os campos indicados no formulário.");
      return;
    }
    const vAgendados = cAgendados.valor;
    const vAgendLigacao = cAgendLigacao.valor;
    const vReagendados = cReagendados.valor;
    const vReagLigacao = cReagLigacao.valor;
    const vTotalLig = cTotalLig.valor;
    const vAtendidas = cAtendidas.valor;
    if (vAgendados === null || vAgendLigacao === null || vReagendados === null || vReagLigacao === null || vTotalLig === null || vAtendidas === null) {
      // Inalcançável: campos vazios já foram bloqueados acima (errosVazios).
      return;
    }
    setSaving(true);
    try {
      const payload = {
        data,
        clinica_id: clinicaId,
        leads_agendados_futuro: vAgendados,
        leads_reagendados: vReagendados,
        leads_reagendados_ligacao: vReagLigacao,
        total_ligacoes: vTotalLig,
        ligacoes_atendidas: vAtendidas,
        agendamentos_por_ligacao: vAgendLigacao,
        created_by: user?.id,
      };

      // Gravação idempotente: a tabela tem UNIQUE(data, clinica_id).
      // Evita erro de constraint em corrida ou quando o "existingId" carregado está desatualizado.
      const { data: upserted, error } = await supabase
        .from("registros_diarios_atendimento")
        .upsert(payload, { onConflict: "data,clinica_id" })
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (upserted?.id) setExistingId(upserted.id);
      toast.success(existingId ? "Registro atualizado!" : "Registro salvo!");
      setTentouSalvar(false);
      fetchRegistros();
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (r: RegistroRow) => {
    setClinicaId(r.clinica_id);
    setData(r.data);
    setExistingId(r.id);
    setLeadsAgendadosFuturo(String(r.leads_agendados_futuro));
    setLeadsReagendados(String(r.leads_reagendados));
    setLeadsReagendadosLigacao(String(r.leads_reagendados_ligacao));
    setTotalLigacoes(String(r.total_ligacoes));
    setLigacoesAtendidas(String(r.ligacoes_atendidas));
    setAgendamentosPorLigacao(String(r.agendamentos_por_ligacao));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase.from("registros_diarios_atendimento").delete().eq("id", id);
      if (error) throw error;
      toast.success("Registro excluído!");
      if (existingId === id) {
        setExistingId(null);
        resetFields();
        setClinicaId("");
        setData(toLocalDateISO());
      }
      fetchRegistros();
    } catch (err: any) {
      toast.error("Erro ao excluir: " + err.message);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="gradient-card border-border shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardList size={18} className="text-primary" />
            Registro Diário de Atendimento
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Data</Label>
                <div className="relative">
                  <CalendarDays size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input type="date" value={data} onChange={(e) => setData(e.target.value)} className="bg-secondary border-border pl-10" required />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Clínica</Label>
                <Select value={clinicaId} onValueChange={setClinicaId}>
                  <SelectTrigger className="bg-secondary border-border"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {clinicas.map((c) => (<SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {existingId && (
              <div className="rounded-lg bg-primary/10 p-3 text-sm text-primary">
                ⚠️ Já existe registro para esta data/clínica. Os dados serão atualizados.
              </div>
            )}

            {/* Agendamentos */}
            <div className="border-t border-border pt-4 space-y-4">
              <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                <CalendarCheck size={16} className="text-primary" />
                Agendamentos
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Total de leads agendados (datas futuras)</Label>
                  <p className="text-xs text-muted-foreground">Total de agendamentos feitos hoje para datas futuras (inclui os por ligação)</p>
                  <Input type="number" min="0" step="1" placeholder="0" value={leadsAgendadosFuturo} onChange={(e) => setLeadsAgendadosFuturo(e.target.value)} className="bg-secondary border-border" />
                </div>
                <div className="space-y-2">
                  <Label>Desses, quantos por ligação?</Label>
                  <p className="text-xs text-muted-foreground">Dos {cAgendados.valor ?? "—"} agendados, quantos foram via ligação</p>
                  <Input type="number" min="0" step="1" placeholder="0" value={agendamentosPorLigacao} onChange={(e) => setAgendamentosPorLigacao(e.target.value)} className="bg-secondary border-border" />
                </div>
              </div>
              {cAgendados.valor !== null && cAgendados.valor > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex items-center justify-between rounded-lg bg-primary/10 p-3">
                    <span className="text-sm text-muted-foreground">📞 Por ligação</span>
                    <span className="text-lg font-bold text-primary">{cAgendLigacao.valor ?? "—"}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-muted p-3">
                    <span className="text-sm text-muted-foreground">📋 Espontâneos / outros canais</span>
                    <span className={`text-lg font-bold ${agendEspontaneos !== null && agendEspontaneos < 0 ? "text-destructive" : "text-foreground"}`}>{agendEspontaneos ?? "—"}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Reagendamentos */}
            <div className="border-t border-border pt-4 space-y-4">
              <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                <CalendarCheck size={16} className="text-primary" />
                Reagendamentos
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Total de leads reagendados</Label>
                  <p className="text-xs text-muted-foreground">Total de reagendamentos realizados no dia (inclui os por ligação)</p>
                  <Input type="number" min="0" step="1" placeholder="0" value={leadsReagendados} onChange={(e) => setLeadsReagendados(e.target.value)} className="bg-secondary border-border" />
                </div>
                <div className="space-y-2">
                  <Label>Desses, quantos por ligação?</Label>
                  <p className="text-xs text-muted-foreground">Dos {cReagendados.valor ?? "—"} reagendados, quantos foram via ligação</p>
                  <Input type="number" min="0" step="1" placeholder="0" value={leadsReagendadosLigacao} onChange={(e) => setLeadsReagendadosLigacao(e.target.value)} className="bg-secondary border-border" />
                </div>
              </div>
              {cReagendados.valor !== null && cReagendados.valor > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex items-center justify-between rounded-lg bg-primary/10 p-3">
                    <span className="text-sm text-muted-foreground">📞 Por ligação</span>
                    <span className="text-lg font-bold text-primary">{cReagLigacao.valor ?? "—"}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-muted p-3">
                    <span className="text-sm text-muted-foreground">📋 Espontâneos / outros canais</span>
                    <span className={`text-lg font-bold ${reagEspontaneos !== null && reagEspontaneos < 0 ? "text-destructive" : "text-foreground"}`}>{reagEspontaneos ?? "—"}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Ligações */}
            <div className="border-t border-border pt-4 space-y-4">
              <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Phone size={16} className="text-primary" />
                Ligações
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Total de ligações realizadas</Label>
                  <Input type="number" min="0" step="1" placeholder="0" value={totalLigacoes} onChange={(e) => setTotalLigacoes(e.target.value)} className="bg-secondary border-border" />
                </div>
                <div className="space-y-2">
                  <Label>Ligações atendidas</Label>
                  <Input type="number" min="0" step="1" placeholder="0" value={ligacoesAtendidas} onChange={(e) => setLigacoesAtendidas(e.target.value)} className="bg-secondary border-border" />
                </div>
              </div>
            </div>

            {/* Indicadores */}
            <div className="border-t border-border pt-4 space-y-4">
              <p className="text-sm font-semibold text-foreground">📊 Indicadores</p>

              {/* Taxa de atendimento */}
              <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ligações</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex items-center justify-between rounded-lg bg-primary/10 p-3">
                    <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                      <PhoneCall size={14} /> Taxa de Atendimento
                    </span>
                    <span className={`text-lg font-bold ${taxaAtendimento !== null && taxaAtendimento > 100 ? "text-destructive" : "text-primary"}`}>{fmtPct(taxaAtendimento)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center">
                    {cAtendidas.valor ?? "—"} atendidas de {cTotalLig.valor ?? "—"} ligações
                  </div>
                </div>
              </div>

              {/* Conversão das ligações atendidas */}
              <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Conversão das {cAtendidas.valor ?? "—"} ligações atendidas
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="flex flex-col items-center rounded-lg bg-primary/10 p-3">
                    <span className="text-xs text-muted-foreground">Agendaram</span>
                    <span className="text-xl font-bold text-primary">{cAgendLigacao.valor ?? "—"}</span>
                    <span className="text-xs text-muted-foreground">{fmtPct(taxaAgendLigacao)}</span>
                  </div>
                  <div className="flex flex-col items-center rounded-lg bg-primary/10 p-3">
                    <span className="text-xs text-muted-foreground">Reagendaram</span>
                    <span className="text-xl font-bold text-primary">{cReagLigacao.valor ?? "—"}</span>
                    <span className="text-xs text-muted-foreground">{fmtPct(taxaReagLigacao)}</span>
                  </div>
                  <div className="flex flex-col items-center rounded-lg bg-secondary p-3">
                    <span className="text-xs text-muted-foreground">Total convertidos</span>
                    <span className="text-xl font-bold text-primary">{totalConvertidosLigacao ?? "—"}</span>
                    <span className={`text-xs ${taxaConversaoAtendidas !== null && taxaConversaoAtendidas > 100 ? "text-destructive font-semibold" : "text-muted-foreground"}`}>{fmtPct(taxaConversaoAtendidas)}</span>
                  </div>
                </div>
              </div>
            </div>

            {errosVisiveis.length > 0 && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 space-y-1" role="alert">
                <p className="text-sm font-semibold text-destructive flex items-center gap-1.5">
                  <AlertCircle size={14} /> Corrija antes de salvar:
                </p>
                <ul className="list-disc pl-5 text-sm text-destructive space-y-0.5">
                  {errosVisiveis.map((erro) => (<li key={erro}>{erro}</li>))}
                </ul>
              </div>
            )}

            <Button type="submit" disabled={saving} className="w-full gradient-orange text-primary-foreground font-semibold shadow-orange hover:opacity-90 transition-opacity">
              <Save size={18} className="mr-2" />
              {saving ? "Salvando..." : existingId ? "Atualizar Registro" : "Salvar Registro"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Histórico */}
      <Card className="gradient-card border-border shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <List size={18} className="text-primary" />
            Histórico de Registros
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
                    <TableHead className="text-center">Agend.</TableHead>
                    <TableHead className="text-center">Ag. Lig.</TableHead>
                    <TableHead className="text-center">Reag.</TableHead>
                    <TableHead className="text-center">Re. Lig.</TableHead>
                    <TableHead className="text-center">Ligações</TableHead>
                    <TableHead className="text-center">Atend.</TableHead>
                    <TableHead className="text-center">Conv. %</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {registros.map((r) => {
                    const totalConv = r.agendamentos_por_ligacao + r.leads_reagendados_ligacao;
                    // Sem clamp: percentual real, mesmo acima de 100% (dado gravado inconsistente
                    // fica visível em vermelho em vez de ser mascarado).
                    const convInconsistente = totalConv > r.ligacoes_atendidas;
                    const conv = r.ligacoes_atendidas > 0
                      ? `${((totalConv / r.ligacoes_atendidas) * 100).toFixed(1)}%`
                      : totalConv > 0 ? "—" : "0.0%";
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{format(new Date(r.data + "T00:00:00"), "dd/MM/yyyy")}</TableCell>
                        <TableCell>{r.clinicas?.nome || "—"}</TableCell>
                        <TableCell className="text-center">{r.leads_agendados_futuro}</TableCell>
                        <TableCell className="text-center text-primary font-medium">{r.agendamentos_por_ligacao}</TableCell>
                        <TableCell className="text-center">{r.leads_reagendados}</TableCell>
                        <TableCell className="text-center text-primary font-medium">{r.leads_reagendados_ligacao}</TableCell>
                        <TableCell className="text-center">{r.total_ligacoes}</TableCell>
                        <TableCell className="text-center">{r.ligacoes_atendidas}</TableCell>
                        <TableCell
                          className={`text-center font-medium ${convInconsistente ? "text-destructive" : "text-primary"}`}
                          title={convInconsistente ? "Dado inconsistente: convertidos por ligação excedem as ligações atendidas deste registro" : undefined}
                        >
                          {conv}
                        </TableCell>
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
                                    Deseja realmente excluir o registro de {format(new Date(r.data + "T00:00:00"), "dd/MM/yyyy")}?
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
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default RegistroDiarioTab;
