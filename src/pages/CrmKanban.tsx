import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Plus, Filter, LayoutGrid, List, Zap, Search,
  Calendar, AlertTriangle, Clock, TrendingUp, Users
} from "lucide-react";

type Stage = {
  id: string;
  pipeline_id: string;
  name: string;
  color: string;
  position: number;
};

type Lead = {
  id: string;
  pipeline_id: string;
  stage_id: string;
  name: string;
  phone: string | null;
  tags: string[];
  source: string | null;
  value: number | null;
  has_task: boolean;
  task_overdue: boolean;
  notes: string | null;
  position: number;
  created_at: string;
  updated_at: string;
};

type Pipeline = {
  id: string;
  name: string;
};

export default function CrmKanban() {
  const navigate = useNavigate();
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [newLeadOpen, setNewLeadOpen] = useState(false);
  const [detailLead, setDetailLead] = useState<Lead | null>(null);
  const [viewMode, setViewMode] = useState<"kanban" | "list">("kanban");
  const [searchTerm, setSearchTerm] = useState("");

  // New lead form
  const [newLead, setNewLead] = useState({
    name: "", phone: "", stage_id: "", source: "", tags: "", value: "", notes: ""
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    const { data: pipelines } = await supabase.from("crm_pipelines").select("*").limit(1);
    if (pipelines && pipelines.length > 0) {
      const p = pipelines[0] as Pipeline;
      setPipeline(p);

      const [stagesRes, leadsRes] = await Promise.all([
        supabase.from("crm_stages").select("*").eq("pipeline_id", p.id).order("position"),
        supabase.from("crm_leads").select("*").eq("pipeline_id", p.id).order("position"),
      ]);
      setStages((stagesRes.data as Stage[]) || []);
      setLeads((leadsRes.data as Lead[]) || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination) return;
    const leadId = result.draggableId;
    const newStageId = result.destination.droppableId;
    const newPosition = result.destination.index;

    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, stage_id: newStageId, position: newPosition } : l));

    const { error } = await supabase.from("crm_leads").update({
      stage_id: newStageId, position: newPosition, updated_at: new Date().toISOString()
    }).eq("id", leadId);

    if (error) { toast.error("Erro ao mover lead"); fetchData(); }
  };

  const handleCreateLead = async () => {
    if (!newLead.name || !newLead.stage_id || !pipeline) {
      toast.error("Nome e etapa são obrigatórios");
      return;
    }
    const tagsArray = newLead.tags ? newLead.tags.split(",").map(t => t.trim()).filter(Boolean) : [];
    const { error } = await supabase.from("crm_leads").insert({
      name: newLead.name,
      phone: newLead.phone || null,
      stage_id: newLead.stage_id,
      pipeline_id: pipeline.id,
      source: newLead.source || null,
      tags: tagsArray,
      value: newLead.value ? parseFloat(newLead.value) : 0,
      notes: newLead.notes || null,
      position: leads.filter(l => l.stage_id === newLead.stage_id).length,
    });
    if (error) { toast.error("Erro ao criar lead"); return; }
    toast.success("Lead criado com sucesso");
    setNewLeadOpen(false);
    setNewLead({ name: "", phone: "", stage_id: "", source: "", tags: "", value: "", notes: "" });
    fetchData();
  };

  const getLeadsForStage = (stageId: string) => {
    let filtered = leads.filter(l => l.stage_id === stageId);
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      filtered = filtered.filter(l => l.name.toLowerCase().includes(s) || l.phone?.includes(s));
    }
    return filtered.sort((a, b) => a.position - b.position);
  };

  const totalLeads = leads.length;
  const totalValue = leads.reduce((acc, l) => acc + (l.value || 0), 0);
  const withTaskToday = leads.filter(l => l.has_task && !l.task_overdue).length;
  const noTasks = leads.filter(l => !l.has_task).length;
  const overdue = leads.filter(l => l.task_overdue).length;
  const today = new Date().toISOString().split("T")[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
  const newToday = leads.filter(l => l.created_at.startsWith(today)).length;
  const newYesterday = leads.filter(l => l.created_at.startsWith(yesterday)).length;

  const formatCurrency = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  if (loading) {
    return <div className="flex items-center justify-center h-screen bg-[#f5f5f5]"><div className="text-gray-500">Carregando CRM...</div></div>;
  }

  return (
    <div className="flex flex-col h-full min-h-screen bg-[#f5f5f5]">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-bold text-gray-900">{pipeline?.name || "CRM"}</h1>
          <div className="flex items-center gap-1 border rounded-md">
            <button onClick={() => setViewMode("kanban")} className={`p-1.5 rounded-l-md ${viewMode === "kanban" ? "bg-blue-50 text-blue-600" : "text-gray-400"}`}>
              <LayoutGrid size={16} />
            </button>
            <button onClick={() => setViewMode("list")} className={`p-1.5 rounded-r-md ${viewMode === "list" ? "bg-blue-50 text-blue-600" : "text-gray-400"}`}>
              <List size={16} />
            </button>
          </div>
          <button className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 border rounded-md px-2 py-1">
            <Filter size={14} /> Filtro
          </button>
          <div className="relative">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="pl-7 pr-3 py-1 text-sm border rounded-md bg-white text-gray-700 w-48 focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="Buscar lead..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600 font-medium">{totalLeads} leads: {formatCurrency(totalValue)}</span>
          <Button variant="outline" size="sm" className="text-gray-700 border-gray-300" onClick={() => navigate("/crm/automacoes")}>
            <Zap size={14} className="mr-1" /> AUTOMATIZE
          </Button>
          <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => { if (stages.length) { setNewLead(p => ({ ...p, stage_id: stages[0].id })); } setNewLeadOpen(true); }}>
            <Plus size={14} className="mr-1" /> NOVO LEAD
          </Button>
        </div>
      </div>

      {/* Metrics bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-2 flex items-center gap-6 overflow-x-auto text-sm">
        <MetricBadge icon={<Calendar size={14} />} label="Com tarefas para hoje" value={withTaskToday} color="text-blue-600" />
        <MetricBadge icon={<Users size={14} />} label="Sem tarefas atribuídas" value={noTasks} color="text-gray-500" />
        <MetricBadge icon={<AlertTriangle size={14} />} label="Com tarefas atrasadas" value={overdue} color="text-red-500" />
        <MetricBadge icon={<Clock size={14} />} label="Novo hoje / ontem" value={`${newToday} / ${newYesterday}`} color="text-green-600" />
        <MetricBadge icon={<TrendingUp size={14} />} label="Vendas em potencial" value={formatCurrency(totalValue)} color="text-orange-500" />
      </div>

      {/* Kanban area */}
      <div className="flex-1 overflow-x-auto p-4">
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="flex gap-3 h-full min-h-[calc(100vh-180px)]">
            {stages.map((stage, idx) => {
              const stageLeads = getLeadsForStage(stage.id);
              const stageValue = stageLeads.reduce((a, l) => a + (l.value || 0), 0);
              return (
                <div key={stage.id} className="flex items-start gap-1">
                  <div className="w-[280px] flex-shrink-0 flex flex-col bg-gray-100 rounded-lg overflow-hidden">
                    {/* Stage header */}
                    <div className="h-1" style={{ backgroundColor: stage.color }} />
                    <div className="px-3 py-2">
                      <div className="font-semibold text-sm text-gray-800">{stage.name}</div>
                      <div className="text-xs text-gray-500">{stageLeads.length} leads · {formatCurrency(stageValue)}</div>
                    </div>

                    {/* Quick add for first stage */}
                    {idx === 0 && (
                      <div className="px-2 pb-1">
                        <button
                          onClick={() => { setNewLead(p => ({ ...p, stage_id: stage.id })); setNewLeadOpen(true); }}
                          className="w-full text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 rounded py-1 flex items-center justify-center gap-1"
                        >
                          <Plus size={12} /> Adição rápida
                        </button>
                      </div>
                    )}

                    {/* Lead cards */}
                    <Droppable droppableId={stage.id}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          className={`flex-1 overflow-y-auto px-2 pb-2 min-h-[100px] ${snapshot.isDraggingOver ? "bg-blue-50" : ""}`}
                          style={{ maxHeight: "calc(100vh - 280px)" }}
                        >
                          {stageLeads.map((lead, lIdx) => (
                            <Draggable key={lead.id} draggableId={lead.id} index={lIdx}>
                              {(prov, snap) => (
                                <div
                                  ref={prov.innerRef}
                                  {...prov.draggableProps}
                                  {...prov.dragHandleProps}
                                  onClick={() => setDetailLead(lead)}
                                  className={`bg-white rounded-lg shadow-sm border border-gray-100 p-3 mb-2 cursor-pointer hover:shadow-md transition-shadow ${snap.isDragging ? "shadow-lg ring-2 ring-blue-300" : ""}`}
                                >
                                  <div className="flex items-start justify-between mb-1">
                                    <span className="font-medium text-sm text-gray-900 leading-tight">{lead.name}</span>
                                    <span className="text-[10px] text-gray-400 whitespace-nowrap ml-2">
                                      {new Date(lead.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                                    </span>
                                  </div>
                                  <div className="text-xs text-blue-600 mb-1.5 cursor-pointer hover:underline">
                                    Lead #{lead.id.slice(0, 8)}
                                  </div>
                                  {lead.tags && lead.tags.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mb-2">
                                      {lead.tags.map(tag => (
                                        <span key={tag} className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">#{tag}</span>
                                      ))}
                                    </div>
                                  )}
                                  <div className="flex items-center justify-between">
                                    {lead.value ? <span className="text-xs font-medium text-gray-700">{formatCurrency(lead.value)}</span> : <span />}
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${lead.task_overdue ? "bg-red-50 text-red-600" : lead.has_task ? "bg-green-50 text-green-600" : "bg-orange-50 text-orange-500"}`}>
                                      {lead.task_overdue ? "Atrasada" : lead.has_task ? "Com tarefa" : "Sem Tarefas"}
                                    </span>
                                  </div>
                                </div>
                              )}
                            </Draggable>
                          ))}
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>
                  </div>

                  {/* Add stage button between columns */}
                  {idx < stages.length - 1 && (
                    <button className="flex-shrink-0 mt-8 w-6 h-6 rounded-full border border-dashed border-gray-300 text-gray-400 hover:text-blue-500 hover:border-blue-400 flex items-center justify-center text-xs transition-colors">
                      +
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </DragDropContext>
      </div>

      {/* New Lead Modal */}
      <Dialog open={newLeadOpen} onOpenChange={setNewLeadOpen}>
        <DialogContent className="bg-white text-gray-900 max-w-md">
          <DialogHeader><DialogTitle>Novo Lead</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-gray-700">Nome *</Label><Input className="bg-white border-gray-300 text-gray-900" value={newLead.name} onChange={e => setNewLead(p => ({ ...p, name: e.target.value }))} /></div>
            <div><Label className="text-gray-700">Telefone</Label><Input className="bg-white border-gray-300 text-gray-900" value={newLead.phone} onChange={e => setNewLead(p => ({ ...p, phone: e.target.value }))} /></div>
            <div>
              <Label className="text-gray-700">Etapa Inicial *</Label>
              <Select value={newLead.stage_id} onValueChange={v => setNewLead(p => ({ ...p, stage_id: v }))}>
                <SelectTrigger className="bg-white border-gray-300 text-gray-900"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-white text-gray-900">
                  {stages.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-gray-700">Origem</Label>
              <Select value={newLead.source} onValueChange={v => setNewLead(p => ({ ...p, source: v }))}>
                <SelectTrigger className="bg-white border-gray-300 text-gray-900"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                <SelectContent className="bg-white text-gray-900">
                  {["instagram", "whatsapp", "facebook", "manual", "indicação", "google"].map(s => <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-gray-700">Tags (separadas por vírgula)</Label><Input className="bg-white border-gray-300 text-gray-900" placeholder="implante, clareamento" value={newLead.tags} onChange={e => setNewLead(p => ({ ...p, tags: e.target.value }))} /></div>
            <div><Label className="text-gray-700">Valor (R$)</Label><Input className="bg-white border-gray-300 text-gray-900" type="number" value={newLead.value} onChange={e => setNewLead(p => ({ ...p, value: e.target.value }))} /></div>
            <div><Label className="text-gray-700">Observações</Label><Textarea className="bg-white border-gray-300 text-gray-900" rows={3} value={newLead.notes} onChange={e => setNewLead(p => ({ ...p, notes: e.target.value }))} /></div>
            <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white" onClick={handleCreateLead}>Salvar Lead</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Lead Detail Sheet */}
      <Sheet open={!!detailLead} onOpenChange={() => setDetailLead(null)}>
        <SheetContent className="bg-white text-gray-900 w-[400px]">
          <SheetHeader><SheetTitle className="text-gray-900">{detailLead?.name}</SheetTitle></SheetHeader>
          {detailLead && (
            <div className="mt-4 space-y-4">
              <div>
                <span className="text-xs text-gray-500">Telefone</span>
                <p className="text-sm text-gray-800">{detailLead.phone || "—"}</p>
              </div>
              <div>
                <span className="text-xs text-gray-500">Origem</span>
                <p className="text-sm text-gray-800">{detailLead.source || "—"}</p>
              </div>
              <div>
                <span className="text-xs text-gray-500">Valor</span>
                <p className="text-sm text-gray-800">{detailLead.value ? formatCurrency(detailLead.value) : "—"}</p>
              </div>
              <div>
                <span className="text-xs text-gray-500">Tags</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {detailLead.tags?.map(t => <Badge key={t} variant="secondary" className="bg-gray-100 text-gray-700 text-xs">#{t}</Badge>)}
                  {(!detailLead.tags || detailLead.tags.length === 0) && <span className="text-sm text-gray-400">Nenhuma</span>}
                </div>
              </div>
              <div>
                <span className="text-xs text-gray-500">Observações</span>
                <p className="text-sm text-gray-800 whitespace-pre-wrap">{detailLead.notes || "Sem observações"}</p>
              </div>
              <div>
                <span className="text-xs text-gray-500">Criado em</span>
                <p className="text-sm text-gray-800">{new Date(detailLead.created_at).toLocaleString("pt-BR")}</p>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function MetricBadge({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string | number; color: string }) {
  return (
    <div className="flex items-center gap-2 whitespace-nowrap">
      <span className={color}>{icon}</span>
      <span className="text-gray-500">{label}:</span>
      <span className={`font-semibold ${color}`}>{value}</span>
    </div>
  );
}
