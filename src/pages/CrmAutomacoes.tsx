import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { Plus, Trash2, Bot, Zap, GripVertical, ShieldAlert, AlertTriangle, RefreshCw } from "lucide-react";

type Pipeline = { id: string; name: string; color?: string; description?: string };
type Stage = { id: string; pipeline_id: string; name: string; color: string; position: number };
type Automation = {
  id: string; stage_id: string; trigger_type: string; action_type: string;
  action_config: Record<string, unknown>; is_active: boolean;
};
type Template = { id: string; name: string; status: string };
type FunnelChannel = { id: string; pipeline_id: string; channel_type: string; channel_config: Record<string, unknown> | null };
type BotItem = { id: string; name: string; active: boolean };
type StageBotConfig = { id: string; stage_id: string; bot_id: string | null; trigger_type: string; active: boolean; is_final_stage: boolean };
type FollowUpCfg = { id: string; stage_id: string; is_active: boolean; disparo1_type: string; disparo1_delay_minutes: number; max_attempts: number };

const PRESET_COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16",
  "#22c55e", "#10b981", "#14b8a6", "#06b6d4", "#0ea5e9",
  "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#d946ef",
  "#ec4899", "#f43f5e", "#78716c", "#64748b", "#1e293b",
];

// No auto-final names - user controls is_final_stage manually

export default function CrmAutomacoes() {
  const navigate = useNavigate();
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState("");
  const [stages, setStages] = useState<Stage[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [channels, setChannels] = useState<FunnelChannel[]>([]);
  const [allBots, setAllBots] = useState<BotItem[]>([]);
  const [stageBotConfigs, setStageBotConfigs] = useState<StageBotConfig[]>([]);
  const [followUpConfigs, setFollowUpConfigs] = useState<FollowUpCfg[]>([]);
  const [loading, setLoading] = useState(true);
  const [duplicateRulesOpen, setDuplicateRulesOpen] = useState(false);
  const [duplicateEnabled, setDuplicateEnabled] = useState(false);
  const [duplicateRules, setDuplicateRules] = useState({ checkPhone: true, checkName: false, action: "block" as "block" | "merge" | "notify" });

  const [newStageOpen, setNewStageOpen] = useState(false);
  const [newStageName, setNewStageName] = useState("");
  const [newStageColor, setNewStageColor] = useState("#6366f1");
  const [useCustomStageColor, setUseCustomStageColor] = useState(false);

  const [autoModalOpen, setAutoModalOpen] = useState(false);
  const [autoForm, setAutoForm] = useState({
    stage_id: "", trigger_type: "on_enter", action_type: "send_template",
    action_config: {} as Record<string, unknown>, editId: ""
  });

  const [deleteStageId, setDeleteStageId] = useState<string | null>(null);
  const [newPipelineOpen, setNewPipelineOpen] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState("");
  const [newPipelineColor, setNewPipelineColor] = useState("#6366f1");
  const [useCustomPipelineColor, setUseCustomPipelineColor] = useState(false);

  // Expanded bot config per stage
  const [expandedStageId, setExpandedStageId] = useState<string | null>(null);
  const [applyToAll, setApplyToAll] = useState<Record<string, boolean>>({});
  const [leaveUnread, setLeaveUnread] = useState<Record<string, boolean>>({});

  const fetchData = useCallback(async (pipeId?: string) => {
    setLoading(true);
    const { data: pipeData } = await supabase.from("crm_pipelines").select("*").order("created_at");
    const pipes = (pipeData as Pipeline[]) || [];
    setPipelines(pipes);
    const pid = pipeId || selectedPipelineId || pipes[0]?.id;
    if (pid) {
      setSelectedPipelineId(pid);
      const [stagesRes, autoRes, tplRes, chRes, botsRes, sbcRes, fuRes] = await Promise.all([
        supabase.from("crm_stages").select("*").eq("pipeline_id", pid).order("position"),
        supabase.from("crm_automations").select("*"),
        supabase.from("crm_whatsapp_templates").select("id, name, status").eq("status", "APPROVED"),
        supabase.from("funnel_channels").select("*").eq("pipeline_id", pid),
        supabase.from("bots").select("id, name, active"),
        supabase.from("stage_bot_config").select("*"),
        supabase.from("crm_followup_configs").select("id, stage_id, is_active, disparo1_type, disparo1_delay_minutes, max_attempts"),
      ]);
      setStages((stagesRes.data as Stage[]) || []);
      setAutomations((autoRes.data as Automation[]) || []);
      setTemplates((tplRes.data as Template[]) || []);
      setChannels((chRes.data as FunnelChannel[]) || []);
      setAllBots((botsRes.data as BotItem[]) || []);
      setStageBotConfigs((sbcRes.data as StageBotConfig[]) || []);
      setFollowUpConfigs((fuRes.data as FollowUpCfg[]) || []);
    }
    setLoading(false);
  }, [selectedPipelineId]);

  useEffect(() => { fetchData(); }, []);

  const handleStageDragEnd = async (result: DropResult) => {
    if (!result.destination) return;
    const fromIdx = result.source.index;
    const toIdx = result.destination.index;
    if (fromIdx === toIdx) return;
    const reordered = [...stages];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    setStages(reordered);
    for (let i = 0; i < reordered.length; i++) {
      await supabase.from("crm_stages").update({ position: i }).eq("id", reordered[i].id);
    }
    toast.success("Ordem das etapas atualizada");
  };

  const handleAddStage = async () => {
    if (!newStageName || !selectedPipelineId) return;
    const { error } = await supabase.from("crm_stages").insert({
      pipeline_id: selectedPipelineId, name: newStageName, color: newStageColor,
      position: stages.length,
    });
    if (error) { toast.error("Erro ao criar etapa"); return; }
    toast.success("Etapa criada");
    setNewStageOpen(false);
    setNewStageName("");
    setNewStageColor("#6366f1");
    setUseCustomStageColor(false);
    fetchData(selectedPipelineId);
  };

  const handleAddPipeline = async () => {
    if (!newPipelineName) return;
    const { data, error } = await supabase.from("crm_pipelines").insert({
      name: newPipelineName, color: newPipelineColor,
    }).select().single();
    if (error) { toast.error("Erro ao criar funil"); return; }
    toast.success("Funil criado");
    setNewPipelineOpen(false);
    setNewPipelineName("");
    setNewPipelineColor("#6366f1");
    setUseCustomPipelineColor(false);
    fetchData(data.id);
  };

  const handleDeleteStage = async () => {
    if (!deleteStageId) return;
    const { error } = await supabase.from("crm_stages").delete().eq("id", deleteStageId);
    if (error) { toast.error("Erro ao excluir etapa. Mova os leads primeiro."); }
    else { toast.success("Etapa excluída"); }
    setDeleteStageId(null);
    fetchData(selectedPipelineId);
  };

  const handleSaveAutomation = async () => {
    const payload = {
      stage_id: autoForm.stage_id,
      trigger_type: autoForm.trigger_type,
      action_type: autoForm.action_type,
      action_config: autoForm.action_config as unknown as import("@/integrations/supabase/types").Json,
    };
    if (autoForm.editId) {
      await supabase.from("crm_automations").update(payload).eq("id", autoForm.editId);
    } else {
      await supabase.from("crm_automations").insert(payload);
    }
    toast.success("Automação salva");
    setAutoModalOpen(false);
    fetchData(selectedPipelineId);
  };

  const handleDeleteAutomation = async (id: string) => {
    await supabase.from("crm_automations").delete().eq("id", id);
    toast.success("Automação removida");
    fetchData(selectedPipelineId);
  };

  const getAutomationsForStage = (stageId: string) => automations.filter(a => a.stage_id === stageId);

  const actionLabel = (type: string) => {
    const map: Record<string, string> = {
      send_template: "Enviar template WhatsApp",
      send_audio: "Enviar áudio",
      move_stage: "Mover para etapa",
      webhook: "Chamar webhook",
    };
    return map[type] || type;
  };

  // ── Save bot config per stage (Kommo style) ──

  const handleSaveSbcFull = async (
    stageId: string,
    updates: Partial<StageBotConfig>,
    shouldApplyToAll: boolean,
  ) => {
    const sbc = stageBotConfigs.find(c => c.stage_id === stageId);
    const payload = {
      stage_id: stageId,
      bot_id: updates.bot_id !== undefined ? (updates.bot_id || null) : (sbc?.bot_id || null),
      trigger_type: updates.trigger_type || sbc?.trigger_type || "on_enter",
      active: updates.active !== undefined ? updates.active : (sbc?.active ?? true),
      is_final_stage: updates.is_final_stage !== undefined ? updates.is_final_stage : (sbc?.is_final_stage ?? false),
    };

    if (sbc) {
      await supabase.from("stage_bot_config").update(payload).eq("id", sbc.id);
    } else {
      await supabase.from("stage_bot_config").insert(payload);
    }

    // Apply to all leads currently in this stage
    if (shouldApplyToAll && payload.bot_id && !payload.is_final_stage) {
      const { data: leads } = await supabase.from("crm_leads").select("id").eq("stage_id", stageId);
      if (leads && leads.length > 0) {
        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bot-trigger`;
        let triggered = 0;
        for (const lead of leads) {
          // Check no active execution
          const { data: active } = await supabase.from("bot_executions")
            .select("id")
            .eq("lead_id", lead.id)
            .eq("status", "active")
            .limit(1);
          if (active && active.length > 0) continue;

          try {
            await fetch(url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
              },
              body: JSON.stringify({ leadId: lead.id, newStageId: stageId }),
            });
            triggered++;
          } catch {}
        }
        toast.success(`Bot disparado para ${triggered} lead(s) na etapa`);
      }
    }

    toast.success("Configuração salva");
    setExpandedStageId(null);
    fetchData(selectedPipelineId);
  };

  if (loading) return <div className="flex items-center justify-center h-screen bg-background"><span className="text-muted-foreground">Carregando...</span></div>;

  return (
    <div className="flex flex-col overflow-hidden bg-background -m-6" style={{ height: "calc(100vh - 4rem)" }}>
      {/* Header */}
      <div className="flex-shrink-0 bg-card border-b border-border px-6 py-3 flex items-center justify-between gap-2 flex-wrap overflow-hidden min-w-0">
        <div className="flex items-center gap-3 min-w-0 flex-wrap">
          <h1 className="text-lg font-bold text-foreground whitespace-nowrap">Configuração do Funil</h1>
          {pipelines.length > 0 && (
            <select
              className="bg-secondary border border-border rounded-md px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              value={selectedPipelineId}
              onChange={(e) => fetchData(e.target.value)}
            >
              {pipelines.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setNewPipelineOpen(true)}>
            <Plus size={14} className="mr-1" /> Novo Funil
          </Button>
          <Button variant="outline" size="sm" onClick={() => setNewStageOpen(true)}>
            <Plus size={14} className="mr-1" /> Nova Etapa
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left panel - Lead sources */}
        <div className="w-[280px] bg-card border-r border-border p-4 flex-shrink-0 overflow-y-auto">
          <h2 className="font-semibold text-sm text-foreground mb-4">Fontes de Lead</h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-foreground">Etapa de leads de entrada</div>
                <div className="text-xs text-muted-foreground">Leads entram na primeira etapa</div>
              </div>
              <Switch defaultChecked />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-foreground">Controle duplicado</div>
                <button onClick={() => setDuplicateRulesOpen(true)} className="text-xs text-primary cursor-pointer hover:underline">Configurar regras</button>
              </div>
              <Switch checked={duplicateEnabled} onCheckedChange={setDuplicateEnabled} />
            </div>
            <hr className="border-border" />
            <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Fontes conectadas</div>
            {channels.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhuma fonte conectada a este funil.</p>
            ) : channels.map(ch => {
              const icons: Record<string, string> = { whatsapp: "💬", instagram: "📸", facebook: "📘", manual: "✋", website: "🌐" };
              return (
                <div key={ch.id} className="flex items-center justify-between py-1.5">
                  <div className="flex items-center gap-2 text-sm text-foreground">
                    <span>{icons[ch.channel_type] || "📡"}</span> {ch.channel_type.charAt(0).toUpperCase() + ch.channel_type.slice(1)}
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-green-400 bg-green-900/30 px-1.5 py-0.5 rounded">Ativo</span>
                    <button onClick={async () => {
                      await supabase.from("funnel_channels").delete().eq("id", ch.id);
                      toast.success("Fonte removida");
                      fetchData(selectedPipelineId);
                    }}><Trash2 size={12} className="text-destructive cursor-pointer" /></button>
                  </div>
                </div>
              );
            })}
            <button
              onClick={async () => {
                const type = prompt("Tipo da fonte (whatsapp, instagram, facebook, manual, website):");
                if (!type || !selectedPipelineId) return;
                await supabase.from("funnel_channels").insert({ pipeline_id: selectedPipelineId, channel_type: type.toLowerCase() });
                toast.success("Fonte adicionada");
                fetchData(selectedPipelineId);
              }}
              className="w-full text-sm text-primary bg-primary/10 hover:bg-primary/20 rounded py-2 flex items-center justify-center gap-1 mt-2 transition-colors"
            >
              <Plus size={14} /> Adicionar fonte
            </button>
          </div>
        </div>

        {/* Main content area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Stages horizontal with drag reorder */}
          <div className="flex-shrink-0 overflow-x-auto p-6 border-b border-border">
            <DragDropContext onDragEnd={handleStageDragEnd}>
              <Droppable droppableId="stages-list" direction="horizontal">
                {(provided) => (
                  <div ref={provided.innerRef} {...provided.droppableProps} className="flex gap-4 items-start min-w-max">
                    {stages.map((stage, idx) => {
                      const stageAutos = getAutomationsForStage(stage.id);
                      return (
                        <Draggable key={stage.id} draggableId={stage.id} index={idx}>
                          {(prov, snap) => (
                            <div
                              ref={prov.innerRef}
                              {...prov.draggableProps}
                              className={`w-[240px] flex-shrink-0 bg-card rounded-lg border border-border overflow-hidden ${snap.isDragging ? "shadow-orange ring-2 ring-primary" : ""}`}
                            >
                              <div className="h-1.5" style={{ backgroundColor: stage.color }} />
                              <div className="p-3">
                                <div className="flex items-center justify-between mb-1">
                                  <div className="flex items-center gap-1">
                                    <span {...prov.dragHandleProps} className="cursor-grab text-muted-foreground hover:text-foreground">
                                      <GripVertical size={14} />
                                    </span>
                                    <span className="font-semibold text-sm text-foreground">{stage.name}</span>
                                  </div>
                                  <button onClick={() => setDeleteStageId(stage.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                                <div className="text-xs text-primary cursor-pointer mb-3">{stageAutos.length} automação(ões)</div>

                                <div className="space-y-2">
                                  {stageAutos.map(auto => (
                                    <div key={auto.id} className="bg-primary/10 border border-primary/20 rounded p-2 text-xs">
                                      <div className="flex items-center gap-1 text-primary mb-1">
                                        <Bot size={12} />
                                        <span className="font-medium">{auto.trigger_type === "on_enter" ? "Ao mover" : "Ao criar"}</span>
                                      </div>
                                      <div className="text-foreground">{actionLabel(auto.action_type)}</div>
                                      <div className="flex items-center gap-1 mt-1">
                                        <button onClick={() => handleDeleteAutomation(auto.id)} className="text-destructive/70 hover:text-destructive">
                                          <Trash2 size={10} />
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                  <button
                                    onClick={() => {
                                      setExpandedStageId(expandedStageId === stage.id ? null : stage.id);
                                    }}
                                    className="w-full text-xs text-primary bg-primary/10 hover:bg-primary/20 rounded py-1.5 flex items-center justify-center gap-1 transition-colors"
                                  >
                                    <Plus size={12} /> Adicionar gatilho
                                  </button>

                                  {/* Follow Up - simple dropdown */}
                                  {(() => {
                                    const stageFollowUp = followUpConfigs.find(f => f.stage_id === stage.id);
                                    return (
                                      <div className="flex items-center justify-between bg-amber-500/5 border border-amber-500/20 rounded-lg px-2 py-1.5">
                                        <div className="flex items-center gap-1.5">
                                          <RefreshCw size={11} className="text-amber-500" />
                                          <span className="text-[10px] text-foreground font-medium">Follow Up</span>
                                        </div>
                                        {stageFollowUp ? (
                                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${stageFollowUp.is_active ? "bg-green-500/20 text-green-500" : "bg-muted text-muted-foreground"}`}>
                                            {stageFollowUp.is_active ? "Ativo" : "Inativo"}
                                          </span>
                                        ) : (
                                          <button
                                            onClick={() => navigate("/crm/followups")}
                                            className="text-[10px] text-primary hover:underline"
                                          >
                                            Configurar
                                          </button>
                                        )}
                                      </div>
                                    );
                                  })()}

                                  {/* Inline bot config when expanded */}
                                  {expandedStageId === stage.id && (() => {
                                    const sbc = stageBotConfigs.find(c => c.stage_id === stage.id);
                                    const isFinal = sbc?.is_final_stage ?? false;
                                    const botId = sbc?.bot_id || "";
                                    const triggerType = sbc?.trigger_type || "on_enter";
                                    const isActive = sbc?.active ?? true;

                                    return (
                                      <div className="space-y-3 border-t border-border pt-3 mt-2">
                                        {/* Final stage toggle */}
                                        <div className="flex items-center justify-between">
                                          <span className="text-[10px] text-muted-foreground">Etapa Final</span>
                                          <Switch
                                            checked={isFinal}
                                            onCheckedChange={(v) => handleSaveSbcFull(stage.id, { is_final_stage: v }, false)}
                                          />
                                        </div>

                                        {isFinal ? (
                                          <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/20 rounded-lg p-2">
                                            <AlertTriangle size={12} className="text-destructive shrink-0 mt-0.5" />
                                            <p className="text-[10px] text-destructive">Bots de outras etapas não interferem nesta etapa. Você ainda pode criar bots específicos para ela.</p>
                                          </div>
                                        ) : null}

                                        {/* Salesbot */}
                                        <div>
                                          <Label className="text-xs font-semibold flex items-center gap-1 mb-1">
                                            <Bot size={10} className="text-primary" /> Salesbot / Robô
                                          </Label>
                                          <Select value={botId || "none"} onValueChange={(v) => handleSaveSbcFull(stage.id, { bot_id: v === "none" ? "" : v }, false)}>
                                            <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Nenhum robô" /></SelectTrigger>
                                            <SelectContent>
                                              <SelectItem value="none">Nenhum robô</SelectItem>
                                              {allBots.filter(b => b.active).map(b => (
                                                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                                              ))}
                                            </SelectContent>
                                          </Select>
                                          <button
                                            onClick={() => navigate("/crm/bots")}
                                            className="text-[10px] text-primary hover:underline mt-1 flex items-center gap-1"
                                          >
                                            ou <Plus size={8} /> Criar robô
                                          </button>
                                        </div>

                                        {/* Trigger */}
                                        <div>
                                          <Label className="text-xs font-semibold mb-1">Executar</Label>
                                          <Select value={triggerType} onValueChange={(v) => handleSaveSbcFull(stage.id, { trigger_type: v }, false)}>
                                            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                              <SelectItem value="on_enter">Quando movido para esta etapa</SelectItem>
                                              <SelectItem value="on_create">Quando criado nesta etapa</SelectItem>
                                              <SelectItem value="both">Quando movido ou criado</SelectItem>
                                            </SelectContent>
                                          </Select>
                                        </div>

                                        {/* Active */}
                                        <div className="flex items-center justify-between">
                                          <span className="text-xs text-foreground">Ativo</span>
                                          <Switch checked={isActive} onCheckedChange={(v) => handleSaveSbcFull(stage.id, { active: v }, false)} />
                                        </div>

                                        {/* Leave unread */}
                                        <div className="flex items-start gap-2">
                                          <Switch
                                            checked={leaveUnread[stage.id] ?? false}
                                            onCheckedChange={v => setLeaveUnread(prev => ({ ...prev, [stage.id]: v }))}
                                            className="mt-0.5"
                                          />
                                          <div>
                                            <span className="text-[10px] text-foreground">Deixar mensagem sem resposta</span>
                                            <p className="text-[9px] text-muted-foreground">Mensagens do robô marcadas como não respondidas</p>
                                          </div>
                                        </div>

                                        {/* Apply to all */}
                                        <div className="flex items-start gap-2 bg-muted/50 rounded-lg p-2">
                                          <Checkbox
                                            checked={applyToAll[stage.id] ?? false}
                                            onCheckedChange={v => setApplyToAll(prev => ({ ...prev, [stage.id]: !!v }))}
                                            className="mt-0.5"
                                          />
                                          <span className="text-[10px] text-foreground">Aplicar a todos os leads já nesta etapa</span>
                                        </div>

                                        {/* Action buttons */}
                                        <div className="flex items-center gap-2">
                                          <Button
                                            size="sm"
                                            className="flex-1 text-xs h-7"
                                            onClick={() => handleSaveSbcFull(stage.id, {
                                              bot_id: botId || "",
                                              trigger_type: triggerType,
                                              active: isActive,
                                              is_final_stage: isFinal,
                                            }, applyToAll[stage.id] ?? false)}
                                          >
                                            Finalizado
                                          </Button>
                                          <Button variant="outline" size="sm" className="flex-1 text-xs h-7" onClick={() => setExpandedStageId(null)}>
                                            Cancelar
                                          </Button>
                                        </div>
                                      </div>
                                    );
                                  })()}
                                </div>
                              </div>
                            </div>
                          )}
                        </Draggable>
                      );
                    })}
                    {provided.placeholder}
                    <button
                      onClick={() => setNewStageOpen(true)}
                      className="mt-8 w-10 h-10 rounded-full border-2 border-dashed border-border text-muted-foreground hover:text-primary hover:border-primary flex items-center justify-center flex-shrink-0 transition-colors"
                    >
                      <Plus size={18} />
                    </button>
                  </div>
                )}
              </Droppable>
            </DragDropContext>
          </div>

          {/* Empty spacer */}
          <div className="flex-1" />
        </div>
      </div>

      {/* Modals */}
      <Dialog open={newStageOpen} onOpenChange={(open) => { setNewStageOpen(open); if (!open) setUseCustomStageColor(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Nova Etapa</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nome</Label><Input value={newStageName} onChange={e => setNewStageName(e.target.value)} placeholder="Ex: Qualificação" /></div>
            <div>
              <Label>Cor</Label>
              <div className="grid grid-cols-10 gap-1.5 mt-1">
                {PRESET_COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => { setNewStageColor(c); setUseCustomStageColor(false); }}
                    className={`w-7 h-7 rounded-md border-2 transition-all ${newStageColor === c && !useCustomStageColor ? "border-foreground scale-110" : "border-transparent hover:scale-105"}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <button onClick={() => setUseCustomStageColor(true)} className="text-xs text-muted-foreground hover:text-foreground mt-2 underline">
                Cor personalizada
              </button>
              {useCustomStageColor && (
                <input type="color" value={newStageColor} onChange={e => setNewStageColor(e.target.value)} className="w-full h-8 rounded cursor-pointer mt-1" />
              )}
            </div>
            <Button className="w-full" onClick={handleAddStage}>Criar Etapa</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteStageId} onOpenChange={() => setDeleteStageId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Excluir Etapa?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Todos os leads e automações desta etapa serão excluídos. Deseja continuar?</p>
          <div className="flex gap-2 justify-end mt-4">
            <Button variant="outline" onClick={() => setDeleteStageId(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDeleteStage}>Excluir</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={autoModalOpen} onOpenChange={setAutoModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle><Zap size={16} className="inline mr-1 text-primary" />Configurar Automação</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Evento</Label>
              <Select value={autoForm.trigger_type} onValueChange={v => setAutoForm(p => ({ ...p, trigger_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="on_create">Quando criado nesta etapa</SelectItem>
                  <SelectItem value="on_enter">Quando movido para esta etapa</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Ação</Label>
              <Select value={autoForm.action_type} onValueChange={v => setAutoForm(p => ({ ...p, action_type: v, action_config: {} }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="send_template">Enviar template WhatsApp</SelectItem>
                  <SelectItem value="send_audio">Enviar áudio</SelectItem>
                  <SelectItem value="move_stage">Mover para etapa</SelectItem>
                  <SelectItem value="webhook">Chamar webhook</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {autoForm.action_type === "send_template" && (
              <div>
                <Label>Template</Label>
                <Select value={(autoForm.action_config.template_id as string) || ""} onValueChange={v => setAutoForm(p => ({ ...p, action_config: { template_id: v } }))}>
                  <SelectTrigger><SelectValue placeholder="Selecionar template" /></SelectTrigger>
                  <SelectContent>
                    {templates.length === 0 && <SelectItem value="none" disabled>Nenhum template aprovado</SelectItem>}
                    {templates.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {autoForm.action_type === "move_stage" && (
              <div>
                <Label>Mover para</Label>
                <Select value={(autoForm.action_config.target_stage_id as string) || ""} onValueChange={v => setAutoForm(p => ({ ...p, action_config: { target_stage_id: v } }))}>
                  <SelectTrigger><SelectValue placeholder="Selecionar etapa" /></SelectTrigger>
                  <SelectContent>
                    {stages.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {autoForm.action_type === "webhook" && (
              <div>
                <Label>URL do Webhook</Label>
                <Input placeholder="https://..." value={(autoForm.action_config.url as string) || ""} onChange={e => setAutoForm(p => ({ ...p, action_config: { url: e.target.value } }))} />
              </div>
            )}

            <Button className="w-full" onClick={handleSaveAutomation}>Salvar Automação</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={newPipelineOpen} onOpenChange={(open) => { setNewPipelineOpen(open); if (!open) setUseCustomPipelineColor(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Novo Funil</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nome</Label><Input value={newPipelineName} onChange={e => setNewPipelineName(e.target.value)} placeholder="Ex: Funil de Vendas" /></div>
            <div>
              <Label>Cor</Label>
              <div className="grid grid-cols-10 gap-1.5 mt-1">
                {PRESET_COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => { setNewPipelineColor(c); setUseCustomPipelineColor(false); }}
                    className={`w-7 h-7 rounded-md border-2 transition-all ${newPipelineColor === c && !useCustomPipelineColor ? "border-foreground scale-110" : "border-transparent hover:scale-105"}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <button onClick={() => setUseCustomPipelineColor(true)} className="text-xs text-muted-foreground hover:text-foreground mt-2 underline">
                Cor personalizada
              </button>
              {useCustomPipelineColor && (
                <input type="color" value={newPipelineColor} onChange={e => setNewPipelineColor(e.target.value)} className="w-full h-8 rounded cursor-pointer mt-1" />
              )}
            </div>
            <Button className="w-full" onClick={handleAddPipeline}>Criar Funil</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={duplicateRulesOpen} onOpenChange={setDuplicateRulesOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert size={18} className="text-primary" />
              Regras de Controle de Duplicados
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Configure como o sistema deve identificar e tratar leads duplicados ao entrar no funil.
            </p>
            <div className="space-y-3">
              <Label className="text-sm font-semibold">Critérios de identificação</Label>
              <div className="flex items-center gap-3">
                <Checkbox id="dup-phone" checked={duplicateRules.checkPhone} onCheckedChange={(v) => setDuplicateRules(p => ({ ...p, checkPhone: !!v }))} />
                <label htmlFor="dup-phone" className="text-sm text-foreground cursor-pointer">Mesmo telefone</label>
              </div>
              <div className="flex items-center gap-3">
                <Checkbox id="dup-name" checked={duplicateRules.checkName} onCheckedChange={(v) => setDuplicateRules(p => ({ ...p, checkName: !!v }))} />
                <label htmlFor="dup-name" className="text-sm text-foreground cursor-pointer">Mesmo nome</label>
              </div>
            </div>
            <div>
              <Label className="text-sm font-semibold">Ação ao encontrar duplicado</Label>
              <Select value={duplicateRules.action} onValueChange={(v: "block" | "merge" | "notify") => setDuplicateRules(p => ({ ...p, action: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="block">Bloquear entrada (não criar lead)</SelectItem>
                  <SelectItem value="merge">Mesclar com lead existente</SelectItem>
                  <SelectItem value="notify">Criar e notificar sobre duplicata</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="bg-secondary/50 border border-border rounded-lg p-3">
              <p className="text-xs text-muted-foreground">
                {duplicateRules.action === "block" && "O lead não será criado se já existir outro com os mesmos dados selecionados."}
                {duplicateRules.action === "merge" && "Os dados do novo lead serão mesclados ao registro existente, atualizando informações."}
                {duplicateRules.action === "notify" && "O lead será criado normalmente, mas uma notificação será gerada avisando sobre a duplicata."}
              </p>
            </div>
            <Button className="w-full" onClick={() => { toast.success("Regras de duplicados salvas"); setDuplicateRulesOpen(false); }}>
              Salvar Regras
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
