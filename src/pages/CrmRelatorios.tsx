import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import RelatorioAgendamentos from "@/components/relatorios/RelatorioAgendamentos";

// Relatórios reconstruídos do zero. As abas antigas (Origem dos leads, Funis)
// continuam em src/components/relatorios, mas não aparecem mais aqui.
export default function CrmRelatorios() {
  return (
    <div className="px-2 py-2 sm:p-4 lg:p-6 space-y-6 max-w-[1600px] mx-auto">
      <h1 className="text-[28px] sm:text-[32px] font-bold leading-tight tracking-tight text-foreground">Relatórios</h1>

      <Tabs defaultValue="agendamentos" className="w-full">
        <TabsList variant="pill" className="w-full sm:w-auto rounded-xl lg:rounded-full border border-border/60 bg-card p-1.5 shadow-card">
          <TabsTrigger value="agendamentos">Agendamentos</TabsTrigger>
        </TabsList>
        <TabsContent value="agendamentos" className="mt-6">
          <RelatorioAgendamentos />
        </TabsContent>
      </Tabs>
    </div>
  );
}
