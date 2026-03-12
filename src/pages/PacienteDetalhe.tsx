import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ArrowLeft, Save, Plus, User, FileText, DollarSign, Trash2, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const origens = ["Instagram", "Google Ads", "Facebook", "Indicação", "Site", "Outros"];

const formatCurrency = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

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

interface TipoProcedimento {
  id: string;
  nome: string;
  especialidade: string | null;
  especialidade_secundaria: string | null;
  valor_referencia: number | null;
}

const PacienteDetalhe = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [paciente, setPaciente] = useState<any>(null);
  const [tratamentos, setTratamentos] = useState<any[]>([]);
  const [pagamentos, setPagamentos] = useState<any[]>([]);
  const [tiposProcedimento, setTiposProcedimento] = useState<TipoProcedimento[]>([]);
  const [clinicas, setClinicas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Patient editing
  const [editing, setEditing] = useState(false);
  const [editNome, setEditNome] = useState("");
  const [editTelefone, setEditTelefone] = useState("");
  const [editCidade, setEditCidade] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editOrigem, setEditOrigem] = useState("");
  const [editNomeAnuncio, setEditNomeAnuncio] = useState("");

  // Treatment editing
  const [editingTratId, setEditingTratId] = useState<string | null>(null);
  const [editTratProcedimento, setEditTratProcedimento] = useState("");
  const [editTratEspecialidade, setEditTratEspecialidade] = useState("");
  const [editTratValorOrcado, setEditTratValorOrcado] = useState("");
  const [editTratValorContratado, setEditTratValorContratado] = useState("");
  const [editTratStatus, setEditTratStatus] = useState("");
  const [editTratClinicaId, setEditTratClinicaId] = useState("");

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      setLoading(true);
      const [{ data: pac }, { data: trats }, { data: pags }, { data: tipos }, { data: cls }] = await Promise.all([
        supabase.from("pacientes").select("*").eq("id", id).maybeSingle(),
        supabase.from("tratamentos").select("*, clinicas(nome)").eq("paciente_id", id).order("created_at", { ascending: false }),
        supabase.from("pagamentos").select("*, clinicas(nome)").eq("paciente_id", id).order("data_pagamento", { ascending: false }),
        supabase.from("tipos_procedimento").select("id, nome, especialidade, especialidade_secundaria, valor_referencia").eq("ativo", true).order("nome"),
        supabase.from("clinicas").select("*").eq("ativa", true),
      ]);
      setPaciente(pac);
      setTratamentos(trats || []);
      setPagamentos(pags || []);
      setTiposProcedimento((tipos as TipoProcedimento[]) || []);
      setClinicas(cls || []);
      if (pac) {
        setEditNome(pac.nome);
        setEditTelefone(pac.telefone);
        setEditCidade(pac.cidade || "");
        setEditEmail(pac.email || "");
        setEditOrigem(pac.origem || "");
        setEditNomeAnuncio(pac.nome_anuncio || "");
      }
      setLoading(false);
    };
    load();
  }, [id]);

  const handleSavePaciente = async () => {
    if (!id) return;
    setSaving(true);
    const { error } = await supabase.from("pacientes").update({
      nome: editNome,
      telefone: editTelefone,
      cidade: editCidade || null,
      email: editEmail || null,
      origem: editOrigem || null,
      nome_anuncio: editNomeAnuncio || null,
    }).eq("id", id);
    setSaving(false);
    if (error) { toast.error("Erro: " + error.message); return; }
    setPaciente({ ...paciente, nome: editNome, telefone: editTelefone, cidade: editCidade, email: editEmail, origem: editOrigem, nome_anuncio: editNomeAnuncio });
    setEditing(false);
    toast.success("Dados atualizados!");
  };

  const handleDeletePaciente = async () => {
    if (!id) return;
    // Delete pagamentos, then tratamentos, then paciente
    await supabase.from("pagamentos").delete().eq("paciente_id", id);
    await supabase.from("tratamentos").delete().eq("paciente_id", id);
    const { error } = await supabase.from("pacientes").delete().eq("id", id);
    if (error) { toast.error("Erro: " + error.message); return; }
    toast.success("Paciente excluído!");
    navigate("/pacientes");
  };

  const startEditTratamento = (t: any) => {
    setEditingTratId(t.id);
    setEditTratProcedimento(t.procedimento);
    setEditTratEspecialidade(t.especialidade || "");
    setEditTratValorOrcado(formatCurrency(Number(t.valor_orcado || 0)));
    setEditTratValorContratado(formatCurrency(Number(t.valor_contratado || 0)));
    setEditTratStatus(t.status);
    setEditTratClinicaId(t.clinica_id);
  };

  const cancelEditTratamento = () => {
    setEditingTratId(null);
  };

  const getEspecialidadesDisponiveis = (procNome: string) => {
    const tp = tiposProcedimento.find(t => t.nome === procNome);
    if (!tp) return [];
    const list: string[] = [];
    if (tp.especialidade) list.push(tp.especialidade);
    if (tp.especialidade_secundaria) list.push(tp.especialidade_secundaria);
    return list;
  };

  const handleEditTratProcedimentoChange = (v: string) => {
    setEditTratProcedimento(v);
    const tp = tiposProcedimento.find(t => t.nome === v);
    if (tp?.especialidade && !tp.especialidade_secundaria) {
      setEditTratEspecialidade(tp.especialidade);
    } else {
      setEditTratEspecialidade("");
    }
  };

  const handleSaveTratamento = async () => {
    if (!editingTratId) return;
    const valorOrcado = parseCurrency(editTratValorOrcado);
    const valorContratado = parseCurrency(editTratValorContratado);
    setSaving(true);
    const { error } = await supabase.from("tratamentos").update({
      procedimento: editTratProcedimento,
      especialidade: editTratEspecialidade || null,
      valor_orcado: valorOrcado,
      valor_contratado: valorContratado,
      status: editTratStatus,
      clinica_id: editTratClinicaId,
    }).eq("id", editingTratId);
    setSaving(false);
    if (error) { toast.error("Erro: " + error.message); return; }
    setTratamentos(prev => prev.map(t => t.id === editingTratId ? {
      ...t,
      procedimento: editTratProcedimento,
      especialidade: editTratEspecialidade || null,
      valor_orcado: valorOrcado,
      valor_contratado: valorContratado,
      status: editTratStatus,
      clinica_id: editTratClinicaId,
      clinicas: clinicas.find(c => c.id === editTratClinicaId) || t.clinicas,
    } : t));
    setEditingTratId(null);
    toast.success("Tratamento atualizado!");
  };

  const handleDeleteTratamento = async (tratId: string) => {
    await supabase.from("pagamentos").delete().eq("tratamento_id", tratId);
    const { error } = await supabase.from("tratamentos").delete().eq("id", tratId);
    if (error) { toast.error("Erro: " + error.message); return; }
    setTratamentos(prev => prev.filter(t => t.id !== tratId));
    setPagamentos(prev => prev.filter(p => p.tratamento_id !== tratId));
    toast.success("Tratamento excluído!");
  };

  const totalPago = pagamentos.reduce((s, p) => s + Number(p.valor), 0);
  const totalContratado = tratamentos.reduce((s, t) => s + Number(t.valor_contratado || 0), 0);

  if (loading) return <div className="flex items-center justify-center h-64 text-muted-foreground animate-pulse">Carregando...</div>;
  if (!paciente) return <div className="text-center text-muted-foreground py-12">Paciente não encontrado.</div>;

  const editTratEspDisp = getEspecialidadesDisponiveis(editTratProcedimento);
  const editTratMultEsp = editTratEspDisp.length > 1;

  return (
    <div className="animate-fade-in space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/pacientes")}>
          <ArrowLeft size={20} />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{paciente.nome}</h1>
          <p className="text-sm text-muted-foreground">{paciente.telefone} {paciente.cidade && `• ${paciente.cidade}`}</p>
        </div>
        <Button onClick={() => navigate("/atendimento")} className="gradient-orange text-primary-foreground shadow-orange hover:opacity-90">
          <Plus size={16} className="mr-2" /> Novo Procedimento
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="icon">
              <Trash2 size={16} />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir paciente?</AlertDialogTitle>
              <AlertDialogDescription>
                Isso excluirá permanentemente o paciente <strong>{paciente.nome}</strong>, todos os seus tratamentos e pagamentos. Esta ação não pode ser desfeita.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={handleDeletePaciente} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Excluir</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="gradient-card border-border shadow-card">
          <CardContent className="pt-4 pb-3 text-center">
            <DollarSign size={20} className="mx-auto text-primary mb-1" />
            <p className="text-2xl font-bold text-primary">{formatCurrency(totalPago)}</p>
            <p className="text-xs text-muted-foreground">Total Pago</p>
          </CardContent>
        </Card>
        <Card className="gradient-card border-border shadow-card">
          <CardContent className="pt-4 pb-3 text-center">
            <DollarSign size={20} className="mx-auto text-muted-foreground mb-1" />
            <p className="text-2xl font-bold">{formatCurrency(totalContratado)}</p>
            <p className="text-xs text-muted-foreground">Total Contratado</p>
          </CardContent>
        </Card>
        <Card className="gradient-card border-border shadow-card">
          <CardContent className="pt-4 pb-3 text-center">
            <FileText size={20} className="mx-auto text-muted-foreground mb-1" />
            <p className="text-2xl font-bold">{tratamentos.length}</p>
            <p className="text-xs text-muted-foreground">Tratamentos</p>
          </CardContent>
        </Card>
      </div>

      {/* Patient info */}
      <Card className="gradient-card border-border shadow-card">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <User size={18} className="text-primary" /> Dados do Paciente
          </CardTitle>
          {!editing ? (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil size={14} className="mr-1" /> Editar
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancelar</Button>
              <Button size="sm" onClick={handleSavePaciente} disabled={saving}>
                <Save size={14} className="mr-1" /> Salvar
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {editing ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label>Nome</Label><Input value={editNome} onChange={(e) => setEditNome(e.target.value)} className="bg-secondary border-border" /></div>
              <div className="space-y-2"><Label>Telefone</Label><Input value={editTelefone} onChange={(e) => setEditTelefone(e.target.value)} className="bg-secondary border-border" /></div>
              <div className="space-y-2"><Label>Cidade</Label><Input value={editCidade} onChange={(e) => setEditCidade(e.target.value)} className="bg-secondary border-border" /></div>
              <div className="space-y-2"><Label>Email</Label><Input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} className="bg-secondary border-border" /></div>
              <div className="space-y-2">
                <Label>Origem</Label>
                <Select value={editOrigem} onValueChange={setEditOrigem}>
                  <SelectTrigger className="bg-secondary border-border"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {origens.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Nome do Anúncio</Label><Input value={editNomeAnuncio} onChange={(e) => setEditNomeAnuncio(e.target.value)} className="bg-secondary border-border" /></div>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 text-sm">
              <div><span className="text-muted-foreground">Nome:</span> <span className="font-medium">{paciente.nome}</span></div>
              <div><span className="text-muted-foreground">Telefone:</span> <span className="font-medium">{paciente.telefone}</span></div>
              <div><span className="text-muted-foreground">Cidade:</span> <span className="font-medium">{paciente.cidade || "—"}</span></div>
              <div><span className="text-muted-foreground">Email:</span> <span className="font-medium">{paciente.email || "—"}</span></div>
              <div><span className="text-muted-foreground">Origem:</span> <span className="font-medium">{paciente.origem || "—"}</span></div>
              <div><span className="text-muted-foreground">Anúncio:</span> <span className="font-medium">{paciente.nome_anuncio || "—"}</span></div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Treatments */}
      <Card className="gradient-card border-border shadow-card">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText size={18} className="text-primary" /> Tratamentos
          </CardTitle>
        </CardHeader>
        <CardContent>
          {tratamentos.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Nenhum tratamento registrado.</p>
          ) : (
            <div className="space-y-3">
              {tratamentos.map((t) => {
                const pagsTrat = pagamentos.filter(p => p.tratamento_id === t.id);
                const totalPagoTrat = pagsTrat.reduce((s, p) => s + Number(p.valor), 0);
                const isEditing = editingTratId === t.id;

                if (isEditing) {
                  return (
                    <div key={t.id} className="rounded-lg border-2 border-primary/40 p-4 space-y-3 bg-primary/5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-primary">Editando Tratamento</span>
                        <Button variant="ghost" size="sm" onClick={cancelEditTratamento} className="h-7 w-7 p-0">
                          <X size={14} />
                        </Button>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Procedimento</Label>
                          <Select value={editTratProcedimento} onValueChange={handleEditTratProcedimentoChange}>
                            <SelectTrigger className="bg-secondary border-border"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {tiposProcedimento.map(p => <SelectItem key={p.id} value={p.nome}>{p.nome}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Especialidade</Label>
                          {editTratMultEsp ? (
                            <Select value={editTratEspecialidade} onValueChange={setEditTratEspecialidade}>
                              <SelectTrigger className="bg-secondary border-border"><SelectValue placeholder="Selecione" /></SelectTrigger>
                              <SelectContent>
                                {editTratEspDisp.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input readOnly value={editTratEspecialidade || "—"} className="bg-muted border-border cursor-not-allowed text-sm" />
                          )}
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Clínica</Label>
                          <Select value={editTratClinicaId} onValueChange={setEditTratClinicaId}>
                            <SelectTrigger className="bg-secondary border-border"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {clinicas.map(c => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Status</Label>
                          <Select value={editTratStatus} onValueChange={setEditTratStatus}>
                            <SelectTrigger className="bg-secondary border-border"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="ativo">Ativo</SelectItem>
                              <SelectItem value="concluido">Concluído</SelectItem>
                              <SelectItem value="cancelado">Cancelado</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Valor Orçado</Label>
                          <Input inputMode="numeric" value={editTratValorOrcado} onChange={e => setEditTratValorOrcado(formatCurrencyInput(e.target.value))} className="bg-secondary border-border" />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Valor Contratado</Label>
                          <Input inputMode="numeric" value={editTratValorContratado} onChange={e => setEditTratValorContratado(formatCurrencyInput(e.target.value))} className="bg-secondary border-border" />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Não Contratado</Label>
                          <Input readOnly value={formatCurrency(Math.max(0, parseCurrency(editTratValorOrcado) - parseCurrency(editTratValorContratado)))} className="bg-muted border-border cursor-not-allowed text-sm" />
                        </div>
                      </div>
                      <Button size="sm" onClick={handleSaveTratamento} disabled={saving} className="w-full">
                        <Save size={14} className="mr-1" /> Salvar Tratamento
                      </Button>
                    </div>
                  );
                }

                return (
                  <div key={t.id} className="rounded-lg border border-border p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-semibold">{t.procedimento}</span>
                        <span className="text-xs text-muted-foreground ml-2">{(t.clinicas as any)?.nome}</span>
                        {t.especialidade && <span className="text-xs text-muted-foreground ml-2">· {t.especialidade}</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={t.status === "ativo" ? "default" : "secondary"} className={t.status === "ativo" ? "bg-green-600/20 text-green-400 border-green-600/30" : ""}>
                          {t.status}
                        </Badge>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => startEditTratamento(t)}>
                          <Pencil size={13} />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive">
                              <Trash2 size={13} />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Excluir tratamento?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Isso excluirá o tratamento <strong>{t.procedimento}</strong> e todos os pagamentos vinculados. Esta ação não pode ser desfeita.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDeleteTratamento(t.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Excluir</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                    <div className="flex gap-4 text-xs text-muted-foreground">
                      <span>Orçado: {formatCurrency(Number(t.valor_orcado || 0))}</span>
                      <span>Contratado: {formatCurrency(Number(t.valor_contratado || 0))}</span>
                      <span className="text-primary font-medium">Pago: {formatCurrency(totalPagoTrat)}</span>
                    </div>
                    {pagsTrat.length > 0 && (
                      <div className="pl-2 border-l-2 border-primary/20 space-y-1 mt-1">
                        {pagsTrat.map((p) => (
                          <div key={p.id} className="flex justify-between text-xs text-muted-foreground">
                            <span>{new Date(p.data_pagamento + "T12:00:00").toLocaleDateString("pt-BR")} — {p.forma_pagamento}</span>
                            <span className="font-medium text-foreground">{formatCurrency(Number(p.valor))}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default PacienteDetalhe;
