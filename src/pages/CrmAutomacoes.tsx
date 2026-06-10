import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { deduplicateTemplates } from "@/lib/templateUtils";
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
import { Plus, Trash2, Bot, Zap, GripVertical, ShieldAlert, RefreshCw, MoreVertical, Copy } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import TemplateSearchSelect from "@/components/chat/TemplateSearchSelect";
import AutomationModal from "@/components/automation/AutomationModal";

type Pipeline = { id: string; name: string; color?: string; description?: string };
type Stage = { id: string; pipeline_id: string; name: string; color: string; position: number };
type Automation = {
  id: string; stage_id: string; trigger_type: string; action_type: string;
  action_config: Record<string, unknown>; is_active: boolean;
};
type Template = { id: string; name: string; status: string };
type BotEntry = { id: string; name: string };
type FunnelChannel = { id: string; pipeline_id: string; channel_type: string; channel_config: Record<string, unknown> | null };
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
  const [publishedBots, setPublishedBots] = useState<BotEntry[]>([]);
  const [channels, setChannels] = useState<FunnelChannel[]>([]);
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

  // Round Robin state
  const [roundRobinOpen, setRoundRobinOpen] = useState(false);
  const [rrMethod, setRrMethod] = useState("round_robin");
  const [rrEligible, setRrEligible] = useState<string[]>([]);
  const [rrProfiles, setRrProfiles] = useState<{ id: string; nome: string }[]>([]);
  const [rrActive, setRrActive] = useState(false);


  const fetchData = useCallback(async (pipeId?: string) => {
    setLoading(true);
    const { data: pipeData } = await supabase.from("crm_pipelines").select("*").order("created_at");
    const pipes = (pipeData as Pipeline[]) || [];
    setPipelines(pipes);
    const pid = pipeId || selectedPipelineId || pipes[0]?.id;
    if (pid) {
      setSelectedPipelineId(pid);
      const [stagesRes, autoRes, tplRes, chRes, fuRes, botsRes] = await Promise.all([
        supabase.from("crm_stages").select("*").eq("pipeline_id", pid).order("position"),
        supabase.from("crm_automations").select("*"),
        supabase.from("crm_whatsapp_templates").select("id, name, status").eq("status", "APPROVED").order("created_at", { ascending: false }),
        supabase.from("funnel_channels").select("*").eq("pipeline_id", pid),
        supabase.from("crm_followup_configs").select("id, stage_id, is_active, disparo1_type, disparo1_delay_minutes, max_attempts"),
        supabase.from("bots").select("id, name").eq("status", "published").order("name"),
      ]);
      setStages((stagesRes.data as Stage[]) || []);
      setAutomations((autoRes.data as Automation[]) || []);
      setTemplates(deduplicateTemplates((tplRes.data as Template[]) || []));
      setChannels((chRes.data as FunnelChannel[]) || []);
      setFollowUpConfigs((fuRes.data as FollowUpCfg[]) || []);
      setPublishedBots((botsRes.data as BotEntry[]) || []);
    }
    setLoading(false);
  }, [selectedPipelineId]);

  useEffect(() => { fetchData(); }, []);

  // Load round-robin state
  useEffect(() => {
    const loadRR = async () => {
      const { data: profiles } = await supabase.from("profiles").select("id, nome");
      setRrProfiles(profiles || []);
      if (!selectedPipelineId) return;
      const { data: existing } = await supabase.from("crm_automations").select("*").eq("action_type", "assign_lead");
      const match = existing?.find((a: any) => (a.action_config as any)?.pipeline_id === selectedPipelineId);
      if (match) {
        setRrActive(match.is_active);
        const cfg = match.action_config as any;
        setRrMethod(cfg?.method || "round_robin");
        setRrEligible(cfg?.eligible_users || []);
      } else {
        setRrActive(false);
        setRrMethod("round_robin");
        setRrEligible([]);
      }
    };
    loadRR();
  }, [selectedPipelineId]);

  const handleSaveRoundRobin = async () => {
    if (rrEligible.length === 0) return toast.error("Selecione ao menos um atendente");
    const config = { method: rrMethod, eligible_users: rrEligible, pipeline_id: selectedPipelineId };
    const { data: existing } = await supabase.from("crm_automations").select("id, action_config").eq("action_type", "assign_lead");
    const match = existing?.find((a: any) => (a.action_config as any)?.pipeline_id === selectedPipelineId);
    if (match) {
      await supabase.from("crm_automations").update({ action_config: config as any, is_active: rrActive }).eq("id", match.id);
    } else {
      const { data: stagesData } = await supabase.from("crm_stages").select("id").eq("pipeline_id", selectedPipelineId).order("position").limit(1);
      if (!stagesData?.length) return toast.error("Pipeline sem etapas");
      await supabase.from("crm_automations").insert({ stage_id: stagesData[0].id, action_type: "assign_lead", trigger_type: "on_enter", action_config: config as any, is_active: rrActive });
    }
    toast.success("Distribuição automática salva");
    setRoundRobinOpen(false);
  };

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
    const { data, error } = await supabase.from("crm_stages").insert({
      pipeline_id: selectedPipelineId, name: newStageName, color: newStageColor,
      position: stages.length,
    }).select().single();
    if (error) { toast.error(`Erro ao criar etapa: ${error.message}`); return; }
    toast.success("Etapa criada");
    setNewStageOpen(false);
    setNewStageName("");
    setNewStageColor("#6366f1");
    setUseCustomStageColor(false);
    if (data) setStages(prev => [...prev, data as Stage]);
  };

  const handleAddPipeline = async () => {
    if (!newPipelineName) return;
    const { data, error } = await supabase.from("crm_pipelines").insert({
      name: newPipelineName, color: newPipelineColor,
    }).select().single();
    if (error) { toast.error(`Erro ao criar funil: ${error.message}`); return; }
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
    else {
      toast.success("Etapa excluída");
      setStages(prev => prev.filter(s => s.id !== deleteStageId));
      setAutomations(prev => prev.filter(a => a.stage_id !== deleteStageId));
    }
    setDeleteStageId(null);
  };

  const handleSaveAutomation = async () => {
    const payload = {
      stage_id: autoForm.stage_id,
      trigger_type: autoForm.trigger_type,
      action_type: autoForm.action_type,
      action_config: autoForm.action_config as unknown as import("@/integrations/supabase/types").Json,
      is_active: true,
    };
    let savedAutomation: Automation | null = null;
    if (autoForm.editId) {
      const { data, error } = await supabase.from("crm_automations").update(payload).eq("id", autoForm.editId).select().single();
      if (error) {
        console.error("[Automacoes] Update error:", error);
        toast.error(`Erro ao salvar automação: ${error.message}`);
        return;
      }
      if (data) {
        savedAutomation = data as Automation;
        setAutomations(prev => prev.map(a => a.id === autoForm.editId ? data as Automation : a));
      }
    } else {
      const { data, error } = await supabase.from("crm_automations").insert(payload).select().single();
      if (error) {
        console.error("[Automacoes] Insert error:", error);
        toast.error(`Erro ao criar automação: ${error.message}`);
        return;
      }
      if (data) {
        savedAutomation = data as Automation;
        setAutomations(prev => [...prev, data as Automation]);
      }
    }
    toast.success("Automação salva");
    setAutoModalOpen(false);

    // Execute "send to all existing" if checked
    const config = autoForm.action_config;
    const enqueueForExistingLeads = async () => {
      if (!savedAutomation?.id) {
        toast.error("Automação não foi salva — não é possível enfileirar");
        return;
      }
      toast.info("Enfileirando automação para todos os leads da etapa...");
      const { data, error } = await supabase.functions.invoke("enqueue-stage-automation", {
        body: { automation_id: savedAutomation.id },
      });
      if (error || (data as any)?.error) {
        const message = (data as any)?.error || error?.message || "Erro ao enfileirar disparos";
        console.error("[Automacoes] Queue function error:", error || data);
        toast.error(message);
        return;
      }
      const inserted = Number((data as any)?.inserted || 0);
      const totalLeads = Number((data as any)?.total_leads || 0);
      if (inserted === 0) {
        toast.warning((data as any)?.message || "Nenhum lead com telefone encontrado nesta etapa");
        return;
      }
      toast.success(`Automação enfileirada para ${inserted} de ${totalLeads} leads`);
    };

    if (config.send_to_all_existing && autoForm.action_type === "send_bot" && config.bot_id) {
      await enqueueForExistingLeads();
    } else if (config.send_to_all_existing && autoForm.action_type === "send_template" && config.template_id) {
      await enqueueForExistingLeads();
    } else if (config.send_to_all_existing) {
      toast.warning("Marque um template ou bot antes de disparar para todos");
    }
  };

  const handleDeleteAutomation = async (id: string) => {
    await supabase.from("crm_automations").delete().eq("id", id);
    toast.success("Automação removida");
    setAutomations(prev => prev.filter(a => a.id !== id));
  };

  const getAutomationsForStage = (stageId: string) => automations.filter(a => a.stage_id === stageId && a.action_type !== "assign_lead");

  const actionLabel = (type: string) => {
    const map: Record<string, string> = {
      send_template: "Enviar template WhatsApp",
      send_audio: "Enviar áudio",
      send_bot: "Enviar Bot",
      send_file: "Enviar arquivo",
      add_tag: "Criar tag",
      move_stage: "Mover para etapa",
      notify_assignee: "Notificar responsável",
      webhook: "Chamar webhook",
      combo: "Combinação de ações",
    };
    return map[type] || type;
  };

  const triggerLabel = (type: string) => {
    const map: Record<string, string> = {
      on_enter: "Ao mover",
      on_create: "Ao criar",
      on_create_or_enter: "Ao mover/criar",
      no_response: "Sem resposta",
      before_scheduled: "Antes de agendamento",
      // Legacy triggers still show labels for existing automations
      lead_created_date: "Por data",
      progressive_reengagement: "Reengajamento",
      lead_stale: "Lead parado",
      time_window: "Janela horário",
      keyword_response: "Palavra-chave",
      after_appointment_confirmed: "Pós-agendamento",
      no_show: "No-show",
      cold_lead_return: "Lead frio",
    };
    return map[type] || type;
  };


  if (loading) return <div className="flex items-center justify-center h-screen bg-background"><span className="text-muted-foreground">Carregando...</span></div>;

  return (
    <div className="flex flex-col overflow-hidden bg-background -m-6" style={{ height: "calc(100vh - 4rem)" }}>
      {/* Header */}
      <div className="flex-shrink-0 bg-card border-b border-border px-6 py-3 flex items-center justify-between gap-2 flex-wrap overflow-hidden min-w-0">
        <div className="flex items-center gap-3 min-w-0 flex-wrap">
          <h1 className="text-lg font-bold text-foreground whitespace-nowrap">Configuração do Funil</h1>
          {pipelines.length > 0 && (
            <div className="flex items-center gap-1">
              <select
                className="bg-secondary border border-border rounded-md px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                value={selectedPipelineId}
                onChange={(e) => fetchData(e.target.value)}
              >
                {pipelines.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors">
                    <MoreVertical size={16} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={async () => {
                    const pipe = pipelines.find(p => p.id === selectedPipelineId);
                    if (!pipe) return;
                    const { data } = await supabase.from("crm_pipelines").insert({
                      name: `${pipe.name} (cópia)`, color: pipe.color,
                    }).select().single();
                    if (data) {
                      // Duplicate stages
                      for (const s of stages) {
                        await supabase.from("crm_stages").insert({
                          pipeline_id: data.id, name: s.name, color: s.color, position: s.position,
                        });
                      }
                      toast.success("Funil duplicado");
                      fetchData(data.id);
                    }
                  }}>
                    <Copy size={14} className="mr-2" /> Duplicar funil
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={async () => {
                    if (!confirm("Excluir este funil e todas suas etapas?")) return;
                    await supabase.from("crm_stages").delete().eq("pipeline_id", selectedPipelineId);
                    await supabase.from("crm_pipelines").delete().eq("id", selectedPipelineId);
                    toast.success("Funil excluído");
                    fetchData();
                  }}>
                    <Trash2 size={14} className="mr-2" /> Excluir funil
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
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
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-foreground">Distribuição automática</div>
                <p className="text-xs text-muted-foreground max-w-xs">Distribui novos leads automaticamente entre os atendentes selecionados, usando Round Robin (alternado) ou Menor Carga.</p>
                <button onClick={() => setRoundRobinOpen(true)} className="text-xs text-primary cursor-pointer hover:underline mt-0.5">Configurar</button>
              </div>
              <Switch checked={rrActive} onCheckedChange={async (v) => {
                setRrActive(v);
                const { data: existing } = await supabase.from("crm_automations").select("id, action_config").eq("action_type", "assign_lead");
                const match = existing?.find((a: any) => (a.action_config as any)?.pipeline_id === selectedPipelineId);
                if (match) {
                  await supabase.from("crm_automations").update({ is_active: v }).eq("id", match.id);
                  toast.success(v ? "Distribuição ativada" : "Distribuição desativada");
                }
              }} />
            </div>
            <hr className="border-border" />
            <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Fontes conectadas</div>
            {channels.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhuma fonte conectada a este funil.</p>
            ) : channels.map(ch => {
              const isWhatsapp = ch.channel_type === "whatsapp";
              const icons: Record<string, string> = { instagram: "📸", facebook: "📘", manual: "✋", website: "🌐" };
              return (
                <div key={ch.id} className="flex items-center justify-between py-1.5">
                  <div className="flex items-center gap-2 text-sm text-foreground">
                    {isWhatsapp ? (
                      <svg viewBox="0 0 32 32" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="16" cy="16" r="16" fill="#25D366"/>
                        <path d="M23.3 8.6A10.4 10.4 0 0 0 6.6 20.1L5 27l7.1-1.6a10.4 10.4 0 0 0 11.2-17.8zm-7.3 16a8.6 8.6 0 0 1-4.4-1.2l-.3-.2-3.2.7.8-3.1-.2-.3A8.6 8.6 0 1 1 16 24.6zm4.7-6.4c-.3-.1-1.5-.8-1.8-.9-.2-.1-.4-.1-.6.1s-.7.9-.9 1.1c-.2.2-.3.2-.6.1a7.7 7.7 0 0 1-3.8-3.3c-.3-.5.3-.5.8-1.6.1-.2 0-.3 0-.5s-.6-1.5-.8-2c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2c0 1.3.9 2.6 1 2.8s1.8 2.7 4.3 3.8c1.6.7 2.2.7 3 .6.5-.1 1.5-.6 1.7-1.2s.2-1.1.2-1.2c0-.1-.2-.2-.5-.3z" fill="#fff"/>
                      </svg>
                    ) : (
                      <span>{icons[ch.channel_type] || "📡"}</span>
                    )}
                    {ch.channel_type.charAt(0).toUpperCase() + ch.channel_type.slice(1)}
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-green-400 bg-green-900/30 px-1.5 py-0.5 rounded">Ativo</span>
                    <button onClick={async () => {
                      await supabase.from("funnel_channels").delete().eq("id", ch.id);
                      toast.success("Fonte removida");
                      setChannels(prev => prev.filter(c => c.id !== ch.id));
                    }}><Trash2 size={12} className="text-destructive cursor-pointer" /></button>
                  </div>
                </div>
              );
            })}
            <button
              onClick={async () => {
                const type = prompt("Tipo da fonte (whatsapp, instagram, facebook, manual, website):");
                if (!type || !selectedPipelineId) return;
                const { data } = await supabase.from("funnel_channels").insert({ pipeline_id: selectedPipelineId, channel_type: type.toLowerCase() }).select().single();
                toast.success("Fonte adicionada");
                if (data) setChannels(prev => [...prev, data as FunnelChannel]);
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
                                  <div className="flex items-center gap-1 flex-1 min-w-0">
                                    <span {...prov.dragHandleProps} className="cursor-grab text-muted-foreground hover:text-foreground">
                                      <GripVertical size={14} />
                                    </span>
                                    <input
                                      className="font-semibold text-sm text-foreground bg-transparent border-b border-transparent hover:border-border focus:border-primary focus:outline-none w-full min-w-0"
                                      value={stage.name}
                                      onChange={async (e) => {
                                        const newName = e.target.value;
                                        setStages(prev => prev.map(s => s.id === stage.id ? { ...s, name: newName } : s));
                                      }}
                                      onBlur={async (e) => {
                                        await supabase.from("crm_stages").update({ name: e.target.value }).eq("id", stage.id);
                                      }}
                                    />
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0">
                                    <Popover>
                                      <PopoverTrigger asChild>
                                        <button className="w-5 h-5 rounded-md border border-border" style={{ backgroundColor: stage.color }} title="Alterar cor" />
                                      </PopoverTrigger>
                                      <PopoverContent className="w-auto p-2" align="end">
                                        <div className="grid grid-cols-5 gap-1">
                                          {PRESET_COLORS.map(c => (
                                            <button
                                              key={c}
                                              onClick={async () => {
                                                setStages(prev => prev.map(s => s.id === stage.id ? { ...s, color: c } : s));
                                                await supabase.from("crm_stages").update({ color: c }).eq("id", stage.id);
                                              }}
                                              className={`w-6 h-6 rounded-md border-2 ${stage.color === c ? "border-foreground scale-110" : "border-transparent hover:scale-105"}`}
                                              style={{ backgroundColor: c }}
                                            />
                                          ))}
                                        </div>
                                      </PopoverContent>
                                    </Popover>
                                    <button onClick={() => setDeleteStageId(stage.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                                </div>
                                <div className="text-xs text-primary cursor-pointer mb-3">{stageAutos.length} automação(ões)</div>

                                <div className="space-y-2">
                                  {stageAutos.map(auto => (
                                    <div
                                      key={auto.id}
                                      className="bg-primary/10 border border-primary/20 rounded p-2 text-xs cursor-pointer hover:bg-primary/20 transition-colors"
                                      onClick={() => {
                                        setAutoForm({
                                          stage_id: auto.stage_id,
                                          trigger_type: auto.trigger_type,
                                          action_type: auto.action_type,
                                          action_config: auto.action_config || {},
                                          editId: auto.id,
                                        });
                                        setAutoModalOpen(true);
                                      }}
                                    >
                                      <div className="flex items-center gap-1 text-primary mb-1">
                                        <Bot size={12} />
                                        <span className="font-medium">{triggerLabel(auto.trigger_type)}</span>
                                      </div>
                                      <div className="text-foreground">{actionLabel(auto.action_type)}</div>
                                      <div className="flex items-center gap-1 mt-1">
                                        <button onClick={(e) => { e.stopPropagation(); handleDeleteAutomation(auto.id); }} className="text-destructive/70 hover:text-destructive">
                                          <Trash2 size={10} />
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                  <button
                                    onClick={() => {
                                      setAutoForm({ stage_id: stage.id, trigger_type: "on_enter", action_type: "send_template", action_config: {}, editId: "" });
                                      setAutoModalOpen(true);
                                    }}
                                    className="w-full text-xs text-primary bg-primary/10 hover:bg-primary/20 rounded py-1.5 flex items-center justify-center gap-1 transition-colors"
                                  >
                                    <Plus size={12} /> Adicionar automação
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

      <AutomationModal
        open={autoModalOpen}
        onOpenChange={setAutoModalOpen}
        autoForm={autoForm}
        setAutoForm={setAutoForm}
        stages={stages}
        templates={templates}
        publishedBots={publishedBots}
        onSave={handleSaveAutomation}
      />
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

      {/* Round Robin Modal */}
      <Dialog open={roundRobinOpen} onOpenChange={setRoundRobinOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Distribuição Automática de Leads</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Método</Label>
              <Select value={rrMethod} onValueChange={setRrMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="round_robin">Round Robin</SelectItem>
                  <SelectItem value="least_load">Menor Carga</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                {rrMethod === "round_robin" ? "Distribui leads igualmente entre os atendentes" : "Atribui ao atendente com menos leads ativos"}
              </p>
            </div>
            <div>
              <Label>Atendentes Elegíveis</Label>
              <div className="space-y-2 mt-2 max-h-60 overflow-auto">
                {rrProfiles.map(p => (
                  <label key={p.id} className="flex items-center gap-2 cursor-pointer p-2 rounded hover:bg-secondary">
                    <Checkbox
                      checked={rrEligible.includes(p.id)}
                      onCheckedChange={() => setRrEligible(prev => prev.includes(p.id) ? prev.filter(x => x !== p.id) : [...prev, p.id])}
                    />
                    <span className="text-sm">{p.nome}</span>
                  </label>
                ))}
              </div>
            </div>
            <Button onClick={handleSaveRoundRobin} className="w-full"><Zap size={16} /> Salvar Configuração</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
