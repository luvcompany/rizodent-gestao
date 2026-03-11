import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Eye, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface PacienteView {
  id: string;
  nome: string;
  telefone: string;
  cidade: string | null;
  created_at: string;
  total_pago: number;
  valor_contratado: number;
  ultima_visita: string | null;
  clinica_nome: string | null;
}

const FILTROS_PERIODO = [
  { label: "Todos", value: "todos" },
  { label: "Últimos 7 dias", value: "7" },
  { label: "Últimos 15 dias", value: "15" },
  { label: "Últimos 30 dias", value: "30" },
  { label: "Últimos 60 dias", value: "60" },
  { label: "Últimos 90 dias", value: "90" },
];

const Pacientes = () => {
  const [busca, setBusca] = useState("");
  const [periodo, setPeriodo] = useState("todos");
  const [pacientes, setPacientes] = useState<PacienteView[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchPacientes = async () => {
      setLoading(true);

      // Build date filter
      let dataMinima: string | null = null;
      if (periodo !== "todos") {
        const d = new Date();
        d.setDate(d.getDate() - Number(periodo));
        dataMinima = d.toISOString().split("T")[0];
      }

      const { data: pacs } = await supabase
        .from("pacientes")
        .select("id, nome, telefone, cidade, created_at")
        .order("created_at", { ascending: false });

      if (!pacs) { setLoading(false); return; }

      const result: PacienteView[] = [];
      for (const p of pacs) {
        // Tratamentos (valor contratado)
        const { data: tratData } = await supabase
          .from("tratamentos")
          .select("valor_contratado")
          .eq("paciente_id", p.id);

        const valorContratado = tratData?.reduce((sum, t) => sum + Number(t.valor_contratado || 0), 0) || 0;

        // Pagamentos
        let pagQuery = supabase
          .from("pagamentos")
          .select("valor, data_pagamento, clinica_id")
          .eq("paciente_id", p.id);

        if (dataMinima) {
          pagQuery = pagQuery.gte("data_pagamento", dataMinima);
        }

        const { data: allPag } = await pagQuery.order("data_pagamento", { ascending: false });

        const totalPago = allPag?.reduce((sum, pg) => sum + Number(pg.valor), 0) || 0;
        const ultimaVisita = allPag?.[0]?.data_pagamento || null;

        let clinicaNome: string | null = null;
        if (allPag?.[0]?.clinica_id) {
          const { data: cl } = await supabase
            .from("clinicas")
            .select("nome")
            .eq("id", allPag[0].clinica_id)
            .maybeSingle();
          clinicaNome = cl?.nome || null;
        }

        // If filtering by date, only show patients that have payments in the period
        if (dataMinima && (!allPag || allPag.length === 0)) continue;

        result.push({
          ...p,
          total_pago: totalPago,
          valor_contratado: valorContratado,
          ultima_visita: ultimaVisita,
          clinica_nome: clinicaNome,
        });
      }
      setPacientes(result);
      setLoading(false);
    };
    fetchPacientes();
  }, [periodo]);

  const filtered = pacientes.filter(
    (p) =>
      p.nome.toLowerCase().includes(busca.toLowerCase()) ||
      p.telefone.includes(busca)
  );

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Pacientes</h1>
          <p className="text-sm text-muted-foreground">{pacientes.length} pacientes cadastrados</p>
        </div>
        <Button
          onClick={() => navigate("/atendimento")}
          className="gradient-orange text-primary-foreground shadow-orange hover:opacity-90 transition-opacity"
        >
          <Plus size={18} className="mr-2" />
          Novo Atendimento
        </Button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou telefone..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="bg-secondary border-border pl-10"
          />
        </div>
        <Select value={periodo} onValueChange={setPeriodo}>
          <SelectTrigger className="w-full sm:w-[200px] bg-secondary border-border">
            <SelectValue placeholder="Período" />
          </SelectTrigger>
          <SelectContent>
            {FILTROS_PERIODO.map((f) => (
              <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="text-center text-muted-foreground animate-pulse py-12">Carregando pacientes...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">Nenhum paciente encontrado.</div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((pac) => (
            <Card key={pac.id} className="gradient-card border-border shadow-card hover:border-primary/30 transition-colors">
              <CardContent className="flex items-center justify-between p-4">
                <div className="space-y-1">
                  <p className="font-semibold">{pac.nome}</p>
                  <p className="text-sm text-muted-foreground">
                    {pac.telefone} {pac.clinica_nome && `• ${pac.clinica_nome}`}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right space-y-0.5">
                    <p className="text-xs text-muted-foreground">
                      Contratado: R$ {pac.valor_contratado.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </p>
                    <p className="text-sm font-semibold text-primary">
                      Pago: R$ {pac.total_pago.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </p>
                    {pac.ultima_visita && (
                      <p className="text-xs text-muted-foreground">
                        Última visita: {new Date(pac.ultima_visita).toLocaleDateString("pt-BR")}
                      </p>
                    )}
                  </div>
                  <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground" onClick={() => navigate(`/pacientes/${pac.id}`)}>
                    <Eye size={18} />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default Pacientes;
