import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Eye, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";

const mockPacientes = [
  { id: "1", nome: "Maria Silva", telefone: "(11) 99999-1234", clinica: "Clínica SP", ultimaVisita: "2026-03-08", totalGasto: 8500 },
  { id: "2", nome: "João Santos", telefone: "(11) 99999-5678", clinica: "Clínica RJ", ultimaVisita: "2026-03-05", totalGasto: 12300 },
  { id: "3", nome: "Ana Oliveira", telefone: "(21) 98888-4321", clinica: "Clínica BH", ultimaVisita: "2026-02-28", totalGasto: 3200 },
  { id: "4", nome: "Carlos Pereira", telefone: "(41) 97777-8765", clinica: "Clínica Curitiba", ultimaVisita: "2026-03-10", totalGasto: 15600 },
  { id: "5", nome: "Fernanda Lima", telefone: "(51) 96666-3456", clinica: "Clínica Porto Alegre", ultimaVisita: "2026-03-01", totalGasto: 5400 },
];

const Pacientes = () => {
  const [busca, setBusca] = useState("");
  const navigate = useNavigate();

  const filtered = mockPacientes.filter(
    (p) =>
      p.nome.toLowerCase().includes(busca.toLowerCase()) ||
      p.telefone.includes(busca)
  );

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Pacientes</h1>
          <p className="text-sm text-muted-foreground">{mockPacientes.length} pacientes cadastrados</p>
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

      <div className="grid gap-3">
        {filtered.map((pac) => (
          <Card key={pac.id} className="gradient-card border-border shadow-card hover:border-primary/30 transition-colors">
            <CardContent className="flex items-center justify-between p-4">
              <div className="space-y-1">
                <p className="font-semibold">{pac.nome}</p>
                <p className="text-sm text-muted-foreground">{pac.telefone} • {pac.clinica}</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="text-sm font-semibold text-primary">R$ {pac.totalGasto.toLocaleString("pt-BR")}</p>
                  <p className="text-xs text-muted-foreground">Última visita: {new Date(pac.ultimaVisita).toLocaleDateString("pt-BR")}</p>
                </div>
                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
                  <Eye size={18} />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default Pacientes;
