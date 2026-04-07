import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface PipelineStageSelectorProps {
  stages: { id: string; name: string; color: string; pipeline_id: string }[];
  currentStageId: string;
  onStageChange: (stageId: string) => void;
}

export default function PipelineStageSelector({ stages, currentStageId, onStageChange }: PipelineStageSelectorProps) {
  const [pipelines, setPipelines] = useState<{ id: string; name: string }[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState("");

  useEffect(() => {
    supabase.from("crm_pipelines").select("id, name").then(({ data }) => {
      if (data) {
        setPipelines(data);
        const currentStage = stages.find(s => s.id === currentStageId);
        if (currentStage) setSelectedPipelineId(currentStage.pipeline_id);
      }
    });
  }, [currentStageId, stages]);

  const filteredStages = useMemo(
    () => selectedPipelineId ? stages.filter(s => s.pipeline_id === selectedPipelineId) : stages,
    [selectedPipelineId, stages]
  );

  return (
    <div className="mt-3 mb-3 space-y-2">
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Funil</label>
        <Select value={selectedPipelineId} onValueChange={(val) => {
          setSelectedPipelineId(val);
        }}>
          <SelectTrigger className="bg-secondary border-border h-8 text-sm">
            <SelectValue placeholder="Selecione o funil" />
          </SelectTrigger>
          <SelectContent>
            {pipelines.map(p => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Etapa do Funil</label>
        <Select value={currentStageId} onValueChange={onStageChange}>
          <SelectTrigger className="bg-secondary border-border h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {filteredStages.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                  {s.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
