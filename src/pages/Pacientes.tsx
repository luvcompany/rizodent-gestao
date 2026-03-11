import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Eye, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

interface PacienteView {
  id: string;
  nome: string;
  telefone: string;
  cidade: string | null;
  created_at: string;
  total_pago: number;
  ultima_visita: string | null;
  clinica_nome: string | null;
}

const Pacientes = () => {
  const [busca, setBusca] = useState("");
  const [pacientes, setPacientes] = useState<PacienteView[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchPacientes = async () => {
      const { data: pacs } = await supabase
        .from("pacientes")
        .select("id, nome, telefone, cidade, created_at")
        .order("created_at", { ascending: false });

      if (!pacs) { setLoading(false); return; }

      // Get aggregated payment data
      const result: PacienteView[] = [];
      for (const p of pacs) {
        const { data: pagData } = await supabase
          .from("pagamentos")
          .select("valor, data_pagamento, clinica_id")
          .eq("paciente_id", p.id)
          .order("data_pagamento", { ascending: false })
          .limit(1);

        const { data: totalData } = await supabase
          .from("pagamentos")
          .select("valor")
          .eq("paciente_id", p.id);

        const total = totalData?.reduce((sum, pg) => sum + Number(pg.valor), 0) || 0;

        let clinicaNome: string | null = null;
        if (pagData?.[0]?.clinica_id) {
          const { data: cl } = await supabase
            .from("clinicas")
            .select("nome")
            .eq("id", pagData[0].clinica_id)
            .maybeSingle();
          clinicaNome = cl?.nome || null;
        }

        result.push({
          ...p,
          total_pago: total,
          ultima_visita: pagData?.[0]?.data_pagamento || null,
          clinica_nome: clinicaNome,
        });
      }
      setPacientes(result);
      setLoading(false);
    };
    fetchPacientes();
  }, []);

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

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome ou telefone..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="bg-secondary border-border pl-10"
        />
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
                  <div className="text-right">
                    <p className="text-sm font-semibold text-primary">
                      R$ {pac.total_pago.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
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
