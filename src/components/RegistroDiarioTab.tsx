import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Save, ClipboardList, Pencil, Trash2, List, Phone, CalendarDays, PhoneCall, CalendarCheck } from "lucide-react";
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

const RegistroDiarioTab = () => {
  const { user } = useAuth();
  const [clinicas, setClinicas] = useState<Tables<"clinicas">[]>([]);
  const [clinicaId, setClinicaId] = useState("");
  const [data, setData] = useState(() => new Date().toISOString().split("T")[0]);
  const [leadsAgendadosFuturo, setLeadsAgendadosFuturo] = useState("");
  const [leadsReagendados, setLeadsReagendados] = useState("");
  const [leadsReagendadosLigacao, setLeadsReagendadosLigacao] = useState("");
  const [totalLigacoes, setTotalLigacoes] = useState("");
  const [ligacoesAtendidas, setLigacoesAtendidas] = useState("");
  const [agendamentosPorLigacao, setAgendamentosPorLigacao] = useState("");
  const [saving, setSaving] = useState(false);
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
  };

  const taxaConversaoLigacao = (() => {
    const total = parseInt(totalLigacoes) || 0;
    const agend = parseInt(agendamentosPorLigacao) || 0;
    if (total === 0) return 0;
    return ((agend / total) * 100);
  })();

  const taxaAtendimento = (() => {
    const total = parseInt(totalLigacoes) || 0;
    const atend = parseInt(ligacoesAtendidas) || 0;
    if (total === 0) return 0;
    return ((atend / total) * 100);
  })();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clinicaId) { toast.error("Selecione uma clínica."); return; }
    setSaving(true);
    try {
      const payload = {
        data,
        clinica_id: clinicaId,
        leads_agendados_futuro: parseInt(leadsAgendadosFuturo) || 0,
        leads_reagendados: parseInt(leadsReagendados) || 0,
        leads_reagendados_ligacao: parseInt(leadsReagendadosLigacao) || 0,
        total_ligacoes: parseInt(totalLigacoes) || 0,
        ligacoes_atendidas: parseInt(ligacoesAtendidas) || 0,
        agendamentos_por_ligacao: parseInt(agendamentosPorLigacao) || 0,
        created_by: user?.id,
      };

      if (existingId) {
        const { error } = await supabase.from("registros_diarios_atendimento").update(payload).eq("id", existingId);
        if (error) throw error;
        toast.success("Registro atualizado!");
      } else {
        const { error } = await supabase.from("registros_diarios_atendimento").insert(payload);
        if (error) throw error;
        toast.success("Registro salvo!");
      }
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
        setData(new Date().toISOString().split("T")[0]);
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

            {/* Agendamentos */}
            <div className="border-t border-border pt-4 space-y-4">
              <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                <CalendarCheck size={16} className="text-primary" />
                Agendamentos
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Leads agendados (datas futuras)</Label>
                  <p className="text-xs text-muted-foreground">Agendamentos feitos hoje para datas futuras</p>
                  <Input type="number" min="0" placeholder="0" value={leadsAgendadosFuturo} onChange={(e) => setLeadsAgendadosFuturo(e.target.value)} className="bg-secondary border-border" required />
                </div>
                <div className="space-y-2">
                  <Label>Leads reagendados</Label>
                  <p className="text-xs text-muted-foreground">Reagendamentos realizados no dia</p>
                  <Input type="number" min="0" placeholder="0" value={leadsReagendados} onChange={(e) => setLeadsReagendados(e.target.value)} className="bg-secondary border-border" required />
                </div>
              </div>
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
                  <Input type="number" min="0" placeholder="0" value={totalLigacoes} onChange={(e) => setTotalLigacoes(e.target.value)} className="bg-secondary border-border" required />
                </div>
                <div className="space-y-2">
                  <Label>Ligações atendidas</Label>
                  <Input type="number" min="0" placeholder="0" value={ligacoesAtendidas} onChange={(e) => setLigacoesAtendidas(e.target.value)} className="bg-secondary border-border" required />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Reagendados por ligação</Label>
                  <p className="text-xs text-muted-foreground">Leads reagendados via ligação</p>
                  <Input type="number" min="0" placeholder="0" value={leadsReagendadosLigacao} onChange={(e) => setLeadsReagendadosLigacao(e.target.value)} className="bg-secondary border-border" required />
                </div>
                <div className="space-y-2">
                  <Label>Agendamentos por ligação</Label>
                  <p className="text-xs text-muted-foreground">Novos agendamentos via ligação</p>
                  <Input type="number" min="0" placeholder="0" value={agendamentosPorLigacao} onChange={(e) => setAgendamentosPorLigacao(e.target.value)} className="bg-secondary border-border" required />
                </div>
              </div>
            </div>

            {/* Indicadores */}
            <div className="border-t border-border pt-4 space-y-3">
              <p className="text-sm font-semibold text-foreground">📊 Indicadores</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex items-center justify-between rounded-lg bg-primary/10 p-3">
                  <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                    <PhoneCall size={14} /> Taxa de Atendimento
                  </span>
                  <span className="text-lg font-bold text-primary">{taxaAtendimento.toFixed(1)}%</span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-primary/10 p-3">
                  <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                    <CalendarCheck size={14} /> Conversão Ligação → Agend.
                  </span>
                  <span className="text-lg font-bold text-primary">{taxaConversaoLigacao.toFixed(1)}%</span>
                </div>
              </div>
            </div>

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
                    <TableHead className="text-center">Agend. Futuro</TableHead>
                    <TableHead className="text-center">Reagend.</TableHead>
                    <TableHead className="text-center">Ligações</TableHead>
                    <TableHead className="text-center">Atendidas</TableHead>
                    <TableHead className="text-center">Reag. Lig.</TableHead>
                    <TableHead className="text-center">Agend. Lig.</TableHead>
                    <TableHead className="text-center">Conv. %</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {registros.map((r) => {
                    const conv = r.total_ligacoes > 0 ? ((r.agendamentos_por_ligacao / r.total_ligacoes) * 100).toFixed(1) : "0.0";
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{format(new Date(r.data + "T00:00:00"), "dd/MM/yyyy")}</TableCell>
                        <TableCell>{r.clinicas?.nome || "—"}</TableCell>
                        <TableCell className="text-center">{r.leads_agendados_futuro}</TableCell>
                        <TableCell className="text-center">{r.leads_reagendados}</TableCell>
                        <TableCell className="text-center">{r.total_ligacoes}</TableCell>
                        <TableCell className="text-center">{r.ligacoes_atendidas}</TableCell>
                        <TableCell className="text-center">{r.leads_reagendados_ligacao}</TableCell>
                        <TableCell className="text-center">{r.agendamentos_por_ligacao}</TableCell>
                        <TableCell className="text-center font-medium text-primary">{conv}%</TableCell>
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
