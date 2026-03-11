import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Save, Plus, User, FileText, DollarSign } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const formatCurrency = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

const PacienteDetalhe = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [paciente, setPaciente] = useState<any>(null);
  const [tratamentos, setTratamentos] = useState<any[]>([]);
  const [pagamentos, setPagamentos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editNome, setEditNome] = useState("");
  const [editTelefone, setEditTelefone] = useState("");
  const [editCidade, setEditCidade] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      setLoading(true);
      const [{ data: pac }, { data: trats }, { data: pags }] = await Promise.all([
        supabase.from("pacientes").select("*").eq("id", id).maybeSingle(),
        supabase.from("tratamentos").select("*, clinicas(nome)").eq("paciente_id", id).order("created_at", { ascending: false }),
        supabase.from("pagamentos").select("*, clinicas(nome)").eq("paciente_id", id).order("data_pagamento", { ascending: false }),
      ]);
      setPaciente(pac);
      setTratamentos(trats || []);
      setPagamentos(pags || []);
      if (pac) {
        setEditNome(pac.nome);
        setEditTelefone(pac.telefone);
        setEditCidade(pac.cidade || "");
        setEditEmail(pac.email || "");
      }
      setLoading(false);
    };
    load();
  }, [id]);

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    const { error } = await supabase.from("pacientes").update({
      nome: editNome,
      telefone: editTelefone,
      cidade: editCidade || null,
      email: editEmail || null,
    }).eq("id", id);
    setSaving(false);
    if (error) { toast.error("Erro: " + error.message); return; }
    setPaciente({ ...paciente, nome: editNome, telefone: editTelefone, cidade: editCidade, email: editEmail });
    setEditing(false);
    toast.success("Dados atualizados!");
  };

  const totalPago = pagamentos.reduce((s, p) => s + Number(p.valor), 0);
  const totalContratado = tratamentos.reduce((s, t) => s + Number(t.valor_contratado || 0), 0);

  if (loading) return <div className="flex items-center justify-center h-64 text-muted-foreground animate-pulse">Carregando...</div>;
  if (!paciente) return <div className="text-center text-muted-foreground py-12">Paciente não encontrado.</div>;

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
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Editar</Button>
          ) : (
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancelar</Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>
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
                return (
                  <div key={t.id} className="rounded-lg border border-border p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-semibold">{t.procedimento}</span>
                        <span className="text-xs text-muted-foreground ml-2">{(t.clinicas as any)?.nome}</span>
                      </div>
                      <Badge variant={t.status === "ativo" ? "default" : "secondary"} className={t.status === "ativo" ? "bg-green-600/20 text-green-400 border-green-600/30" : ""}>
                        {t.status}
                      </Badge>
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
