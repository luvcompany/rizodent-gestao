import { useState, useEffect, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
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
  color?: string;
};

const PRESET_COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16",
  "#22c55e", "#10b981", "#14b8a6", "#06b6d4", "#0ea5e9",
  "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#d946ef",
  "#ec4899", "#f43f5e", "#78716c", "#64748b", "#1e293b",
];

export default function CrmKanban() {
  const navigate = useNavigate();
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [newLeadOpen, setNewLeadOpen] = useState(false);
  const [detailLead, setDetailLead] = useState<Lead | null>(null);
  const [viewMode, setViewMode] = useState<"kanban" | "list">("kanban");
  const [searchTerm, setSearchTerm] = useState("");

  // New stage between columns
  const [newStageOpen, setNewStageOpen] = useState(false);
  const [newStageInsertIdx, setNewStageInsertIdx] = useState<number | null>(null);
  const [newStageName, setNewStageName] = useState("");
  const [newStageColor, setNewStageColor] = useState("#6366f1");
  const [useCustomColor, setUseCustomColor] = useState(false);

  const [newLead, setNewLead] = useState({
    name: "", phone: "", stage_id: "", source: "", tags: "", value: "", notes: ""
  });

  const fetchData = useCallback(async (selectedPipelineId?: string) => {
    setLoading(true);
    const { data: allPipelines } = await supabase.from("crm_pipelines").select("*").order("created_at");
    const pList = (allPipelines as Pipeline[]) || [];
    setPipelines(pList);
    const p = selectedPipelineId
      ? pList.find(pp => pp.id === selectedPipelineId) || pList[0]
      : pList[0];
    if (p) {
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

  const handleAddStage = async () => {
    if (!newStageName || !pipeline) return;
    // If inserting between columns, shift positions
    const insertPos = newStageInsertIdx !== null ? newStageInsertIdx + 1 : stages.length;
    // Update positions of stages after insert point
    if (newStageInsertIdx !== null) {
      for (const s of stages) {
        if (s.position >= insertPos) {
          await supabase.from("crm_stages").update({ position: s.position + 1 }).eq("id", s.id);
        }
      }
    }
    const { error } = await supabase.from("crm_stages").insert({
      pipeline_id: pipeline.id, name: newStageName, color: newStageColor, position: insertPos,
    });
    if (error) { toast.error("Erro ao criar etapa"); return; }
    toast.success("Etapa criada");
    setNewStageOpen(false);
    setNewStageName("");
    setNewStageColor("#6366f1");
    setNewStageInsertIdx(null);
    setUseCustomColor(false);
    fetchData(pipeline.id);
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
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-muted-foreground">Carregando CRM...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col bg-background -m-6" style={{ height: "calc(100vh - 4rem)", overflow: "hidden" }}>
      {/* Header - FIXED, no horizontal scroll */}
      <div style={{ flexShrink: 0, width: "100%", overflowX: "hidden" }} className="bg-card border-b border-border px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
         <div className="flex items-center gap-3 min-w-0 flex-wrap">
          {pipelines.length > 1 && (
            <select
              className="bg-secondary border border-border rounded-md px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              value={pipeline?.id || ""}
              onChange={(e) => fetchData(e.target.value)}
            >
              {pipelines.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
          <h1 className="text-lg font-bold text-foreground whitespace-nowrap">{pipeline?.name || "CRM"}</h1>
          <div className="flex items-center gap-0 border border-border rounded-md">
            <button
              onClick={() => setViewMode("kanban")}
              className={`p-1.5 rounded-l-md transition-colors ${viewMode === "kanban" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              <LayoutGrid size={16} />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`p-1.5 rounded-r-md transition-colors ${viewMode === "list" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              <List size={16} />
            </button>
          </div>
          <button className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground border border-border rounded-md px-2 py-1 transition-colors">
            <Filter size={14} /> Filtro
          </button>
          <div className="relative">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              className="pl-7 pr-3 py-1 text-sm border border-border rounded-md bg-secondary text-foreground w-48 focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
              placeholder="Buscar lead..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-muted-foreground font-medium whitespace-nowrap">{totalLeads} leads: <span className="text-primary font-semibold">{formatCurrency(totalValue)}</span></span>
          <Button variant="outline" size="sm" onClick={() => navigate("/crm/relatorios")}>
            <TrendingUp size={14} className="mr-1" /> RELATÓRIOS
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate("/crm/automacoes")}>
            <Zap size={14} className="mr-1" /> AUTOMATIZE
          </Button>
          <Button size="sm" onClick={() => { if (stages.length) { setNewLead(p => ({ ...p, stage_id: stages[0].id })); } setNewLeadOpen(true); }}>
            <Plus size={14} className="mr-1" /> NOVO LEAD
          </Button>
        </div>
      </div>

      {/* Metrics bar - FIXED, no horizontal scroll */}
      <div style={{ flexShrink: 0, width: "100%", overflowX: "hidden" }} className="bg-card border-b border-border px-6 py-2 flex items-center gap-6 text-sm flex-wrap">
        <MetricBadge icon={<Calendar size={14} />} label="Com tarefas para hoje" value={withTaskToday} variant="info" />
        <MetricBadge icon={<Users size={14} />} label="Sem tarefas atribuídas" value={noTasks} variant="muted" />
        <MetricBadge icon={<AlertTriangle size={14} />} label="Com tarefas atrasadas" value={overdue} variant="destructive" />
        <MetricBadge icon={<Clock size={14} />} label="Novo hoje / ontem" value={`${newToday} / ${newYesterday}`} variant="success" />
        <MetricBadge icon={<TrendingUp size={14} />} label="Vendas em potencial" value={formatCurrency(totalValue)} variant="primary" />
      </div>

      {/* Kanban area - SCROLLABLE horizontally */}
      <div style={{ flex: 1, overflowX: "auto", overflowY: "hidden" }} className="p-4">
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="flex gap-3 h-full min-w-max">
            {stages.map((stage, idx) => {
              const stageLeads = getLeadsForStage(stage.id);
              const stageValue = stageLeads.reduce((a, l) => a + (l.value || 0), 0);
              return (
                <div key={stage.id} className="flex items-start gap-1">
                  <div className="w-[280px] flex-shrink-0 flex flex-col bg-secondary/50 rounded-lg overflow-hidden h-full">
                    <div className="h-1 flex-shrink-0" style={{ backgroundColor: stage.color }} />
                    <div className="px-3 py-2 flex-shrink-0">
                      <div className="font-semibold text-sm text-foreground">{stage.name}</div>
                      <div className="text-xs text-muted-foreground">{stageLeads.length} leads · {formatCurrency(stageValue)}</div>
                    </div>

                    {idx === 0 && (
                      <div className="px-2 pb-1 flex-shrink-0">
                        <button
                          onClick={() => { setNewLead(p => ({ ...p, stage_id: stage.id })); setNewLeadOpen(true); }}
                          className="w-full text-xs text-primary bg-primary/10 hover:bg-primary/20 rounded py-1 flex items-center justify-center gap-1 transition-colors"
                        >
                          <Plus size={12} /> Adição rápida
                        </button>
                      </div>
                    )}

                    <Droppable droppableId={stage.id}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          className={`flex-1 overflow-y-auto px-2 pb-2 min-h-[100px] ${snapshot.isDraggingOver ? "bg-primary/5" : ""}`}
                        >
                          {stageLeads.map((lead, lIdx) => (
                            <Draggable key={lead.id} draggableId={lead.id} index={lIdx}>
                              {(prov, snap) => (
                                <Link
                                  to={`/crm/conversa/${lead.id}`}
                                  ref={prov.innerRef}
                                  {...prov.draggableProps}
                                  {...prov.dragHandleProps}
                                  className={`block bg-card rounded-lg shadow-card border border-border p-3 mb-2 cursor-pointer hover:border-primary/30 transition-all ${snap.isDragging ? "shadow-orange ring-2 ring-primary" : ""}`}
                                >
                                  <div className="flex items-start justify-between mb-1">
                                    <span className="font-medium text-sm text-foreground leading-tight">{lead.name}</span>
                                    <span className="text-[10px] text-muted-foreground whitespace-nowrap ml-2">
                                      {new Date(lead.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                                    </span>
                                  </div>
                                  <div className="text-xs text-primary mb-1.5 cursor-pointer hover:underline">
                                    Lead #{lead.id.slice(0, 8)}
                                  </div>
                                  {lead.tags && lead.tags.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mb-2">
                                      {lead.tags.map(tag => (
                                        <span key={tag} className="text-[10px] bg-secondary text-muted-foreground px-1.5 py-0.5 rounded-full">#{tag}</span>
                                      ))}
                                    </div>
                                  )}
                                  <div className="flex items-center justify-between">
                                    {lead.value ? <span className="text-xs font-medium text-primary">{formatCurrency(lead.value)}</span> : <span />}
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${lead.task_overdue ? "bg-destructive/20 text-destructive" : lead.has_task ? "bg-green-900/30 text-green-400" : "bg-primary/10 text-primary"}`}>
                                      {lead.task_overdue ? "Atrasada" : lead.has_task ? "Com tarefa" : "Sem Tarefas"}
                                    </span>
                                  </div>
                                </Link>
                              )}
                            </Draggable>
                          ))}
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>
                  </div>

                  {idx < stages.length - 1 && (
                    <button
                      onClick={() => { setNewStageInsertIdx(idx); setNewStageOpen(true); }}
                      className="flex-shrink-0 mt-8 w-6 h-6 rounded-full border border-dashed border-border text-muted-foreground hover:text-primary hover:border-primary flex items-center justify-center text-xs transition-colors"
                    >
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
        <DialogContent>
          <DialogHeader><DialogTitle>Novo Lead</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nome *</Label><Input value={newLead.name} onChange={e => setNewLead(p => ({ ...p, name: e.target.value }))} /></div>
            <div><Label>Telefone</Label><Input value={newLead.phone} onChange={e => setNewLead(p => ({ ...p, phone: e.target.value }))} /></div>
            <div>
              <Label>Etapa Inicial *</Label>
              <Select value={newLead.stage_id} onValueChange={v => setNewLead(p => ({ ...p, stage_id: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {stages.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Origem</Label>
              <Select value={newLead.source} onValueChange={v => setNewLead(p => ({ ...p, source: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                <SelectContent>
                  {["instagram", "whatsapp", "facebook", "manual", "indicação", "google"].map(s => <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Tags (separadas por vírgula)</Label><Input placeholder="implante, clareamento" value={newLead.tags} onChange={e => setNewLead(p => ({ ...p, tags: e.target.value }))} /></div>
            <div><Label>Valor (R$)</Label><Input type="number" value={newLead.value} onChange={e => setNewLead(p => ({ ...p, value: e.target.value }))} /></div>
            <div><Label>Observações</Label><Textarea rows={3} value={newLead.notes} onChange={e => setNewLead(p => ({ ...p, notes: e.target.value }))} /></div>
            <Button className="w-full" onClick={handleCreateLead}>Salvar Lead</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* New Stage Modal */}
      <Dialog open={newStageOpen} onOpenChange={(open) => { setNewStageOpen(open); if (!open) { setNewStageInsertIdx(null); setUseCustomColor(false); } }}>
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
                    onClick={() => { setNewStageColor(c); setUseCustomColor(false); }}
                    className={`w-7 h-7 rounded-md border-2 transition-all ${newStageColor === c && !useCustomColor ? "border-foreground scale-110" : "border-transparent hover:scale-105"}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <button
                onClick={() => setUseCustomColor(true)}
                className="text-xs text-muted-foreground hover:text-foreground mt-2 underline"
              >
                Cor personalizada
              </button>
              {useCustomColor && (
                <input type="color" value={newStageColor} onChange={e => setNewStageColor(e.target.value)} className="w-full h-8 rounded cursor-pointer mt-1" />
              )}
            </div>
            <Button className="w-full" onClick={handleAddStage}>Criar Etapa</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Lead Detail Sheet */}
      <Sheet open={!!detailLead} onOpenChange={() => setDetailLead(null)}>
        <SheetContent className="w-[400px]">
          <SheetHeader><SheetTitle>{detailLead?.name}</SheetTitle></SheetHeader>
          {detailLead && (
            <div className="mt-4 space-y-4">
              <div>
                <span className="text-xs text-muted-foreground">Telefone</span>
                <p className="text-sm text-foreground">{detailLead.phone || "—"}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Origem</span>
                <p className="text-sm text-foreground">{detailLead.source || "—"}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Valor</span>
                <p className="text-sm text-primary font-medium">{detailLead.value ? formatCurrency(detailLead.value) : "—"}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Tags</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {detailLead.tags?.map(t => <Badge key={t} variant="secondary" className="text-xs">#{t}</Badge>)}
                  {(!detailLead.tags || detailLead.tags.length === 0) && <span className="text-sm text-muted-foreground">Nenhuma</span>}
                </div>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Observações</span>
                <p className="text-sm text-foreground whitespace-pre-wrap">{detailLead.notes || "Sem observações"}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Criado em</span>
                <p className="text-sm text-foreground">{new Date(detailLead.created_at).toLocaleString("pt-BR")}</p>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function MetricBadge({ icon, label, value, variant }: { icon: React.ReactNode; label: string; value: string | number; variant: "info" | "muted" | "destructive" | "success" | "primary" }) {
  const colorMap = {
    info: "text-blue-400",
    muted: "text-muted-foreground",
    destructive: "text-destructive",
    success: "text-green-400",
    primary: "text-primary",
  };
  const color = colorMap[variant];
  return (
    <div className="flex items-center gap-2 whitespace-nowrap">
      <span className={color}>{icon}</span>
      <span className="text-muted-foreground">{label}:</span>
      <span className={`font-semibold ${color}`}>{value}</span>
    </div>
  );
}
