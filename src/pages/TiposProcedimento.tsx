import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Pencil, ToggleLeft, ToggleRight, Stethoscope } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type TipoProcedimento = {
  id: string;
  nome: string;
  descricao: string | null;
  valor_referencia: number | null;
  ativo: boolean;
  created_at: string;
};

const TiposProcedimento = () => {
  const [procedimentos, setProcedimentos] = useState<TipoProcedimento[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [valorReferencia, setValorReferencia] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("tipos_procedimento")
      .select("*")
      .order("nome");
    setProcedimentos((data as TipoProcedimento[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const resetForm = () => {
    setNome("");
    setDescricao("");
    setValorReferencia("");
    setEditingId(null);
  };

  const openEdit = (p: TipoProcedimento) => {
    setEditingId(p.id);
    setNome(p.nome);
    setDescricao(p.descricao || "");
    setValorReferencia(p.valor_referencia?.toString() || "");
    setDialogOpen(true);
  };

  const openNew = () => {
    resetForm();
    setDialogOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) {
      toast.error("Informe o nome do procedimento");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        nome: nome.trim(),
        descricao: descricao.trim() || null,
        valor_referencia: valorReferencia ? parseFloat(valorReferencia) : 0,
      };

      if (editingId) {
        const { error } = await supabase
          .from("tipos_procedimento")
          .update(payload)
          .eq("id", editingId);
        if (error) throw error;
        toast.success("Procedimento atualizado!");
      } else {
        const { error } = await supabase
          .from("tipos_procedimento")
          .insert(payload);
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
      const { error } = await supabase
        .from("tipos_procedimento")
        .update({ ativo: !p.ativo })
        .eq("id", p.id);
      if (error) throw error;
      toast.success(p.ativo ? "Procedimento desativado" : "Procedimento ativado");
      fetchData();
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    }
  };

  const formatCurrency = (val: number | null) =>
    val != null
      ? val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
      : "—";

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tipos de Procedimento</h1>
          <p className="text-sm text-muted-foreground">
            Cadastre e gerencie os procedimentos oferecidos pela clínica
          </p>
        </div>
        <Button onClick={openNew} className="gradient-orange text-primary-foreground font-semibold shadow-orange hover:opacity-90">
          <Plus size={16} className="mr-2" />
          Novo Procedimento
        </Button>
      </div>

      <Card className="gradient-card border-border shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Stethoscope size={18} className="text-primary" />
            Procedimentos Cadastrados
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground text-sm">Carregando...</p>
          ) : procedimentos.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhum procedimento cadastrado.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Valor Ref.</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {procedimentos.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.nome}</TableCell>
                      <TableCell className="text-muted-foreground max-w-[200px] truncate">
                        {p.descricao || "—"}
                      </TableCell>
                      <TableCell>{formatCurrency(p.valor_referencia)}</TableCell>
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
