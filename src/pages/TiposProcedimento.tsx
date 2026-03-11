import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Pencil, ToggleLeft, ToggleRight, Stethoscope, Search, Filter } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type TipoProcedimento = {
  id: string;
  nome: string;
  descricao: string | null;
  valor_referencia: number | null;
  especialidade: string | null;
  especialidade_secundaria: string | null;
  ativo: boolean;
  created_at: string;
};

const ESPECIALIDADES = ["CIRURGIA", "CLÍNICO GERAL", "ENDODONTIA", "ESTÉTICA", "IMPLANTODONTIA", "ORTODONTIA"];

const TiposProcedimento = () => {
  const [procedimentos, setProcedimentos] = useState<TipoProcedimento[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [valorReferencia, setValorReferencia] = useState("");
  const [espForm, setEspForm] = useState("");
  const [espSecForm, setEspSecForm] = useState("");
  const [saving, setSaving] = useState(false);
  const [filtroEsp, setFiltroEsp] = useState("todas");
  const [busca, setBusca] = useState("");

  const fetchData = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("tipos_procedimento")
      .select("*")
      .order("especialidade")
      .order("nome");
    setProcedimentos((data as TipoProcedimento[]) || []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const filtered = useMemo(() => {
    return procedimentos.filter((p) => {
      const matchEsp = filtroEsp === "todas" || p.especialidade === filtroEsp || p.especialidade_secundaria === filtroEsp;
      const matchBusca = !busca || p.nome.toLowerCase().includes(busca.toLowerCase());
      return matchEsp && matchBusca;
    });
  }, [procedimentos, filtroEsp, busca]);

  const resetForm = () => {
    setNome(""); setDescricao(""); setValorReferencia("");
    setEspForm(""); setEspSecForm(""); setEditingId(null);
  };

  const openEdit = (p: TipoProcedimento) => {
    setEditingId(p.id);
    setNome(p.nome);
    setDescricao(p.descricao || "");
    setValorReferencia(p.valor_referencia?.toString() || "");
    setEspForm(p.especialidade || "");
    setEspSecForm(p.especialidade_secundaria || "");
    setDialogOpen(true);
  };

  const openNew = () => { resetForm(); setDialogOpen(true); };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) { toast.error("Informe o nome do procedimento"); return; }
    if (!espForm) { toast.error("Selecione a especialidade"); return; }
    setSaving(true);
    try {
      const payload = {
        nome: nome.trim(),
        descricao: descricao.trim() || null,
        valor_referencia: valorReferencia ? parseFloat(valorReferencia) : 0,
        especialidade: espForm,
        especialidade_secundaria: espSecForm || null,
      };

      if (editingId) {
        const { error } = await supabase.from("tipos_procedimento").update(payload).eq("id", editingId);
        if (error) throw error;
        toast.success("Procedimento atualizado!");
      } else {
        const { error } = await supabase.from("tipos_procedimento").insert(payload);
        if (error) throw error;
        toast.success("Procedimento cadastrado!");
      }
      setDialogOpen(false);
      resetForm();
      fetchData();
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleAtivo = async (p: TipoProcedimento) => {
    try {
      const { error } = await supabase.from("tipos_procedimento").update({ ativo: !p.ativo }).eq("id", p.id);
      if (error) throw error;
      toast.success(p.ativo ? "Procedimento desativado" : "Procedimento ativado");
      fetchData();
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    }
  };

  const formatCurrency = (val: number | null) =>
    val != null ? val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";

  // Count by specialty
  const countByEsp = useMemo(() => {
    const map = new Map<string, number>();
    procedimentos.forEach((p) => {
      if (p.especialidade) map.set(p.especialidade, (map.get(p.especialidade) || 0) + 1);
    });
    return map;
  }, [procedimentos]);

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tipos de Procedimento</h1>
          <p className="text-sm text-muted-foreground">
            {procedimentos.length} procedimentos cadastrados
          </p>
        </div>
        <Button onClick={openNew} className="gradient-orange text-primary-foreground font-semibold shadow-orange hover:opacity-90">
          <Plus size={16} className="mr-2" />
          Novo Procedimento
        </Button>
      </div>

      {/* Specialty summary cards */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        {ESPECIALIDADES.map((esp) => (
          <button
            key={esp}
            onClick={() => setFiltroEsp(filtroEsp === esp ? "todas" : esp)}
            className={`rounded-lg border p-3 text-center transition-colors ${
              filtroEsp === esp
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card text-foreground hover:border-primary/30"
            }`}
          >
            <div className="text-lg font-bold">{countByEsp.get(esp) || 0}</div>
            <div className="text-[10px] font-medium leading-tight">{esp}</div>
          </button>
        ))}
      </div>

      {/* Filters */}
      <Card className="gradient-card border-border shadow-card">
        <CardContent className="pt-4 pb-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar procedimento..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="bg-secondary border-border pl-10"
              />
            </div>
            <Select value={filtroEsp} onValueChange={setFiltroEsp}>
              <SelectTrigger className="bg-secondary border-border">
                <Filter size={16} className="mr-2 text-primary" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas as Especialidades</SelectItem>
                {ESPECIALIDADES.map((e) => (
                  <SelectItem key={e} value={e}>{e}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="gradient-card border-border shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Stethoscope size={18} className="text-primary" />
            Procedimentos {filtroEsp !== "todas" ? `— ${filtroEsp}` : "Cadastrados"}
            <Badge variant="outline" className="ml-2 bg-primary/10 text-primary border-primary/30">
              {filtered.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground text-sm">Carregando...</p>
          ) : filtered.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhum procedimento encontrado.</p>
          ) : (
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Procedimento</TableHead>
                    <TableHead>Especialidade</TableHead>
                    <TableHead>Valor Ref.</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{p.nome}</p>
                          {p.descricao && <p className="text-xs text-muted-foreground truncate max-w-[200px]">{p.descricao}</p>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/30">
                            {p.especialidade || "—"}
                          </Badge>
                          {p.especialidade_secundaria && (
                            <Badge variant="outline" className="text-xs bg-accent/10 text-accent border-accent/30">
                              {p.especialidade_secundaria}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">{formatCurrency(p.valor_referencia)}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            p.ativo
                              ? "bg-green-500/20 text-green-400 border-green-500/30"
                              : "bg-muted text-muted-foreground border-border"
                          }
                        >
                          {p.ativo ? "Ativo" : "Inativo"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => openEdit(p)} className="text-primary hover:text-primary">
                            <Pencil size={14} className="mr-1" /> Editar
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => toggleAtivo(p)} className="text-muted-foreground hover:text-foreground">
                            {p.ativo ? <ToggleRight size={14} className="mr-1" /> : <ToggleLeft size={14} className="mr-1" />}
                            {p.ativo ? "Desativar" : "Ativar"}
                          </Button>
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

      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) resetForm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar Procedimento" : "Novo Procedimento"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Nome *</Label>
              <Input placeholder="Ex: Implante Dentário" value={nome} onChange={(e) => setNome(e.target.value)} className="bg-secondary border-border" required />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Especialidade *</Label>
                <Select value={espForm} onValueChange={setEspForm}>
                  <SelectTrigger className="bg-secondary border-border"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {ESPECIALIDADES.map((e) => (<SelectItem key={e} value={e}>{e}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Especialidade Secundária</Label>
                <Select value={espSecForm || "nenhuma"} onValueChange={(v) => setEspSecForm(v === "nenhuma" ? "" : v)}>
                  <SelectTrigger className="bg-secondary border-border"><SelectValue placeholder="Opcional" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nenhuma">Nenhuma</SelectItem>
                    {ESPECIALIDADES.filter(e => e !== espForm).map((e) => (<SelectItem key={e} value={e}>{e}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Descrição</Label>
              <Textarea placeholder="Descrição opcional" value={descricao} onChange={(e) => setDescricao(e.target.value)} className="bg-secondary border-border" rows={3} />
            </div>
            <div className="space-y-2">
              <Label>Valor de Referência (R$)</Label>
              <Input type="number" step="0.01" min="0" placeholder="0,00" value={valorReferencia} onChange={(e) => setValorReferencia(e.target.value)} className="bg-secondary border-border" />
            </div>
            <Button type="submit" disabled={saving} className="w-full gradient-orange text-primary-foreground font-semibold shadow-orange hover:opacity-90">
              {saving ? "Salvando..." : editingId ? "Atualizar" : "Cadastrar"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TiposProcedimento;
