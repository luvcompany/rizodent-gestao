import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, TrendingUp, CalendarDays } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Tables } from "@/integrations/supabase/types";

const CadastroLeads = () => {
  const { user } = useAuth();
  const [clinicas, setClinicas] = useState<Tables<"clinicas">[]>([]);
  const [clinicaId, setClinicaId] = useState("");
  const [data, setData] = useState(() => new Date().toISOString().split("T")[0]);
  const [leadsNovos, setLeadsNovos] = useState("");
  const [agendaram, setAgendaram] = useState("");
  const [faltaram, setFaltaram] = useState("");
  const [contrataram, setContrataram] = useState("");
  const [naoContrataram, setNaoContrataram] = useState("");
  const [saving, setSaving] = useState(false);
  const [existingId, setExistingId] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("clinicas").select("*").eq("ativa", true).then(({ data }) => {
      if (data) setClinicas(data);
    });
  }, []);

  // Check if record exists for date+clinic
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
          setFaltaram(String(existing.faltaram));
          setContrataram(String(existing.contrataram));
          setNaoContrataram(String(existing.nao_contrataram));
        } else {
          setExistingId(null);
          setLeadsNovos(""); setAgendaram(""); setFaltaram("");
          setContrataram(""); setNaoContrataram("");
        }
      });
  }, [clinicaId, data]);

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
        faltaram: parseInt(faltaram) || 0,
        contrataram: parseInt(contrataram) || 0,
        nao_contrataram: parseInt(naoContrataram) || 0,
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
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Cadastro de Leads Diário</h1>
        <p className="text-sm text-muted-foreground">Preencha os dados do funil de vendas</p>
      </div>

      <Card className="gradient-card border-border shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp size={18} className="text-primary" />
            Dados do Funil
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

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Leads Novos</Label>
                <Input type="number" min="0" placeholder="0" value={leadsNovos} onChange={(e) => setLeadsNovos(e.target.value)} className="bg-secondary border-border" />
              </div>
              <div className="space-y-2">
                <Label>Agendaram</Label>
                <Input type="number" min="0" placeholder="0" value={agendaram} onChange={(e) => setAgendaram(e.target.value)} className="bg-secondary border-border" />
              </div>
              <div className="space-y-2">
                <Label>Faltaram</Label>
                <Input type="number" min="0" placeholder="0" value={faltaram} onChange={(e) => setFaltaram(e.target.value)} className="bg-secondary border-border" />
              </div>
              <div className="space-y-2">
                <Label>Contrataram</Label>
                <Input type="number" min="0" placeholder="0" value={contrataram} onChange={(e) => setContrataram(e.target.value)} className="bg-secondary border-border" />
              </div>
              <div className="space-y-2">
                <Label>Não Contrataram</Label>
                <Input type="number" min="0" placeholder="0" value={naoContrataram} onChange={(e) => setNaoContrataram(e.target.value)} className="bg-secondary border-border" />
              </div>
            </div>

            <Button type="submit" disabled={saving} className="w-full gradient-orange text-primary-foreground font-semibold shadow-orange hover:opacity-90 transition-opacity">
              <Save size={18} className="mr-2" />
              {saving ? "Salvando..." : existingId ? "Atualizar Dados" : "Salvar Dados"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default CadastroLeads;
