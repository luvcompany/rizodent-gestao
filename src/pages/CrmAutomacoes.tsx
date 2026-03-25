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
import { ArrowLeft, Save, Plus, Trash2, Bot, Zap } from "lucide-react";

type Stage = { id: string; pipeline_id: string; name: string; color: string; position: number };
type Automation = {
  id: string; stage_id: string; trigger_type: string; action_type: string;
  action_config: Record<string, unknown>; is_active: boolean;
};
type Template = { id: string; name: string; status: string };

export default function CrmAutomacoes() {
  const navigate = useNavigate();
  const [stages, setStages] = useState<Stage[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [pipelineId, setPipelineId] = useState("");
  const [loading, setLoading] = useState(true);

  // New stage modal
  const [newStageOpen, setNewStageOpen] = useState(false);
  const [newStageName, setNewStageName] = useState("");
  const [newStageColor, setNewStageColor] = useState("#6366f1");

  // Automation modal
  const [autoModalOpen, setAutoModalOpen] = useState(false);
  const [autoForm, setAutoForm] = useState({
    stage_id: "", trigger_type: "on_enter", action_type: "send_template",
    action_config: {} as Record<string, unknown>, editId: ""
  });

  // Delete confirmation
  const [deleteStageId, setDeleteStageId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const { data: pipelines } = await supabase.from("crm_pipelines").select("*").limit(1);
    if (pipelines && pipelines.length > 0) {
      const pid = pipelines[0].id;
      setPipelineId(pid);
      const [stagesRes, autoRes, tplRes] = await Promise.all([
        supabase.from("crm_stages").select("*").eq("pipeline_id", pid).order("position"),
        supabase.from("crm_automations").select("*"),
        supabase.from("crm_whatsapp_templates").select("id, name, status").eq("status", "APPROVED"),
      ]);
      setStages((stagesRes.data as Stage[]) || []);
      setAutomations((autoRes.data as Automation[]) || []);
      setTemplates((tplRes.data as Template[]) || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSaveOrder = async () => {
    for (let i = 0; i < stages.length; i++) {
      await supabase.from("crm_stages").update({ position: i }).eq("id", stages[i].id);
    }
    toast.success("Ordem salva com sucesso");
  };

  const handleAddStage = async () => {
    if (!newStageName) return;
    const { error } = await supabase.from("crm_stages").insert({
      pipeline_id: pipelineId, name: newStageName, color: newStageColor,
      position: stages.length,
    });
    if (error) { toast.error("Erro ao criar etapa"); return; }
    toast.success("Etapa criada");
    setNewStageOpen(false);
    setNewStageName("");
    fetchData();
  };

  const handleDeleteStage = async () => {
    if (!deleteStageId) return;
    const { error } = await supabase.from("crm_stages").delete().eq("id", deleteStageId);
    if (error) { toast.error("Erro ao excluir etapa. Mova os leads primeiro."); }
    else { toast.success("Etapa excluída"); }
    setDeleteStageId(null);
    fetchData();
  };

  const handleSaveAutomation = async () => {
    const payload = {
      stage_id: autoForm.stage_id,
      trigger_type: autoForm.trigger_type,
      action_type: autoForm.action_type,
      action_config: autoForm.action_config,
    };
    if (autoForm.editId) {
      await supabase.from("crm_automations").update(payload).eq("id", autoForm.editId);
    } else {
      await supabase.from("crm_automations").insert(payload);
    }
    toast.success("Automação salva");
    setAutoModalOpen(false);
    fetchData();
  };

  const handleDeleteAutomation = async (id: string) => {
    await supabase.from("crm_automations").delete().eq("id", id);
    toast.success("Automação removida");
    fetchData();
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

  if (loading) return <div className="flex items-center justify-center h-screen bg-[#f5f5f5]"><span className="text-gray-500">Carregando...</span></div>;

  return (
    <div className="flex flex-col h-full min-h-screen bg-[#f5f5f5]">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="text-gray-600" onClick={() => navigate("/crm")}>
            <ArrowLeft size={16} className="mr-1" /> Voltar
          </Button>
          <h1 className="text-lg font-bold text-gray-900">Configuração do Funil</h1>
        </div>
        <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white" onClick={handleSaveOrder}>
          <Save size={14} className="mr-1" /> Salvar
        </Button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left panel - Lead sources */}
        <div className="w-[280px] bg-white border-r border-gray-200 p-4 flex-shrink-0 overflow-y-auto">
          <h2 className="font-semibold text-sm text-gray-800 mb-4">Fontes de Lead</h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-gray-700">Etapa de leads de entrada</div>
                <div className="text-xs text-gray-400">Leads entram na primeira etapa</div>
              </div>
              <Switch defaultChecked />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-gray-700">Controle duplicado</div>
                <div className="text-xs text-blue-500 cursor-pointer hover:underline">Configurar regras</div>
              </div>
              <Switch />
            </div>
            <hr className="border-gray-100" />
            <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Fontes conectadas</div>
            {[
              { name: "WhatsApp", icon: "💬", status: "ativo" },
              { name: "Instagram", icon: "📸", status: "ativo" },
              { name: "Facebook", icon: "📘", status: "erro" },
              { name: "Manual", icon: "✋", status: "ativo" },
            ].map(src => (
              <div key={src.name} className="flex items-center justify-between py-1.5">
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <span>{src.icon}</span> {src.name}
                </div>
                {src.status === "ativo" ? (
                  <span className="text-[10px] text-green-600 bg-green-50 px-1.5 py-0.5 rounded">Ativo</span>
                ) : (
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-red-600 bg-red-50 px-1.5 py-0.5 rounded">Erro</span>
                    <Trash2 size={12} className="text-red-400 cursor-pointer" />
                  </div>
                )}
              </div>
            ))}
            <button className="w-full text-sm text-blue-600 bg-blue-50 hover:bg-blue-100 rounded py-2 flex items-center justify-center gap-1 mt-2">
              <Plus size={14} /> Adicionar fonte
            </button>
          </div>
        </div>

        {/* Main - Stages horizontal */}
        <div className="flex-1 overflow-x-auto p-6">
          <div className="flex gap-4 items-start">
            {stages.map((stage, idx) => {
              const stageAutos = getAutomationsForStage(stage.id);
              return (
                <div key={stage.id} className="flex items-start gap-2">
                  <div className="w-[240px] flex-shrink-0 bg-white rounded-lg border border-gray-200 overflow-hidden">
                    <div className="h-1.5" style={{ backgroundColor: stage.color }} />
                    <div className="p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-sm text-gray-800">{stage.name}</span>
                        <button onClick={() => setDeleteStageId(stage.id)} className="text-gray-300 hover:text-red-500">
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <div className="text-xs text-blue-500 cursor-pointer mb-3">{stageAutos.length} automação(ões)</div>

                      {/* Automations */}
                      <div className="space-y-2">
                        {stageAutos.map(auto => (
                          <div key={auto.id} className="bg-blue-50 border border-blue-100 rounded p-2 text-xs">
                            <div className="flex items-center gap-1 text-blue-700 mb-1">
                              <Bot size={12} />
                              <span className="font-medium">{auto.trigger_type === "on_enter" ? "Ao mover" : "Ao criar"}</span>
                            </div>
                            <div className="text-blue-600">{actionLabel(auto.action_type)}</div>
                            <div className="flex items-center gap-1 mt-1">
                              <button onClick={() => handleDeleteAutomation(auto.id)} className="text-red-400 hover:text-red-600">
                                <Trash2 size={10} />
                              </button>
                            </div>
                          </div>
                        ))}
                        <button
                          onClick={() => { setAutoForm({ stage_id: stage.id, trigger_type: "on_enter", action_type: "send_template", action_config: {}, editId: "" }); setAutoModalOpen(true); }}
                          className="w-full text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 rounded py-1.5 flex items-center justify-center gap-1"
                        >
                          <Plus size={12} /> Adicionar gatilho
                        </button>
                      </div>
                    </div>
                  </div>
                  {idx < stages.length - 1 && (
                    <button
                      onClick={() => setNewStageOpen(true)}
                      className="flex-shrink-0 mt-8 w-6 h-6 rounded-full border border-dashed border-gray-300 text-gray-400 hover:text-blue-500 hover:border-blue-400 flex items-center justify-center text-xs"
                    >+</button>
                  )}
                </div>
              );
            })}
            <button
              onClick={() => setNewStageOpen(true)}
              className="mt-8 w-10 h-10 rounded-full border-2 border-dashed border-gray-300 text-gray-400 hover:text-blue-500 hover:border-blue-400 flex items-center justify-center flex-shrink-0"
            >
              <Plus size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* New Stage Modal */}
      <Dialog open={newStageOpen} onOpenChange={setNewStageOpen}>
        <DialogContent className="bg-white text-gray-900 max-w-sm">
          <DialogHeader><DialogTitle>Nova Etapa</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-gray-700">Nome</Label><Input className="bg-white border-gray-300 text-gray-900" value={newStageName} onChange={e => setNewStageName(e.target.value)} /></div>
            <div><Label className="text-gray-700">Cor</Label><input type="color" value={newStageColor} onChange={e => setNewStageColor(e.target.value)} className="w-full h-10 rounded cursor-pointer" /></div>
            <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white" onClick={handleAddStage}>Criar Etapa</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Stage Confirmation */}
      <Dialog open={!!deleteStageId} onOpenChange={() => setDeleteStageId(null)}>
        <DialogContent className="bg-white text-gray-900 max-w-sm">
          <DialogHeader><DialogTitle>Excluir Etapa?</DialogTitle></DialogHeader>
          <p className="text-sm text-gray-600">Todos os leads e automações desta etapa serão excluídos. Deseja continuar?</p>
          <div className="flex gap-2 justify-end mt-4">
            <Button variant="outline" className="border-gray-300 text-gray-700" onClick={() => setDeleteStageId(null)}>Cancelar</Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={handleDeleteStage}>Excluir</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Automation Modal */}
      <Dialog open={autoModalOpen} onOpenChange={setAutoModalOpen}>
        <DialogContent className="bg-white text-gray-900 max-w-md">
          <DialogHeader><DialogTitle><Zap size={16} className="inline mr-1" />Configurar Automação</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-gray-700">Evento</Label>
              <Select value={autoForm.trigger_type} onValueChange={v => setAutoForm(p => ({ ...p, trigger_type: v }))}>
                <SelectTrigger className="bg-white border-gray-300 text-gray-900"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-white text-gray-900">
                  <SelectItem value="on_create">Quando criado nesta etapa</SelectItem>
                  <SelectItem value="on_enter">Quando movido para esta etapa</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-gray-700">Ação</Label>
              <Select value={autoForm.action_type} onValueChange={v => setAutoForm(p => ({ ...p, action_type: v, action_config: {} }))}>
                <SelectTrigger className="bg-white border-gray-300 text-gray-900"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-white text-gray-900">
                  <SelectItem value="send_template">Enviar template WhatsApp</SelectItem>
                  <SelectItem value="send_audio">Enviar áudio</SelectItem>
                  <SelectItem value="move_stage">Mover para etapa</SelectItem>
                  <SelectItem value="webhook">Chamar webhook</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {autoForm.action_type === "send_template" && (
              <div>
                <Label className="text-gray-700">Template</Label>
                <Select value={(autoForm.action_config.template_id as string) || ""} onValueChange={v => setAutoForm(p => ({ ...p, action_config: { template_id: v } }))}>
                  <SelectTrigger className="bg-white border-gray-300 text-gray-900"><SelectValue placeholder="Selecionar template" /></SelectTrigger>
                  <SelectContent className="bg-white text-gray-900">
                    {templates.length === 0 && <SelectItem value="none" disabled>Nenhum template aprovado</SelectItem>}
                    {templates.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {autoForm.action_type === "move_stage" && (
              <div>
                <Label className="text-gray-700">Mover para</Label>
                <Select value={(autoForm.action_config.target_stage_id as string) || ""} onValueChange={v => setAutoForm(p => ({ ...p, action_config: { target_stage_id: v } }))}>
                  <SelectTrigger className="bg-white border-gray-300 text-gray-900"><SelectValue placeholder="Selecionar etapa" /></SelectTrigger>
                  <SelectContent className="bg-white text-gray-900">
                    {stages.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {autoForm.action_type === "webhook" && (
              <div>
                <Label className="text-gray-700">URL do Webhook</Label>
                <Input className="bg-white border-gray-300 text-gray-900" placeholder="https://..." value={(autoForm.action_config.url as string) || ""} onChange={e => setAutoForm(p => ({ ...p, action_config: { url: e.target.value } }))} />
              </div>
            )}

            <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white" onClick={handleSaveAutomation}>Salvar Automação</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
