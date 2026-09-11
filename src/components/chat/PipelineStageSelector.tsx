import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle } from "lucide-react";

interface PipelineStageSelectorProps {
  stages: { id: string; name: string; color: string; pipeline_id: string }[];
  currentStageId: string;
  onStageChange: (stageId: string, pipelineId: string) => void;
  /**
   * Funil em que o lead está AGORA, direto da linha do lead. É opcional porque
   * nem toda tela passa, mas é a única fonte confiável: a etapa atual pode não
   * estar em `stages` (a SDR só lê etapas com visivel_para_sdr = true), e aí
   * derivar o funil pela etapa devolve "não sei".
   */
  currentPipelineId?: string;
}

/**
 * Seletor de funil + etapa do painel da conversa.
 *
 * Regra que este componente precisa deixar explícita: trocar o combo "Funil"
 * NÃO move o lead. Ele só troca a lista de etapas exibida — quem grava é a
 * escolha da ETAPA de destino. Sem esse aviso, a pessoa trocava o funil, via o
 * nome do funil novo na tela, saía da conversa e jurava ter movido o lead.
 */
export default function PipelineStageSelector({ stages, currentStageId, onStageChange, currentPipelineId }: PipelineStageSelectorProps) {
  const [pipelines, setPipelines] = useState<{ id: string; name: string }[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState("");
  const pipelinesCarregados = useRef(false);

  // Funil do lead: a prop manda; a etapa atual é só o plano B (e falha quando a
  // etapa está oculta para o perfil).
  const funilDoLead = useMemo(
    () => currentPipelineId || stages.find((s) => s.id === currentStageId)?.pipeline_id || "",
    [currentPipelineId, stages, currentStageId],
  );

  // Lista de funis: uma busca por montagem. Antes isso rodava a cada mudança de
  // `stages`/etapa e, ao terminar, reescrevia o funil escolhido — uma corrida
  // que devolvia o combo ao funil de origem depois de a pessoa já ter trocado.
  useEffect(() => {
    if (pipelinesCarregados.current) return;
    pipelinesCarregados.current = true;
    supabase.from("crm_pipelines").select("id, name").order("name").then(({ data }) => {
      if (data) setPipelines(data);
    });
  }, []);

  // Sincroniza o combo com o funil do lead quando o lead muda ou quando a etapa
  // gravada muda (ou seja: depois de uma gravação confirmada). Nunca por causa
  // de uma resposta de rede atrasada.
  useEffect(() => {
    setSelectedPipelineId(funilDoLead);
  }, [currentStageId, funilDoLead]);

  const etapasDoFunilEscolhido = useMemo(
    () => (selectedPipelineId ? stages.filter((s) => s.pipeline_id === selectedPipelineId) : []),
    [selectedPipelineId, stages],
  );

  const nomeFunil = (id: string) => pipelines.find((p) => p.id === id)?.name || "";
  const trocandoDeFunil = !!selectedPipelineId && !!funilDoLead && selectedPipelineId !== funilDoLead;
  const etapaAtualVisivel = etapasDoFunilEscolhido.some((s) => s.id === currentStageId);

  return (
    <div className="mt-3 mb-3 space-y-2">
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Funil</label>
        <Select value={selectedPipelineId} onValueChange={(val) => setSelectedPipelineId(val)}>
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

      {/* O aviso em amarelo saiu a pedido da operação: a equipe já sabe que
          precisa escolher a etapa, e o texto repetia a cada troca de funil.
          A orientação continua onde ela é lida de fato — no rótulo e no
          placeholder do seletor de etapa logo abaixo, que passam a dizer
          "destino" enquanto a troca não foi concluída. */}

      <div>
        <label className="text-xs text-muted-foreground mb-1 block">
          {trocandoDeFunil ? "Etapa de destino" : "Etapa do Funil"}
          {selectedPipelineId && nomeFunil(selectedPipelineId) ? ` · ${nomeFunil(selectedPipelineId)}` : ""}
        </label>
        <Select
          value={etapaAtualVisivel ? currentStageId : ""}
          onValueChange={(val) => onStageChange(val, selectedPipelineId)}
          disabled={etapasDoFunilEscolhido.length === 0}
        >
          <SelectTrigger className="bg-secondary border-border h-8 text-sm">
            <SelectValue placeholder={trocandoDeFunil ? "Escolha a etapa de destino" : "Selecione a etapa"} />
          </SelectTrigger>
          <SelectContent>
            {etapasDoFunilEscolhido.map((s) => (
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

      {/* Lista vazia tem motivo e o motivo precisa aparecer: antes o combo só
          ficava mudo e a pessoa achava que o funil tinha sido trocado. */}
      {!selectedPipelineId && (
        <p className="text-xs text-muted-foreground flex items-start gap-1.5">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>Escolha o funil acima para ver as etapas disponíveis.</span>
        </p>
      )}
      {!!selectedPipelineId && etapasDoFunilEscolhido.length === 0 && (
        <p className="text-xs text-amber-500 flex items-start gap-1.5">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>
            Nenhuma etapa de <strong>{nomeFunil(selectedPipelineId) || "deste funil"}</strong> está liberada para o seu
            perfil, então não dá para mover o lead para lá por aqui. Peça ao gestor para liberar uma etapa desse funil.
          </span>
        </p>
      )}
      {!!selectedPipelineId && etapasDoFunilEscolhido.length > 0 && !etapaAtualVisivel && !trocandoDeFunil && (
        <p className="text-xs text-muted-foreground flex items-start gap-1.5">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>A etapa atual do lead não está liberada para o seu perfil — por isso o campo aparece vazio.</span>
        </p>
      )}
    </div>
  );
}
