import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Megaphone } from "lucide-react";
import { PageHeader } from "@/components/crm-ui";

const Marketing = () => {
  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader title="Relatórios de marketing" subtitle="Análise de campanhas e origem de leads" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {["ROI por Campanha", "Origem dos Leads", "Conversão por Anúncio", "Custo por Aquisição", "Performance por Canal", "Comparativo Mensal"].map((title) => (
          <Card key={title} className="cursor-pointer border-border/60 bg-card transition-colors hover:border-primary/30">
            <CardHeader className="flex flex-row items-center gap-3">
              <div className="rounded-xl bg-primary-soft p-2.5">
                <Megaphone size={20} className="text-primary" />
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

export default Marketing;
