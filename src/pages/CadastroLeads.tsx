import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Save, TrendingUp, CalendarDays, Pencil, Trash2, List, RefreshCw, ClipboardList } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Tables } from "@/integrations/supabase/types";
import { format } from "date-fns";
import RegistroDiarioTab from "@/components/RegistroDiarioTab";

type LeadWithClinica = Tables<"leads_diarios"> & { clinicas?: { nome: string } | null };

const CadastroLeads = () => {
  const { user } = useAuth();
  const [clinicas, setClinicas] = useState<Tables<"clinicas">[]>([]);
  const [clinicaId, setClinicaId] = useState("");
  const [data, setData] = useState(() => new Date().toISOString().split("T")[0]);
  const [leadsNovos, setLeadsNovos] = useState("");
  const [agendaram, setAgendaram] = useState("");
  const [compareceram, setCompareceram] = useState("");
  const [contrataram, setContrataram] = useState("");
  const [remarcados, setRemarcados] = useState("");
  const [reagendadosCompareceram, setReagendadosCompareceram] = useState("");
  const [reagendadosContrataram, setReagendadosContrataram] = useState("");
  const [saving, setSaving] = useState(false);
  const [existingId, setExistingId] = useState<string | null>(null);
  const [registros, setRegistros] = useState<LeadWithClinica[]>([]);

  // Calculated fields - Agendados
  const faltaram = useMemo(() => {
    const a = parseInt(agendaram) || 0;
    const c = parseInt(compareceram) || 0;
    return Math.max(a - c, 0);
  }, [agendaram, compareceram]);

  const naoContrataram = useMemo(() => {
    const c = parseInt(compareceram) || 0;
    const ct = parseInt(contrataram) || 0;
    return Math.max(c - ct, 0);
  }, [compareceram, contrataram]);

  // Calculated fields - Reagendados
  const reagendadosFaltaram = useMemo(() => {
    const r = parseInt(remarcados) || 0;
    const rc = parseInt(reagendadosCompareceram) || 0;
    return Math.max(r - rc, 0);
  }, [remarcados, reagendadosCompareceram]);

  const reagendadosNaoContrataram = useMemo(() => {
    const rc = parseInt(reagendadosCompareceram) || 0;
    const rct = parseInt(reagendadosContrataram) || 0;
    return Math.max(rc - rct, 0);
  }, [reagendadosCompareceram, reagendadosContrataram]);

  // Faltas líquidas = faltas brutas dos agendados - reagendados + faltas dos reagendados
  const faltasLiquidas = useMemo(() => {
    const fBruto = faltaram;
    const r = parseInt(remarcados) || 0;
    const rFaltaram = reagendadosFaltaram;
    return Math.max(fBruto - r + rFaltaram, 0);
  }, [faltaram, remarcados, reagendadosFaltaram]);

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

  useEffect(() => {
    fetchRegistros();
  }, [fetchRegistros]);

  useEffect(() => {
    if (!clinicaId || !data) { setExistingId(null); return; }
    supabase
      .from("leads_diarios")
      .select("*")
      .eq("data", data)
      .eq("clinica_id", clinicaId)
      .maybeSingle()
      .then(({ data: existing }) => {
        if (existing) {
          setExistingId(existing.id);
          setLeadsNovos(String(existing.leads_novos));
          setAgendaram(String(existing.agendaram));
          setCompareceram(String(existing.compareceram));
          setContrataram(String(existing.contrataram));
          setRemarcados(String(existing.remarcados));
          setReagendadosCompareceram(String((existing as any).reagendados_compareceram || 0));
          setReagendadosContrataram(String((existing as any).reagendados_contrataram || 0));
        } else {
          setExistingId(null);
          resetFields();
        }
      });
  }, [clinicaId, data]);

  const resetFields = () => {
    setLeadsNovos(""); setAgendaram(""); setCompareceram("");
    setContrataram(""); setRemarcados("");
    setReagendadosCompareceram(""); setReagendadosContrataram("");
  };

  const resetForm = () => {
    setExistingId(null);
    resetFields();
    setClinicaId("");
    setData(new Date().toISOString().split("T")[0]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clinicaId) { toast.error("Selecione uma clínica."); return; }
    setSaving(true);
    try {
      const payload = {
        data,
        clinica_id: clinicaId,
        leads_novos: parseInt(leadsNovos) || 0,
        agendaram: parseInt(agendaram) || 0,
        compareceram: parseInt(compareceram) || 0,
        contrataram: parseInt(contrataram) || 0,
        faltaram,
        nao_contrataram: naoContrataram,
        remarcados: parseInt(remarcados) || 0,
        reagendados_compareceram: parseInt(reagendadosCompareceram) || 0,
        reagendados_contrataram: parseInt(reagendadosContrataram) || 0,
        created_by: user?.id,
      };

      if (existingId) {
        const { error } = await supabase.from("leads_diarios").update(payload).eq("id", existingId);
        if (error) throw error;
        toast.success("Dados atualizados!");
      } else {
        const { error } = await supabase.from("leads_diarios").insert(payload);
        if (error) throw error;
        toast.success("Dados cadastrados!");
      }
      fetchRegistros();
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (registro: LeadWithClinica) => {
    setClinicaId(registro.clinica_id);
    setData(registro.data);
    setExistingId(registro.id);
    setLeadsNovos(String(registro.leads_novos));
    setAgendaram(String(registro.agendaram));
    setCompareceram(String(registro.compareceram));
    setContrataram(String(registro.contrataram));
    setRemarcados(String(registro.remarcados));
    setReagendadosCompareceram(String((registro as any).reagendados_compareceram || 0));
    setReagendadosContrataram(String((registro as any).reagendados_contrataram || 0));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase.from("leads_diarios").delete().eq("id", id);
      if (error) throw error;
      toast.success("Registro excluído!");
      if (existingId === id) resetForm();
      fetchRegistros();
    } catch (err: any) {
      toast.error("Erro ao excluir: " + err.message);
    }
  };

  const getClinicaNome = (registro: LeadWithClinica) => registro.clinicas?.nome || "—";

  const CalcBadge = ({ label, value, color = "primary" }: { label: string; value: number; color?: string }) => (
    <div className={`flex items-center justify-between rounded-lg bg-${color}/10 p-3`}>
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-lg font-bold text-${color}`}>{value}</span>
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl animate-fade-in space-y-6">
      <div className="mb-2">
        <h1 className="text-2xl font-bold">Leads & Atendimento</h1>
        <p className="text-sm text-muted-foreground">Gerencie o funil de vendas e registros diários</p>
      </div>

      <Tabs defaultValue="leads" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="leads" className="flex items-center gap-2">
            <TrendingUp size={16} /> Cadastro de Leads
          </TabsTrigger>
          <TabsTrigger value="registro" className="flex items-center gap-2">
            <ClipboardList size={16} /> Registro Diário
          </TabsTrigger>
        </TabsList>

        <TabsContent value="leads" className="mt-4 space-y-6">

      <Card className="gradient-card border-border shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp size={18} className="text-primary" />
            Dados do Dia
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
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

            <div className="space-y-2">
              <Label>Leads Novos</Label>
              <p className="text-xs text-muted-foreground">Quantidade de leads novos que entraram no dia</p>
              <Input type="number" min="0" placeholder="0" value={leadsNovos} onChange={(e) => setLeadsNovos(e.target.value)} className="bg-secondary border-border" />
            </div>

            {/* BLOCO AGENDADOS */}
            <div className="border-t border-border pt-4 space-y-4">
              <div>
                <p className="text-sm font-semibold text-foreground">📅 Agendados do Dia</p>
                <p className="text-xs text-muted-foreground">Pacientes que estavam agendados para comparecer hoje</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>Agendados</Label>
                  <p className="text-xs text-muted-foreground">Total agendado para o dia</p>
                  <Input type="number" min="0" placeholder="0" value={agendaram} onChange={(e) => setAgendaram(e.target.value)} className="bg-secondary border-border" />
                </div>
                <div className="space-y-2">
                  <Label>Compareceram</Label>
                  <p className="text-xs text-muted-foreground">Quantos vieram à consulta</p>
                  <Input type="number" min="0" placeholder="0" value={compareceram} onChange={(e) => setCompareceram(e.target.value)} className="bg-secondary border-border" />
                </div>
                <div className="space-y-2">
                  <Label>Contrataram</Label>
                  <p className="text-xs text-muted-foreground">Dos que compareceram, quantos fecharam</p>
                  <Input type="number" min="0" placeholder="0" value={contrataram} onChange={(e) => setContrataram(e.target.value)} className="bg-secondary border-border" />
                </div>
              </div>
              {/* Calculated fields */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex items-center justify-between rounded-lg bg-destructive/10 p-3">
                  <span className="text-sm text-muted-foreground">Faltaram</span>
                  <span className="text-lg font-bold text-destructive">{faltaram}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-muted p-3">
                  <span className="text-sm text-muted-foreground">Não Contrataram</span>
                  <span className="text-lg font-bold text-muted-foreground">{naoContrataram}</span>
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
                <p className="text-xs text-primary/80 mt-1">
                  💡 Reagendados são descontados das faltas. Se faltarem novamente, voltam ao total de faltas.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>Reagendados</Label>
                  <p className="text-xs text-muted-foreground">Total reagendado para o dia</p>
                  <Input type="number" min="0" placeholder="0" value={remarcados} onChange={(e) => setRemarcados(e.target.value)} className="bg-secondary border-border" />
                </div>
                <div className="space-y-2">
                  <Label>Compareceram</Label>
                  <p className="text-xs text-muted-foreground">Reagendados que vieram</p>
                  <Input type="number" min="0" placeholder="0" value={reagendadosCompareceram} onChange={(e) => setReagendadosCompareceram(e.target.value)} className="bg-secondary border-border" />
                </div>
                <div className="space-y-2">
                  <Label>Contrataram</Label>
                  <p className="text-xs text-muted-foreground">Reagendados que fecharam</p>
                  <Input type="number" min="0" placeholder="0" value={reagendadosContrataram} onChange={(e) => setReagendadosContrataram(e.target.value)} className="bg-secondary border-border" />
                </div>
              </div>
              {/* Calculated fields */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex items-center justify-between rounded-lg bg-destructive/10 p-3">
                  <span className="text-sm text-muted-foreground">Faltaram (reagendados)</span>
                  <span className="text-lg font-bold text-destructive">{reagendadosFaltaram}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-muted p-3">
                  <span className="text-sm text-muted-foreground">Não Contrataram (reagendados)</span>
                  <span className="text-lg font-bold text-muted-foreground">{reagendadosNaoContrataram}</span>
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
                    <span className="font-medium">{faltaram}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">− Reagendados (recuperados)</span>
                    <span className="font-medium text-primary">-{parseInt(remarcados) || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">+ Faltaram no reagendamento</span>
                    <span className="font-medium text-destructive">+{reagendadosFaltaram}</span>
                  </div>
                  <div className="flex justify-between border-t border-border pt-2">
                    <span className="font-semibold">Total de faltas líquidas</span>
                    <span className="text-lg font-bold text-destructive">{faltasLiquidas}</span>
                  </div>
                </div>
              </div>
            </div>

            <Button type="submit" disabled={saving} className="w-full gradient-orange text-primary-foreground font-semibold shadow-orange hover:opacity-90 transition-opacity">
              <Save size={18} className="mr-2" />
              {saving ? "Salvando..." : existingId ? "Atualizar Dados" : "Salvar Dados"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Histórico de registros */}
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
                      <TableCell className="text-center">{(r as any).reagendados_compareceram || 0}</TableCell>
                      <TableCell className="text-center">{(r as any).reagendados_contrataram || 0}</TableCell>
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
        </TabsContent>

        <TabsContent value="registro" className="mt-4">
          <RegistroDiarioTab />
        </TabsContent>
      </Tabs>
    </div>
};

export default CadastroLeads;
