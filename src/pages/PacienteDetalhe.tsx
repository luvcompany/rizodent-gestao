import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ArrowLeft, Save, Plus, User, FileText, DollarSign, Trash2, Pencil, X, Check, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const origens = ["Anúncio", "Instagram", "Google Ads", "Facebook", "Indicação", "Site", "Outros"];

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
  const [orcamentos, setOrcamentos] = useState<any[]>([]);
  const [tratamentos, setTratamentos] = useState<any[]>([]);
  const [pagamentos, setPagamentos] = useState<any[]>([]);
  const [tiposProcedimento, setTiposProcedimento] = useState<TipoProcedimento[]>([]);
  const [clinicas, setClinicas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expandedOrcamento, setExpandedOrcamento] = useState<string | null>(null);

  // Patient editing
  const [editing, setEditing] = useState(false);
  const [editNome, setEditNome] = useState("");
  const [editTelefone, setEditTelefone] = useState("");
  const [editCidade, setEditCidade] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editOrigem, setEditOrigem] = useState("");
  const [editNomeAnuncio, setEditNomeAnuncio] = useState("");

  // Valor orçado editing (orcamento-level)
  const [editingValorOrcadoId, setEditingValorOrcadoId] = useState<string | null>(null);
  const [editValorOrcado, setEditValorOrcado] = useState("");

  // Treatment editing
  const [editingTratId, setEditingTratId] = useState<string | null>(null);
  const [editTratProcedimento, setEditTratProcedimento] = useState("");
  const [editTratEspecialidade, setEditTratEspecialidade] = useState("");
  const [editTratStatus, setEditTratStatus] = useState("");
  const [editTratClinicaId, setEditTratClinicaId] = useState("");

  // Payment editing
  const [editingPagId, setEditingPagId] = useState<string | null>(null);
  const [editPagValor, setEditPagValor] = useState("");
  const [editPagForma, setEditPagForma] = useState("");
  const [editPagData, setEditPagData] = useState("");
  const [editPagTipo, setEditPagTipo] = useState("");

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      setLoading(true);
      const [{ data: pac }, { data: orcs }, { data: trats }, { data: pags }, { data: tipos }, { data: cls }] = await Promise.all([
        supabase.from("pacientes").select("*").eq("id", id).maybeSingle(),
        supabase.from("orcamentos").select("*").eq("paciente_id", id).order("created_at", { ascending: false }),
        supabase.from("tratamentos").select("*, clinicas(nome)").eq("paciente_id", id).order("created_at", { ascending: false }),
        supabase.from("pagamentos").select("*, clinicas(nome)").eq("paciente_id", id).order("data_pagamento", { ascending: false }),
        supabase.from("tipos_procedimento").select("id, nome, especialidade, especialidade_secundaria, valor_referencia").eq("ativo", true).order("nome"),
        supabase.from("clinicas").select("*").eq("ativa", true),
      ]);
      setPaciente(pac);
      setOrcamentos(orcs || []);
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
      // Auto-expand the first open orcamento
      const openOrc = (orcs || []).find((o: any) => o.status === "aberto");
      if (openOrc) setExpandedOrcamento(openOrc.id);
      else if (orcs && orcs.length > 0) setExpandedOrcamento(orcs[0].id);
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
    await supabase.from("pagamentos").delete().eq("paciente_id", id);
    await supabase.from("tratamentos").delete().eq("paciente_id", id);
    await supabase.from("orcamentos").delete().eq("paciente_id", id);
    const { error } = await supabase.from("pacientes").delete().eq("id", id);
    if (error) { toast.error("Erro: " + error.message); return; }
    toast.success("Paciente excluído!");
    navigate("/pacientes");
  };

  const startEditTratamento = (t: any) => {
    setEditingTratId(t.id);
    setEditTratProcedimento(t.procedimento);
    setEditTratEspecialidade(t.especialidade || "");
    setEditTratStatus(t.status);
    setEditTratClinicaId(t.clinica_id);
  };

  const cancelEditTratamento = () => { setEditingTratId(null); };

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
    setSaving(true);
    const { error } = await supabase.from("tratamentos").update({
      procedimento: editTratProcedimento,
      especialidade: editTratEspecialidade || null,
      status: editTratStatus,
      clinica_id: editTratClinicaId,
    }).eq("id", editingTratId);
    setSaving(false);
    if (error) { toast.error("Erro: " + error.message); return; }
    setTratamentos(prev => prev.map(t => t.id === editingTratId ? {
      ...t,
      procedimento: editTratProcedimento,
      especialidade: editTratEspecialidade || null,
      status: editTratStatus,
      clinica_id: editTratClinicaId,
      clinicas: clinicas.find(c => c.id === editTratClinicaId) || t.clinicas,
    } : t));
    setEditingTratId(null);
    toast.success("Tratamento atualizado!");
  };

  const handleSaveValorOrcado = async () => {
    if (!editingValorOrcadoId) return;
    const valor = parseCurrency(editValorOrcado);
    setSaving(true);
    const { error } = await supabase.from("orcamentos").update({ valor_orcado: valor }).eq("id", editingValorOrcadoId);
    setSaving(false);
    if (error) { toast.error("Erro: " + error.message); return; }
    setOrcamentos(prev => prev.map(o => o.id === editingValorOrcadoId ? { ...o, valor_orcado: valor } : o));
    setEditingValorOrcadoId(null);
    toast.success("Valor orçado atualizado!");
  };

  const handleDeleteTratamento = async (tratId: string) => {
    await supabase.from("pagamentos").delete().eq("tratamento_id", tratId);
    const { error } = await supabase.from("tratamentos").delete().eq("id", tratId);
    if (error) { toast.error("Erro: " + error.message); return; }
    setTratamentos(prev => prev.filter(t => t.id !== tratId));
    setPagamentos(prev => prev.filter(p => p.tratamento_id !== tratId));
    toast.success("Tratamento excluído!");
  };

  const startEditPagamento = (p: any) => {
    setEditingPagId(p.id);
    setEditPagValor(formatCurrency(Number(p.valor)));
    setEditPagForma(p.forma_pagamento);
    setEditPagData(p.data_pagamento);
    setEditPagTipo(p.tipo);
  };

  const handleSavePagamento = async () => {
    if (!editingPagId) return;
    const valor = parseCurrency(editPagValor);
    setSaving(true);
    const { error } = await supabase.from("pagamentos").update({
      valor,
      forma_pagamento: editPagForma,
      data_pagamento: editPagData,
      tipo: editPagTipo,
    }).eq("id", editingPagId);
    setSaving(false);
    if (error) { toast.error("Erro: " + error.message); return; }
    setPagamentos(prev => prev.map(p => p.id === editingPagId ? { ...p, valor, forma_pagamento: editPagForma, data_pagamento: editPagData, tipo: editPagTipo } : p));
    setEditingPagId(null);
    toast.success("Pagamento atualizado!");
  };

  const handleDeletePagamento = async (pagId: string) => {
    const { error } = await supabase.from("pagamentos").delete().eq("id", pagId);
    if (error) { toast.error("Erro: " + error.message); return; }
    setPagamentos(prev => prev.filter(p => p.id !== pagId));
    toast.success("Pagamento excluído!");
  };

  const handleDeleteOrcamento = async (orcId: string) => {
    // Delete pagamentos and tratamentos linked to this orcamento
    await supabase.from("pagamentos").delete().eq("orcamento_id", orcId);
    await supabase.from("tratamentos").delete().eq("orcamento_id", orcId);
    const { error } = await supabase.from("orcamentos").delete().eq("id", orcId);
    if (error) { toast.error("Erro: " + error.message); return; }
    setOrcamentos(prev => prev.filter(o => o.id !== orcId));
    setTratamentos(prev => prev.filter(t => t.orcamento_id !== orcId));
    setPagamentos(prev => prev.filter(p => p.orcamento_id !== orcId));
    toast.success("Orçamento excluído!");
  };

  // Global totals
  const totalGlobalOrcado = orcamentos.reduce((s, o) => s + Number(o.valor_orcado || 0), 0);
  const totalGlobalContratado = pagamentos.reduce((s, p) => s + Number(p.valor || 0), 0);
  const totalGlobalNaoContratado = Math.max(0, totalGlobalOrcado - totalGlobalContratado);

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
        <Button onClick={() => navigate("/atendimento", { state: { pacienteId: id, pacienteNome: paciente.nome, pacienteTelefone: paciente.telefone, pacienteCidade: paciente.cidade, pacienteOrigem: paciente.origem, pacienteNomeAnuncio: paciente.nome_anuncio } })} className="gradient-orange text-primary-foreground shadow-orange hover:opacity-90">
          <Plus size={16} className="mr-2" /> Novo Procedimento
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="icon"><Trash2 size={16} /></Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir paciente?</AlertDialogTitle>
              <AlertDialogDescription>Isso excluirá permanentemente o paciente <strong>{paciente.nome}</strong>, todos os seus orçamentos, tratamentos e pagamentos.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={handleDeletePaciente} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Excluir</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Global KPIs */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card className="gradient-card border-border shadow-card">
          <CardContent className="pt-4 pb-3 text-center">
            <DollarSign size={20} className="mx-auto text-primary mb-1" />
            <p className="text-2xl font-bold text-primary">{formatCurrency(totalGlobalOrcado)}</p>
            <p className="text-xs text-muted-foreground">Total Orçado</p>
          </CardContent>
        </Card>
        <Card className={`gradient-card border-border shadow-card ${totalGlobalOrcado > 0 && totalGlobalContratado >= totalGlobalOrcado ? 'border-green-500/40' : ''}`}>
          <CardContent className="pt-4 pb-3 text-center">
            <DollarSign size={20} className={`mx-auto mb-1 ${totalGlobalContratado >= totalGlobalOrcado && totalGlobalOrcado > 0 ? 'text-green-500' : 'text-muted-foreground'}`} />
            <p className={`text-2xl font-bold ${totalGlobalContratado >= totalGlobalOrcado && totalGlobalOrcado > 0 ? 'text-green-500' : ''}`}>{formatCurrency(totalGlobalContratado)}</p>
            <p className="text-xs text-muted-foreground">Total Contratado</p>
          </CardContent>
        </Card>
        <Card className="gradient-card border-border shadow-card">
          <CardContent className="pt-4 pb-3 text-center">
            <DollarSign size={20} className="mx-auto text-destructive mb-1" />
            <p className="text-2xl font-bold text-destructive">{formatCurrency(totalGlobalNaoContratado)}</p>
            <p className="text-xs text-muted-foreground">Não Contratado</p>
          </CardContent>
        </Card>
        <Card className="gradient-card border-border shadow-card">
          <CardContent className="pt-4 pb-3 text-center">
            <FileText size={20} className="mx-auto text-muted-foreground mb-1" />
            <p className="text-2xl font-bold">{orcamentos.length}</p>
            <p className="text-xs text-muted-foreground">Orçamentos</p>
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
                  <SelectContent>{origens.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {editOrigem === "Anúncio" && (
                <div className="space-y-2"><Label>Nome do Anúncio</Label><Input value={editNomeAnuncio} onChange={(e) => setEditNomeAnuncio(e.target.value)} className="bg-secondary border-border" /></div>
              )}
              {editOrigem === "Outros" && (
                <div className="space-y-2"><Label>De onde veio o lead?</Label><Input value={editNomeAnuncio} onChange={(e) => setEditNomeAnuncio(e.target.value)} className="bg-secondary border-border" /></div>
              )}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 text-sm">
              <div><span className="text-muted-foreground">Nome:</span> <span className="font-medium">{paciente.nome}</span></div>
              <div><span className="text-muted-foreground">Telefone:</span> <span className="font-medium">{paciente.telefone}</span></div>
              <div><span className="text-muted-foreground">Cidade:</span> <span className="font-medium">{paciente.cidade || "—"}</span></div>
              <div><span className="text-muted-foreground">Email:</span> <span className="font-medium">{paciente.email || "—"}</span></div>
              <div><span className="text-muted-foreground">Origem:</span> <span className="font-medium">{paciente.origem || "—"}</span></div>
              {(paciente.origem === "Anúncio" || paciente.origem === "Outros") && paciente.nome_anuncio && (
                <div><span className="text-muted-foreground">{paciente.origem === "Anúncio" ? "Anúncio:" : "Detalhe:"}</span> <span className="font-medium">{paciente.nome_anuncio}</span></div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Orçamentos (each one independently) */}
      {orcamentos.length === 0 ? (
        <Card className="gradient-card border-border shadow-card">
          <CardContent className="py-8 text-center text-muted-foreground">
            Nenhum orçamento registrado para este paciente.
          </CardContent>
        </Card>
      ) : (
        orcamentos.map((orc, orcIndex) => {
          const orcTratamentos = tratamentos.filter(t => t.orcamento_id === orc.id);
          const orcPagamentos = pagamentos.filter(p => p.orcamento_id === orc.id);
          const orcOrcado = Number(orc.valor_orcado || 0);
          const orcContratado = orcPagamentos.reduce((s: number, p: any) => s + Number(p.valor || 0), 0);
          const orcNaoContratado = Math.max(0, orcOrcado - orcContratado);
          const concluido = orcOrcado > 0 && orcContratado >= orcOrcado;
          const isExpanded = expandedOrcamento === orc.id;
          const isEditingOrcado = editingValorOrcadoId === orc.id;

          return (
            <Card key={orc.id} className={`gradient-card border-border shadow-card ${concluido ? 'border-green-500/30' : ''}`}>
              <CardHeader className="cursor-pointer" onClick={() => setExpandedOrcamento(isExpanded ? null : orc.id)}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <DollarSign size={18} className="text-primary" />
                      Orçamento #{orcamentos.length - orcIndex}
                    </CardTitle>
                    {concluido && <Badge className="bg-green-600/20 text-green-400 border-green-600/30 text-xs">Concluído</Badge>}
                    {!concluido && <Badge className="bg-primary/20 text-primary border-primary/30 text-xs">Aberto</Badge>}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-sm font-semibold">{formatCurrency(orcOrcado)}</p>
                      <p className="text-xs text-muted-foreground">Contratado: {formatCurrency(orcContratado)}</p>
                    </div>
                    {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </div>
                </div>
              </CardHeader>
              {isExpanded && (
                <CardContent className="space-y-4 pt-0">
                  {/* Orcamento KPIs */}
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-lg bg-secondary p-3 cursor-pointer hover:bg-secondary/80 transition-colors" onClick={(e) => { e.stopPropagation(); setEditingValorOrcadoId(orc.id); setEditValorOrcado(formatCurrency(orcOrcado)); }}>
                      {isEditingOrcado ? (
                        <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
                          <Input value={editValorOrcado} onChange={(e) => setEditValorOrcado(formatCurrencyInput(e.target.value))} className="bg-background border-border h-8 text-sm text-center" autoFocus onKeyDown={(e) => { if (e.key === "Enter") handleSaveValorOrcado(); if (e.key === "Escape") setEditingValorOrcadoId(null); }} />
                          <div className="flex gap-1 justify-center">
                            <Button size="sm" className="h-6 text-xs px-2" onClick={() => handleSaveValorOrcado()} disabled={saving}><Check size={12} /></Button>
                            <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => setEditingValorOrcadoId(null)}><X size={12} /></Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="text-xs text-muted-foreground">Orçado <Pencil size={10} className="inline ml-1" /></p>
                          <p className="text-lg font-bold text-primary">{formatCurrency(orcOrcado)}</p>
                        </>
                      )}
                    </div>
                    <div className="rounded-lg bg-secondary p-3">
                      <p className="text-xs text-muted-foreground">Contratado</p>
                      <p className={`text-lg font-bold ${concluido ? 'text-green-500' : ''}`}>{formatCurrency(orcContratado)}</p>
                    </div>
                    <div className="rounded-lg bg-secondary p-3">
                      <p className="text-xs text-muted-foreground">Restante</p>
                      <p className="text-lg font-bold text-destructive">{formatCurrency(orcNaoContratado)}</p>
                    </div>
                  </div>

                  {/* Tratamentos deste orçamento */}
                  <div>
                    <p className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                      <FileText size={14} /> Tratamentos ({orcTratamentos.length})
                    </p>
                    {orcTratamentos.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-2">Nenhum tratamento neste orçamento.</p>
                    ) : (
                      <div className="space-y-2">
                        {orcTratamentos.map((t) => {
                          const isEditing = editingTratId === t.id;
                          if (isEditing) {
                            return (
                              <div key={t.id} className="rounded-lg border-2 border-primary/40 p-4 space-y-3 bg-primary/5">
                                <div className="flex items-center justify-between">
                                  <span className="text-sm font-semibold text-primary">Editando Tratamento</span>
                                  <Button variant="ghost" size="sm" onClick={cancelEditTratamento} className="h-7 w-7 p-0"><X size={14} /></Button>
                                </div>
                                <div className="grid gap-3 sm:grid-cols-2">
                                  <div className="space-y-1.5">
                                    <Label className="text-xs">Procedimento</Label>
                                    <Select value={editTratProcedimento} onValueChange={handleEditTratProcedimentoChange}>
                                      <SelectTrigger className="bg-secondary border-border"><SelectValue /></SelectTrigger>
                                      <SelectContent>{tiposProcedimento.map(p => <SelectItem key={p.id} value={p.nome}>{p.nome}</SelectItem>)}</SelectContent>
                                    </Select>
                                  </div>
                                  <div className="space-y-1.5">
                                    <Label className="text-xs">Especialidade</Label>
                                    {editTratMultEsp ? (
                                      <Select value={editTratEspecialidade} onValueChange={setEditTratEspecialidade}>
                                        <SelectTrigger className="bg-secondary border-border"><SelectValue placeholder="Selecione" /></SelectTrigger>
                                        <SelectContent>{editTratEspDisp.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}</SelectContent>
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
                                      <SelectContent>{clinicas.map(c => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectContent>
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
                                <Button size="sm" onClick={handleSaveTratamento} disabled={saving} className="w-full">
                                  <Save size={14} className="mr-1" /> Salvar Tratamento
                                </Button>
                              </div>
                            );
                          }

                          return (
                            <div key={t.id} className="rounded-lg border border-border p-3">
                              <div className="flex items-center justify-between">
                                <div>
                                  <span className="font-semibold">{t.procedimento}</span>
                                  <span className="text-xs text-muted-foreground ml-2">{(t.clinicas as any)?.nome}</span>
                                  {t.especialidade && <span className="text-xs text-muted-foreground ml-2">· {t.especialidade}</span>}
                                </div>
                                <div className="flex items-center gap-2">
                                  <Badge variant={t.status === "ativo" ? "default" : "secondary"} className={t.status === "ativo" ? "bg-green-600/20 text-green-400 border-green-600/30" : ""}>{t.status}</Badge>
                                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => startEditTratamento(t)}><Pencil size={13} /></Button>
                                  <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive"><Trash2 size={13} /></Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                      <AlertDialogHeader>
                                        <AlertDialogTitle>Excluir tratamento?</AlertDialogTitle>
                                        <AlertDialogDescription>Isso excluirá o tratamento <strong>{t.procedimento}</strong> e todos os pagamentos vinculados.</AlertDialogDescription>
                                      </AlertDialogHeader>
                                      <AlertDialogFooter>
                                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                        <AlertDialogAction onClick={() => handleDeleteTratamento(t.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Excluir</AlertDialogAction>
                                      </AlertDialogFooter>
                                    </AlertDialogContent>
                                  </AlertDialog>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Pagamentos deste orçamento */}
                  <div>
                    <p className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                      <DollarSign size={14} /> Pagamentos ({orcPagamentos.length})
                    </p>
                    {orcPagamentos.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-2">Nenhum pagamento neste orçamento.</p>
                    ) : (
                      <div className="space-y-3">
                        {(() => {
                          // Group payments by tratamento_id
                          const groups = new Map<string, { tratamento: any; pagamentos: any[]; total: number }>();
                          orcPagamentos.forEach((p) => {
                            const tid = p.tratamento_id || "sem_tratamento";
                            if (!groups.has(tid)) {
                              const trat = orcTratamentos.find(t => t.id === tid);
                              groups.set(tid, { tratamento: trat, pagamentos: [], total: 0 });
                            }
                            const g = groups.get(tid)!;
                            g.pagamentos.push(p);
                            g.total += Number(p.valor || 0);
                          });

                          return Array.from(groups.entries()).map(([tid, group]) => (
                            <div key={tid} className="rounded-lg border border-border bg-secondary/20 p-3 space-y-2">
                              <div className="flex items-center justify-between border-b border-border pb-2">
                                <span className="text-sm font-semibold text-foreground">
                                  {group.tratamento?.procedimento || "Pagamento sem procedimento"}
                                  {group.tratamento?.especialidade && (
                                    <span className="text-xs text-muted-foreground ml-2">· {group.tratamento.especialidade}</span>
                                  )}
                                </span>
                                <span className="text-sm font-semibold text-primary">{formatCurrency(group.total)}</span>
                              </div>
                              <div className="space-y-2">
                                {group.pagamentos.map((p) => {
                                  const isEditingPag = editingPagId === p.id;
                                  if (isEditingPag) {
                                    return (
                                      <div key={p.id} className="rounded-lg border-2 border-primary/40 p-3 space-y-3 bg-primary/5">
                                        <div className="flex items-center justify-between">
                                          <span className="text-sm font-semibold text-primary">Editando Pagamento</span>
                                          <Button variant="ghost" size="sm" onClick={() => setEditingPagId(null)} className="h-7 w-7 p-0"><X size={14} /></Button>
                                        </div>
                                        <div className="grid gap-3 sm:grid-cols-2">
                                          <div className="space-y-1"><Label className="text-xs">Valor</Label><Input value={editPagValor} onChange={(e) => setEditPagValor(formatCurrencyInput(e.target.value))} className="bg-secondary border-border h-8 text-sm" /></div>
                                          <div className="space-y-1"><Label className="text-xs">Data</Label><Input type="date" value={editPagData} onChange={(e) => setEditPagData(e.target.value)} className="bg-secondary border-border h-8 text-sm" /></div>
                                          <div className="space-y-1">
                                            <Label className="text-xs">Forma</Label>
                                            <Select value={editPagForma} onValueChange={setEditPagForma}>
                                              <SelectTrigger className="bg-secondary border-border h-8 text-sm"><SelectValue /></SelectTrigger>
                                              <SelectContent>{["Dinheiro", "PIX", "Cartão Crédito", "Cartão Débito", "Boleto", "Cheque", "Não informado"].map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
                                            </Select>
                                          </div>
                                          <div className="space-y-1">
                                            <Label className="text-xs">Tipo</Label>
                                            <Select value={editPagTipo} onValueChange={setEditPagTipo}>
                                              <SelectTrigger className="bg-secondary border-border h-8 text-sm"><SelectValue /></SelectTrigger>
                                              <SelectContent>
                                                <SelectItem value="primeiro">1º Pagamento</SelectItem>
                                                <SelectItem value="recorrente">Recorrente</SelectItem>
                                              </SelectContent>
                                            </Select>
                                          </div>
                                        </div>
                                        <div className="flex justify-end">
                                          <Button size="sm" onClick={handleSavePagamento} disabled={saving} className="h-7 text-xs"><Check size={12} className="mr-1" /> Salvar</Button>
                                        </div>
                                      </div>
                                    );
                                  }

                                  return (
                                    <div key={p.id} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm bg-background">
                                      <div>
                                        <span className="text-muted-foreground">{new Date(p.data_pagamento + "T12:00:00").toLocaleDateString("pt-BR")}</span>
                                        <span className="text-xs text-muted-foreground ml-2">· {(p.clinicas as any)?.nome}</span>
                                        <Badge variant="outline" className="ml-2 text-xs">{p.tipo === "primeiro" ? "1º Pagamento" : "Recorrente"}</Badge>
                                        <span className="text-xs text-muted-foreground ml-2">· {p.forma_pagamento}</span>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <span className="font-semibold text-primary">{formatCurrency(Number(p.valor))}</span>
                                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => startEditPagamento(p)}><Pencil size={13} /></Button>
                                        <AlertDialog>
                                          <AlertDialogTrigger asChild>
                                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive"><Trash2 size={13} /></Button>
                                          </AlertDialogTrigger>
                                          <AlertDialogContent>
                                            <AlertDialogHeader>
                                              <AlertDialogTitle>Excluir pagamento?</AlertDialogTitle>
                                              <AlertDialogDescription>Excluir o pagamento de <strong>{formatCurrency(Number(p.valor))}</strong>?</AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                              <AlertDialogAction onClick={() => handleDeletePagamento(p.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Excluir</AlertDialogAction>
                                            </AlertDialogFooter>
                                          </AlertDialogContent>
                                        </AlertDialog>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ));
                        })()}
                      </div>
                    )}
                  </div>

                  {/* Delete orcamento */}
                  <div className="flex justify-end pt-2 border-t border-border">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive text-xs">
                          <Trash2 size={12} className="mr-1" /> Excluir orçamento
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Excluir orçamento?</AlertDialogTitle>
                          <AlertDialogDescription>Isso excluirá o orçamento #{orcamentos.length - orcIndex} e todos os tratamentos e pagamentos vinculados.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDeleteOrcamento(orc.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Excluir</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
};

export default PacienteDetalhe;
