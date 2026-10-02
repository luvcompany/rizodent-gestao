import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import OrigemConversaoTab from "@/components/relatorios/OrigemConversaoTab";
import FunilTab from "@/components/relatorios/FunilTab";
import CompararFunisTab from "@/components/relatorios/CompararFunisTab";

type Pipeline = { id: string; name: string };

// Três abas, sem repetir o que já existe em outras telas:
//  - Origem dos leads: canal/anúncio → atendido → agendado → fechado.
//  - Funis: onde o funil trava (por etapa) + comparação de funis (ganhos/perdas).
//  - Equipe: velocidade de resposta e resultado de cada pessoa.
// Faturamento fica nos Relatórios do Sistema; desempenho detalhado de SDR no Relatório das SDRs.
export default function CrmRelatorios() {
  const { userRole } = useAuth();
  const podeCompararFunis = ["gerente", "crc", "superadmin"].includes(userRole ?? "");
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [pipelineId, setPipelineId] = useState<string>("");

  useEffect(() => {
    supabase.from("crm_pipelines").select("id, name")
      .order("position", { ascending: true, nullsFirst: false }).order("created_at")
      .then(({ data }) => {
        const list = (data || []) as Pipeline[];
        setPipelines(list);
        if (list.length) setPipelineId((prev) => prev || "todos");
      });
  }, []);

  return (
    <div className="px-2 py-2 sm:p-4 lg:p-6 space-y-6 max-w-[1600px] mx-auto">
      <h1 className="text-[28px] sm:text-[32px] font-bold leading-tight tracking-tight text-foreground">Relatórios</h1>

      <Tabs defaultValue="origem" className="w-full">
        <TabsList variant="pill" className="w-full sm:w-auto rounded-xl lg:rounded-full border border-border/60 bg-card p-1.5 shadow-card">
          <TabsTrigger value="origem">Origem dos leads</TabsTrigger>
          <TabsTrigger value="funis">Funis</TabsTrigger>
        </TabsList>

        <TabsContent value="origem" className="mt-6">
          <OrigemConversaoTab pipelineId={pipelineId} pipelines={pipelines} setPipelineId={setPipelineId} />
        </TabsContent>

        <TabsContent value="funis" className="mt-6 space-y-8">
          <FunilTab pipelines={pipelines} pipelineId={pipelineId} />
          {podeCompararFunis && (
            <section className="space-y-4">
              <h2 className="text-lg font-semibold text-foreground">Comparar funis</h2>
              <CompararFunisTab />
            </section>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
