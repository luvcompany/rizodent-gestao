import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileBarChart } from "lucide-react";

const Relatorios = () => {
  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Relatórios Financeiros</h1>
        <p className="text-sm text-muted-foreground">Relatórios detalhados de faturamento</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {["Faturamento Mensal", "Faturamento por Clínica", "Faturamento por Procedimento", "Pagamentos Recebidos", "Orçamentos x Contratos", "Inadimplência"].map((title) => (
          <Card key={title} className="gradient-card border-border shadow-card cursor-pointer hover:border-primary/30 transition-colors">
            <CardHeader className="flex flex-row items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2">
                <FileBarChart size={20} className="text-primary" />
              </div>
              <CardTitle className="text-sm font-medium">{title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">Clique para visualizar o relatório completo</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default Relatorios;
