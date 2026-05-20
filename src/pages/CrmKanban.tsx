import { useState, useEffect, useCallback, useMemo } from "react";
import { toLocalDateISO } from "@/lib/utils";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { normalizePhone } from "@/lib/phoneUtils";
import { executeStageAutomations } from "@/lib/automationUtils";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import ConversationFilters, { type ConversationFilterValues, emptyFilters, countActive } from "@/components/chat/ConversationFilters";
import {
  Plus, LayoutGrid, List, Zap, Search,
  Calendar, AlertTriangle, Clock, TrendingUp, Users, MessageSquare, RefreshCw
} from "lucide-react";
import { isWithinInterval } from "date-fns";
import { getDateRangeFromFilter } from "@/components/ui/date-range-filter";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import LeadLabelsPopover, { LeadLabelChips, LeadLabelsTrigger } from "@/components/chat/LeadLabelsPopover";
import { useLeadLabels } from "@/hooks/useLeadLabels";

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
  last_message: string | null;
  last_message_at: string | null;
  assigned_to: string | null;
  cidade: string | null;
  paciente_id: string | null;
  ad_id?: string | null;
  ad_account_id?: string | null;
  ad_account_name?: string | null;
  nome_anuncio?: string | null;
  titulo_anuncio?: string | null;
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

function NewLeadStageSelector({ pipelineId, allPipelines, currentStages, currentPipelineId, value, onChange }: {
  pipelineId: string;
  allPipelines: Pipeline[];
  currentStages: Stage[];
  currentPipelineId: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [otherStages, setOtherStages] = useState<Stage[]>([]);

  useEffect(() => {
    if (!pipelineId || pipelineId === currentPipelineId) {
      setOtherStages([]);
      return;
    }
    supabase.from("crm_stages").select("id, pipeline_id, name, color, position").eq("pipeline_id", pipelineId).order("position").then(({ data }) => {
      setOtherStages((data as Stage[]) || []);
    });
  }, [pipelineId, currentPipelineId]);

  const displayStages = pipelineId === currentPipelineId ? currentStages : otherStages;

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder="Selecione a etapa" /></SelectTrigger>
      <SelectContent>
        {displayStages.map(s => (
          <SelectItem key={s.id} value={s.id}>
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
              {s.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// Cache de módulo: sobrevive à navegação entre páginas, TTL de 2 minutos.
type KanbanCacheEntry = {
  pipelines: Pipeline[];
  stages: Stage[];
  leads: Lead[];
  profiles: { id: string; nome: string }[];
  followUpLeads: Record<string, string>;
  vendasConcluidas: number;
  leadMonthValueMap: Map<string, number>;
  leadAllTimeValueMap: Map<string, number>;
  leadsWithPagamento: Set<string>;
};
const kanbanDataCache: {
  pipelineId: string | null;
  entry: KanbanCacheEntry | null;
  timestamp: number;
} = { pipelineId: null, entry: null, timestamp: 0 };
const KANBAN_CACHE_TTL = 2 * 60_000;
export const invalidateKanbanCache = () => { kanbanDataCache.timestamp = 0; };

export default function CrmKanban() {
  const navigate = useNavigate();
  const { user, userRole } = useAuth();
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [newLeadOpen, setNewLeadOpen] = useState(false);
  const [detailLead, setDetailLead] = useState<Lead | null>(null);
  const [viewMode, setViewMode] = useState<"kanban" | "list">("kanban");
  const [searchTerm, setSearchTerm] = useState(() => {
    try { return localStorage.getItem("crm:kanbanSearch") || ""; } catch { return ""; }
  });
  const [kanbanFilters, setKanbanFilters] = useState<ConversationFilterValues>(() => {
    try {
      const saved = localStorage.getItem("crm:kanbanFilters");
      return saved ? JSON.parse(saved) : emptyFilters;
    } catch { return emptyFilters; }
  });
  const [profiles, setProfiles] = useState<{ id: string; nome: string }[]>([]);
  const [followUpLeads, setFollowUpLeads] = useState<Record<string, string>>({});
  const [leadsWithPagamento, setLeadsWithPagamento] = useState<Set<string>>(new Set());
  const { labelsByLead } = useLeadLabels();

  // New stage between columns
  const [newStageOpen, setNewStageOpen] = useState(false);
  const [newStageInsertIdx, setNewStageInsertIdx] = useState<number | null>(null);
  const [newStageName, setNewStageName] = useState("");
  const [newStageColor, setNewStageColor] = useState("#6366f1");
  const [useCustomColor, setUseCustomColor] = useState(false);

  const [newLead, setNewLead] = useState({
    name: "", phone: "", stage_id: "", source: "", tags: "", value: "", notes: "", pipeline_id: ""
  });

  // Duplicate lead detection state
  const [duplicateInfo, setDuplicateInfo] = useState<{
    existingLeadId: string;
    existingLeadName: string;
    ownerName: string;
    ownerId: string | null;
    phone: string;
  } | null>(null);
  const [transferring, setTransferring] = useState(false);

  const fetchData = useCallback(async (selectedPipelineId?: string) => {
    const stored = typeof window !== "undefined" ? localStorage.getItem("crm:lastPipelineId") : null;
    const targetPipelineId = selectedPipelineId || pipeline?.id || stored || undefined;
    const isPosvendaOnly = userRole === "posvenda";

    // ── Cache hit: serve os dados instantaneamente ──────────────────────────
    if (
      kanbanDataCache.entry &&
      kanbanDataCache.pipelineId === (targetPipelineId ?? null) &&
      Date.now() - kanbanDataCache.timestamp < KANBAN_CACHE_TTL
    ) {
      const e = kanbanDataCache.entry;
      setPipelines(e.pipelines);
      const p = e.pipelines.find(pp => pp.id === targetPipelineId) || e.pipelines[0];
      if (p) setPipeline(p);
      setStages(e.stages);
      setLeads(e.leads);
      setProfiles(e.profiles);
      setFollowUpLeads(e.followUpLeads);
      setVendasConcluidas(e.vendasConcluidas);
      setLeadMonthValueMap(e.leadMonthValueMap);
      setLeadAllTimeValueMap(e.leadAllTimeValueMap);
      setLeadsWithPagamento(e.leadsWithPagamento);
      setLoading(false);
      return;
    }

    setLoading(true);

    const now = new Date();
    const monthStart = toLocalDateISO(new Date(now.getFullYear(), now.getMonth(), 1));
    const monthEnd = toLocalDateISO(new Date(now.getFullYear(), now.getMonth() + 1, 0));

    const LEAD_COLS = "id, pipeline_id, stage_id, name, phone, tags, source, value, has_task, task_overdue, notes, position, created_at, updated_at, last_message, last_message_at, assigned_to, cidade, paciente_id, ad_id, ad_account_id, ad_account_name, nome_anuncio, titulo_anuncio";
    const fetchAllLeads = async (pipelineId: string): Promise<Lead[]> => {
      const PAGE = 1000;
      const out: Lead[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("crm_leads")
          .select(LEAD_COLS)
          .eq("pipeline_id", pipelineId)
          .eq("is_blocked", false)
          .order("position")
          .range(from, from + PAGE - 1);
        if (error || !data || data.length === 0) break;
        out.push(...(data as Lead[]));
        if (data.length < PAGE) break;
        from += PAGE;
      }
      return out;
    };

    // ── Fase 1: pipelines, perfis, etapas, leads e followups em paralelo ────
    const [pipelinesRes, profilesRes, stagesRes, leadsAll, fqRes] = await Promise.all([
      supabase.from("crm_pipelines").select("id, name, color, description, created_at").order("created_at"),
      supabase.from("profiles").select("id, nome"),
      targetPipelineId
        ? supabase.from("crm_stages").select("id, pipeline_id, name, color, position").eq("pipeline_id", targetPipelineId).order("position")
        : Promise.resolve({ data: null }),
      targetPipelineId ? fetchAllLeads(targetPipelineId) : Promise.resolve([] as Lead[]),
      supabase.from("crm_followup_queue").select("lead_id, status").in("status", ["waiting_disparo1", "waiting_disparo2", "paused", "responded"]),
    ]);

    const pList = (pipelinesRes.data as Pipeline[]) || [];
    const principal = pList.find(pp => /funil principal/i.test(pp.name)) || pList[0];
    const defaultPipeline = isPosvendaOnly
      ? (pList.find(pp => /p[óo]s.?venda/i.test(pp.name)) || pList[0])
      : principal;

    let p: Pipeline | undefined;
    if (selectedPipelineId) {
      p = pList.find(pp => pp.id === selectedPipelineId) || defaultPipeline;
    } else if (pipeline?.id) {
      p = pList.find(pp => pp.id === pipeline.id) || defaultPipeline;
    } else if (stored && pList.find(pp => pp.id === stored)) {
      const storedPipeline = pList.find(pp => pp.id === stored)!;
      if (!isPosvendaOnly && /p[óo]s.?venda/i.test(storedPipeline.name)) {
        p = defaultPipeline;
      } else {
        p = storedPipeline;
      }
    } else {
      p = defaultPipeline;
    }

    if (!p) { setLoading(false); return; }

    setPipelines(pList);
    setPipeline(p);
    try { localStorage.setItem("crm:lastPipelineId", p.id); } catch {}

    let finalStages: Stage[];
    let finalLeads: Lead[];
    if (targetPipelineId === p.id && stagesRes.data && leadsAll) {
      finalStages = (stagesRes.data as Stage[]) || [];
      finalLeads = leadsAll as Lead[];
    } else {
      const [s2, l2] = await Promise.all([
        supabase.from("crm_stages").select("id, pipeline_id, name, color, position").eq("pipeline_id", p.id).order("position"),
        fetchAllLeads(p.id),
      ]);
      finalStages = (s2.data as Stage[]) || [];
      finalLeads = l2;
    }

    setStages(finalStages);
    setLeads(finalLeads);

    const fqMap: Record<string, string> = {};
    (fqRes.data || []).forEach((fq: any) => { fqMap[fq.lead_id] = fq.status; });
    setFollowUpLeads(fqMap);
    const finalProfiles = (profilesRes.data as { id: string; nome: string }[]) || [];
    setProfiles(finalProfiles);

    // ── Fase 2: vínculos paciente↔lead filtrados pelos leads do pipeline ────
    // Busca apenas os vínculos dos leads já carregados — evita trazer o tenant inteiro.
    const leadIds = finalLeads.map(l => l.id);
    let vendasConcluidasVal = 0;
    const monthMap = new Map<string, number>();
    const allTimeMap = new Map<string, number>();
    const paidLeadIds = new Set<string>();

    if (leadIds.length > 0) {
      const { data: linksData } = await supabase
        .from("crm_lead_pacientes")
        .select("lead_id, paciente_id, is_primary")
        .in("lead_id", leadIds);

      const links = (linksData || []) as { lead_id: string; paciente_id: string; is_primary: boolean }[];
      const pacienteToLead = new Map<string, string>();
      links.forEach(l => {
        const existing = pacienteToLead.get(l.paciente_id);
        if (!existing || l.is_primary) pacienteToLead.set(l.paciente_id, l.lead_id);
      });
      const pacienteIds = [...new Set(links.map(l => l.paciente_id))];

      if (pacienteIds.length > 0) {
      // Busca em paralelo: pagamentos do mês e de todos os tempos,
      // ambos filtrados pelos pacienteIds conhecidos (muito mais rápido).
      const [{ data: pags }, { data: allPags }] = await Promise.all([
        supabase.from("pagamentos").select("valor, paciente_id")
          .in("paciente_id", pacienteIds)
          .gte("data_pagamento", monthStart).lte("data_pagamento", monthEnd),
        supabase.from("pagamentos").select("paciente_id, valor")
          .in("paciente_id", pacienteIds),
      ]);

      (pags || []).forEach((pg: any) => {
        const v = Number(pg.valor || 0);
        vendasConcluidasVal += v;
        const leadId = pacienteToLead.get(pg.paciente_id);
        if (leadId) monthMap.set(leadId, (monthMap.get(leadId) || 0) + v);
      });

      (allPags || []).forEach((pg: any) => {
        const leadId = pacienteToLead.get(pg.paciente_id);
        if (leadId) {
          const v = Number(pg.valor || 0);
          allTimeMap.set(leadId, (allTimeMap.get(leadId) || 0) + v);
          paidLeadIds.add(leadId);
        }
      });
      } // fecha if (pacienteIds.length > 0)
    } // fecha if (leadIds.length > 0)

    setVendasConcluidas(vendasConcluidasVal);
    setLeadMonthValueMap(monthMap);
    setLeadAllTimeValueMap(allTimeMap);
    setLeadsWithPagamento(paidLeadIds);

    // ── Salva no cache ───────────────────────────────────────────────────────
    kanbanDataCache.pipelineId = p.id;
    kanbanDataCache.timestamp = Date.now();
    kanbanDataCache.entry = {
      pipelines: pList,
      stages: finalStages,
      leads: finalLeads,
      profiles: finalProfiles,
      followUpLeads: fqMap,
      vendasConcluidas: vendasConcluidasVal,
      leadMonthValueMap: monthMap,
      leadAllTimeValueMap: allTimeMap,
      leadsWithPagamento: paidLeadIds,
    };

    setLoading(false);
  }, [pipeline?.id, userRole]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Persiste filtros e busca no localStorage para sobreviver à navegação
  useEffect(() => {
    try { localStorage.setItem("crm:kanbanFilters", JSON.stringify(kanbanFilters)); } catch {}
  }, [kanbanFilters]);

  useEffect(() => {
    try { localStorage.setItem("crm:kanbanSearch", searchTerm); } catch {}
  }, [searchTerm]);

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination) return;
    const leadId = result.draggableId;
    const newStageId = result.destination.droppableId;
    const newPosition = result.destination.index;
    const movedLead = leads.find(l => l.id === leadId);
    const previousStageId = movedLead?.stage_id;

    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, stage_id: newStageId, position: newPosition } : l));
    const { error } = await supabase.from("crm_leads").update({
      stage_id: newStageId, position: newPosition, updated_at: new Date().toISOString()
    }).eq("id", leadId);
    if (error) { toast.error("Erro ao mover lead"); fetchData(); return; }

    // Register stage history and system message (same as chat hook)
    if (previousStageId && previousStageId !== newStageId) {
      // Close previous stage history entry
      const { data: openEntry } = await supabase
        .from("crm_lead_stage_history")
        .select("id")
        .eq("lead_id", leadId)
        .eq("stage_id", previousStageId)
        .is("exited_at", null)
        .maybeSingle();

      if (openEntry) {
        await supabase.from("crm_lead_stage_history").update({ exited_at: new Date().toISOString() }).eq("id", openEntry.id);
      }

      // Insert new stage history entry (with from_stage_id)
      await supabase.from("crm_lead_stage_history").insert({
        lead_id: leadId,
        stage_id: newStageId,
        from_stage_id: previousStageId,
        entered_at: new Date().toISOString(),
      } as any);

      // Insert system message
      const fromName = stages.find(s => s.id === previousStageId)?.name || "?";
      const toName = stages.find(s => s.id === newStageId)?.name || "?";
      await supabase.from("messages").insert({
        lead_id: leadId,
        direction: "outbound",
        type: "system",
        content: `📋 Etapa alterada: ${fromName} → ${toName}`,
        status: "system",
      });

      // Execute automations for the new stage (on_enter + on_create_or_enter)
      executeStageAutomations({
        leadId,
        stageId: newStageId,
        leadPhone: movedLead?.phone,
        triggerTypes: ["on_enter", "on_create_or_enter"],
      });
    }

  };

  const handleCreateLead = async () => {
    const targetPipeline = newLead.pipeline_id ? pipelines.find(p => p.id === newLead.pipeline_id) : pipeline;
    if (!newLead.name || !newLead.stage_id || !targetPipeline) {
      toast.error("Nome e etapa são obrigatórios");
      return;
    }
    const normalizedPhone = newLead.phone ? normalizePhone(newLead.phone) : null;

    // Check for duplicate phone using security definer function (bypasses RLS)
    if (normalizedPhone) {
      const { data: existing } = await supabase
        .rpc("check_duplicate_phone", { p_phone: normalizedPhone });

      if (existing && existing.length > 0) {
        const dup = existing[0];
        const ownerProfile = profiles.find(p => p.id === dup.assigned_to);
        setDuplicateInfo({
          existingLeadId: dup.lead_id,
          existingLeadName: dup.lead_name,
          ownerName: ownerProfile?.nome || "Sem responsável",
          ownerId: dup.assigned_to,
          phone: normalizedPhone,
        });
        return;
      }
    }

    await insertNewLead(normalizedPhone);
  };

  const insertNewLead = async (normalizedPhone: string | null) => {
    const targetPipeline = newLead.pipeline_id ? pipelines.find(p => p.id === newLead.pipeline_id) : pipeline;
    if (!targetPipeline) return;
    const tagsArray = newLead.tags ? newLead.tags.split(",").map(t => t.trim()).filter(Boolean) : [];
    const { data: insertedLead, error } = await supabase.from("crm_leads").insert({
      name: newLead.name,
      phone: normalizedPhone,
      stage_id: newLead.stage_id,
      pipeline_id: targetPipeline.id,
      source: newLead.source || null,
      tags: tagsArray,
      value: newLead.value ? parseFloat(newLead.value) : 0,
      notes: newLead.notes || null,
      position: leads.filter(l => l.stage_id === newLead.stage_id).length,
      assigned_to: user?.id || null,
    }).select("id").single();
    if (error) { toast.error("Erro ao criar lead"); return; }
    toast.success("Lead criado com sucesso");
    invalidateKanbanCache();
    // Execute automations for lead creation (on_create + on_create_or_enter)
    if (insertedLead?.id) {
      executeStageAutomations({
        leadId: insertedLead.id,
        stageId: newLead.stage_id,
        leadPhone: normalizedPhone,
        triggerTypes: ["on_create", "on_create_or_enter"],
      });
    }
    setNewLeadOpen(false);
    setNewLead({ name: "", phone: "", stage_id: "", source: "", tags: "", value: "", notes: "", pipeline_id: "" });
    fetchData();
  };

  const handleTransferDuplicate = async () => {
    if (!duplicateInfo || !user) return;
    setTransferring(true);
    try {
      const { data, error } = await supabase.functions.invoke("transfer-lead", {
        body: { leadId: duplicateInfo.existingLeadId, newUserId: user.id },
      });
      if (error) throw error;
      toast.success(`Lead "${duplicateInfo.existingLeadName}" transferido para você com todo o histórico!`);
      invalidateKanbanCache();
      setDuplicateInfo(null);
      setNewLeadOpen(false);
      setNewLead({ name: "", phone: "", stage_id: "", source: "", tags: "", value: "", notes: "", pipeline_id: "" });
      fetchData();
    } catch (err: any) {
      toast.error("Erro ao transferir: " + (err.message || "Erro desconhecido"));
    } finally {
      setTransferring(false);
    }
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
    invalidateKanbanCache();
    setNewStageOpen(false);
    setNewStageName("");
    setNewStageColor("#6366f1");
    setNewStageInsertIdx(null);
    setUseCustomColor(false);
    fetchData(pipeline.id);
  };

  // Apply filters to leads
  const applyFilters = useCallback((list: Lead[]) => {
    return list.filter((l) => {
      if (searchTerm) {
        const s = searchTerm.toLowerCase();
        const searchDigits = s.replace(/\D/g, "");
        const phoneDigits = (l.phone || "").replace(/\D/g, "");
        const matchesText = l.name.toLowerCase().includes(s) || (l.phone || "").toLowerCase().includes(s);
        const matchesPhone = searchDigits.length >= 3 && phoneDigits.includes(searchDigits);
        if (!matchesText && !matchesPhone) return false;
      }
      if (kanbanFilters.dateFilter.preset !== "all") {
        const d = new Date(l.created_at);
        const range = getDateRangeFromFilter(kanbanFilters.dateFilter);
        if (range && !isWithinInterval(d, { start: range.start, end: range.end })) return false;
      }
      if (kanbanFilters.stageId && l.stage_id !== kanbanFilters.stageId) return false;
      if (kanbanFilters.tags.length && !kanbanFilters.tags.some((t) => l.tags?.includes(t))) return false;
      if (kanbanFilters.source) {
        if (kanbanFilters.source === "anuncio") {
          const s = (l.source || "").toLowerCase();
          if (!s.includes("_ad") && s !== "anuncio" && s !== "anúncio") return false;
        } else if (l.source?.toLowerCase() !== kanbanFilters.source.toLowerCase()) return false;
      }
      if (kanbanFilters.cidade && (l.cidade || "") !== kanbanFilters.cidade) return false;
      if (kanbanFilters.adAccountId && (l.ad_account_id || "") !== kanbanFilters.adAccountId) return false;
      if (kanbanFilters.adId && (l.ad_id || "") !== kanbanFilters.adId) return false;
      if (kanbanFilters.hasPagamento) {
        const hasPag = leadsWithPagamento.has(l.id);
        if (kanbanFilters.hasPagamento === "yes" && !hasPag) return false;
        if (kanbanFilters.hasPagamento === "no" && hasPag) return false;
      }
      if (kanbanFilters.labelIds && kanbanFilters.labelIds.length) {
        const leadLabelIds = labelsByLead(l.id).map(x => x.id);
        if (!kanbanFilters.labelIds.some(id => leadLabelIds.includes(id))) return false;
      }
      return true;
    });
  }, [searchTerm, kanbanFilters, user?.id, leadsWithPagamento, labelsByLead]);

  const allFilteredLeads = useMemo(() => applyFilters(leads), [leads, applyFilters]);

  // Pré-computa os leads de cada etapa UMA vez — não re-executa ao digitar no modal
  const stageLeadsMap = useMemo(() => {
    const map = new Map<string, Lead[]>();
    for (const stage of stages) {
      const filtered = applyFilters(leads.filter(l => l.stage_id === stage.id));
      filtered.sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      map.set(stage.id, filtered);
    }
    return map;
  }, [stages, leads, applyFilters]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    leads.forEach((l) => l.tags?.forEach((t: string) => set.add(t)));
    return Array.from(set);
  }, [leads]);

  const { adAccounts, ads } = useMemo(() => {
    const accMap = new Map<string, string>();
    const adMap = new Map<string, { name: string; ad_account_id: string | null; image: string | null; description: string | null; link: string | null }>();
    leads.forEach((l: any) => {
      if (l.ad_account_id) accMap.set(l.ad_account_id, l.ad_account_name || l.ad_account_id);
      if (l.ad_id && !adMap.has(l.ad_id)) {
        adMap.set(l.ad_id, {
          name: l.nome_anuncio || l.titulo_anuncio || l.ad_id,
          ad_account_id: l.ad_account_id || null,
          image: l.imagem_origem || null,
          description: l.descricao_anuncio || l.titulo_anuncio || null,
          link: l.link_anuncio || null,
        });
      }
    });
    return {
      adAccounts: Array.from(accMap, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
      ads: Array.from(adMap, ([id, v]) => ({ id, ...v })).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }, [leads]);
  const myLeads = allFilteredLeads;
  const withTaskToday = myLeads.filter(l => l.has_task && !l.task_overdue).length;
  const noTasks = myLeads.filter(l => !l.has_task).length;
  const overdue = myLeads.filter(l => l.task_overdue).length;
  const today = toLocalDateISO();
  const yesterday = toLocalDateISO(new Date(Date.now() - 86400000));
  const newToday = myLeads.filter(l => l.created_at.startsWith(today)).length;
  const newYesterday = myLeads.filter(l => l.created_at.startsWith(yesterday)).length;

  // Estados de pagamento — preenchidos dentro do fetchData (sem useEffect separado)
  const [vendasConcluidas, setVendasConcluidas] = useState(0);
  const [leadMonthValueMap, setLeadMonthValueMap] = useState<Map<string, number>>(new Map());
  const [leadAllTimeValueMap, setLeadAllTimeValueMap] = useState<Map<string, number>>(new Map());

  const formatCurrency = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  if (loading && leads.length === 0) {
    return (
      <div className="flex flex-col bg-background -m-6" style={{ height: "calc(100vh - 4rem)", overflow: "hidden" }}>
        <div className="bg-card border-b border-border px-6 py-3 flex items-center gap-4 h-14">
          <div className="h-4 w-32 bg-muted animate-pulse rounded" />
          <div className="h-8 w-24 bg-muted animate-pulse rounded ml-auto" />
        </div>
        <div className="bg-card border-b border-border px-6 py-2 flex items-center gap-6 h-10">
          {[1,2,3,4,5].map(i => <div key={i} className="h-4 w-28 bg-muted animate-pulse rounded" />)}
        </div>
        <div className="flex gap-3 p-4 flex-1">
          {[1,2,3,4,5].map(i => (
            <div key={i} className="w-[280px] flex-shrink-0 bg-secondary/50 rounded-lg p-3 space-y-2">
              <div className="h-4 w-24 bg-muted animate-pulse rounded" />
              {[1,2,3].map(j => <div key={j} className="h-16 bg-muted animate-pulse rounded" />)}
            </div>
          ))}
        </div>
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
          <ConversationFilters
            stages={stages}
            profiles={profiles}
            allTags={allTags}
            filters={kanbanFilters}
            onApply={setKanbanFilters}
            pipelines={pipelines}
            adAccounts={adAccounts}
            ads={ads}
          />
          <div className="relative">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground z-10" />
            <input
              className="pl-7 pr-3 py-1 text-sm border border-border rounded-md bg-secondary text-foreground w-48 focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
              placeholder="Buscar por nome ou telefone..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
            {searchTerm.replace(/\D/g, "").length >= 3 && (() => {
              return allFilteredLeads.length > 0 && allFilteredLeads.length <= 10 ? (
                <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-card border border-border rounded-md shadow-lg max-h-48 overflow-y-auto min-w-[240px]">
                  {allFilteredLeads.slice(0, 6).map((lead) => (
                    <button
                      key={lead.id}
                      onClick={() => { navigate(`/crm/conversa/${lead.id}`); setSearchTerm(""); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-secondary/50 transition-colors border-b border-border last:border-b-0"
                    >
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-medium text-foreground truncate block">{lead.name}</span>
                        <span className="text-[10px] text-muted-foreground">{lead.phone || "Sem telefone"}</span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : null;
            })()}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-muted-foreground font-medium whitespace-nowrap">{allFilteredLeads.length} leads</span>
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
        <MetricBadge icon={<TrendingUp size={14} />} label="Vendas concluídas (mês)" value={formatCurrency(vendasConcluidas)} variant="primary" />
      </div>

      {/* Kanban area - SCROLLABLE horizontally */}
      {viewMode === "kanban" ? (
        <div
          style={{ flex: 1, overflowX: "auto", overflowY: "hidden" }}
          className="p-4"
        >
          <DragDropContext onDragEnd={handleDragEnd}>
            <div className="flex gap-3 h-full min-w-max">
              {stages.map((stage, idx) => {
                const stageLeads = stageLeadsMap.get(stage.id) || [];
                const stageValue = stageLeads.reduce((a, l) => a + (leadMonthValueMap.get(l.id) || 0), 0);
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
                                  <div
                                    ref={prov.innerRef}
                                    {...prov.draggableProps}
                                    {...prov.dragHandleProps}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => navigate(`/crm/conversa/${lead.id}`)}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter" || event.key === " ") {
                                        event.preventDefault();
                                        navigate(`/crm/conversa/${lead.id}`);
                                      }
                                    }}
                                    className={`block bg-card rounded-lg shadow-card border border-border mb-2 cursor-pointer hover:border-primary/30 transition-all overflow-hidden ${snap.isDragging ? "shadow-orange ring-2 ring-primary" : ""}`}
                                  >
                                    {/* Color stripe from labels */}
                                    {(() => {
                                      const ll = labelsByLead(lead.id);
                                      if (ll.length === 0) return null;
                                      return (
                                        <div className="flex h-1 w-full">
                                          {ll.map(l => (
                                            <div key={l.id} className="flex-1" style={{ backgroundColor: l.color }} title={l.description ? `${l.name} — ${l.description}` : l.name} />
                                          ))}
                                        </div>
                                      );
                                    })()}
                                    <div className="p-3">
                                    <div className="flex items-start justify-between mb-1">
                                      <div className="flex items-center gap-1">
                                        <span className="font-medium text-sm text-foreground leading-tight">{lead.name}</span>
                                        {followUpLeads[lead.id] && (
                                          <TooltipProvider>
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <RefreshCw size={12} className={followUpLeads[lead.id] === "responded" ? "text-green-500" : "text-amber-500"} />
                                              </TooltipTrigger>
                                              <TooltipContent>
                                                <p className="text-xs">{followUpLeads[lead.id] === "responded" ? "Respondeu ao follow up" : "Follow up ativo"}</p>
                                              </TooltipContent>
                                            </Tooltip>
                                          </TooltipProvider>
                                        )}
                                      </div>
                                       <div
                                         className="flex items-center gap-1 ml-2"
                                         onPointerDown={(e) => e.stopPropagation()}
                                         onMouseDown={(e) => e.stopPropagation()}
                                         onClick={(e) => e.stopPropagation()}
                                       >
                                         <LeadLabelsPopover leadId={lead.id} trigger={<LeadLabelsTrigger leadId={lead.id} />} />
                                        <span className="text-[10px] text-muted-foreground whitespace-nowrap" title="Data de entrada do lead">
                                          {(() => {
                                            const d = new Date(lead.created_at);
                                            const today = new Date();
                                            const yest = new Date(Date.now() - 86400000);
                                            if (d.toDateString() === today.toDateString())
                                              return `Hoje ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
                                            if (d.toDateString() === yest.toDateString()) return "Ontem";
                                            return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
                                          })()}
                                        </span>
                                      </div>
                                    </div>
                                    <div className="text-xs text-primary mb-0.5 cursor-pointer hover:underline">
                                      Lead #{lead.id.slice(0, 8)}
                                    </div>
                                    <LeadLabelChips leadId={lead.id} />
                                    {lead.tags && lead.tags.length > 0 && (
                                      <div className="flex flex-wrap gap-1 mb-2 mt-1">
                                        {lead.tags.map(tag => (
                                          <span key={tag} className="text-[10px] bg-secondary text-muted-foreground px-1.5 py-0.5 rounded-full">#{tag}</span>
                                        ))}
                                      </div>
                                    )}
                                    <div className="flex items-center justify-between mt-1">
                                      {(() => {
                                        // Prioriza valor de pagamento real vinculado (all-time);
                                        // se não houver, cai no valor manual do lead.
                                        const paidValue = leadAllTimeValueMap.get(lead.id);
                                        const displayValue = paidValue ?? (lead.value || null);
                                        return displayValue
                                          ? <span className="text-xs font-medium text-primary">{formatCurrency(displayValue)}</span>
                                          : <span />;
                                      })()}
                                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${lead.task_overdue ? "bg-destructive/20 text-destructive" : lead.has_task ? "bg-green-900/30 text-green-400" : "bg-primary/10 text-primary"}`}>
                                        {lead.task_overdue ? "Atrasada" : lead.has_task ? "Com tarefa" : "Sem Tarefas"}
                                      </span>
                                    </div>
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
      ) : (
        /* LIST VIEW */
        <div style={{ flex: 1, overflowY: "auto" }} className="p-4">
          <div className="bg-card rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/50">
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Nome</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Telefone</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Etapa</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Origem</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Valor</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Tags</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Status</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Criado em</th>
                </tr>
              </thead>
              <tbody>
                {allFilteredLeads.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-muted-foreground">
                      <MessageSquare size={24} className="mx-auto mb-2 opacity-50" />
                      Nenhum lead encontrado
                    </td>
                  </tr>
                ) : (
                  allFilteredLeads.map((lead) => {
                    const stage = stages.find((s) => s.id === lead.stage_id);
                    return (
                      <tr key={lead.id} className="border-b border-border hover:bg-secondary/30 transition-colors">
                        <td className="px-4 py-2.5">
                          <Link to={`/crm/conversa/${lead.id}`} className="font-medium text-foreground hover:text-primary transition-colors">
                            {lead.name}
                          </Link>
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">{lead.phone || "—"}</td>
                        <td className="px-4 py-2.5">
                          {stage && (
                            <span className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: stage.color }} />
                              <span className="text-foreground">{stage.name}</span>
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">{lead.source || "—"}</td>
                        <td className="px-4 py-2.5 text-primary font-medium">{lead.value ? formatCurrency(lead.value) : "—"}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {lead.tags?.map((t: string) => (
                              <Badge key={t} variant="secondary" className="text-[10px]">#{t}</Badge>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${lead.task_overdue ? "bg-destructive/20 text-destructive" : lead.has_task ? "bg-green-900/30 text-green-400" : "bg-primary/10 text-primary"}`}>
                            {lead.task_overdue ? "Atrasada" : lead.has_task ? "Com tarefa" : "Sem Tarefas"}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground text-xs">
                          {new Date(lead.created_at).toLocaleDateString("pt-BR")}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* New Lead Modal */}
      <Dialog open={newLeadOpen} onOpenChange={setNewLeadOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Novo Lead</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nome *</Label><Input value={newLead.name} onChange={e => setNewLead(p => ({ ...p, name: e.target.value }))} /></div>
            <div><Label>Telefone</Label><Input value={newLead.phone} onChange={e => setNewLead(p => ({ ...p, phone: e.target.value }))} /></div>
            <div>
              <Label>Funil *</Label>
              <Select value={newLead.pipeline_id || pipeline?.id || ""} onValueChange={v => setNewLead(p => ({ ...p, pipeline_id: v, stage_id: "" }))}>
                <SelectTrigger><SelectValue placeholder="Selecione o funil" /></SelectTrigger>
                <SelectContent>
                  {pipelines.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Etapa Inicial *</Label>
              <NewLeadStageSelector
                pipelineId={newLead.pipeline_id || pipeline?.id || ""}
                allPipelines={pipelines}
                currentStages={stages}
                currentPipelineId={pipeline?.id || ""}
                value={newLead.stage_id}
                onChange={v => setNewLead(p => ({ ...p, stage_id: v }))}
              />
            </div>
            <div>
              <Label>Origem</Label>
              <Select value={newLead.source} onValueChange={v => setNewLead(p => ({ ...p, source: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                <SelectContent>
                  {["instagram", "whatsapp", "facebook", "facebook_ad", "instagram_ad", "manual", "indicação", "google"].map(s => <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>)}
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

      {/* Duplicate Lead Modal */}
      <Dialog open={!!duplicateInfo} onOpenChange={(open) => { if (!open) setDuplicateInfo(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><AlertTriangle size={18} className="text-yellow-500" /> Lead Já Existente</DialogTitle></DialogHeader>
          {duplicateInfo && (
            <div className="space-y-4">
              <div className="bg-secondary rounded-lg p-4 space-y-2">
                <p className="text-sm">
                  Já existe um lead com o telefone <strong>{duplicateInfo.phone}</strong>:
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <Users size={14} className="text-primary" />
                  <span className="text-sm font-medium">{duplicateInfo.existingLeadName}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Responsável: <strong>{duplicateInfo.ownerName}</strong>
                </p>
              </div>

              {duplicateInfo.ownerId !== user?.id ? (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Deseja solicitar a transferência deste lead para você? Todo o histórico de conversas será mantido.
                  </p>
                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1" onClick={() => setDuplicateInfo(null)}>
                      Cancelar
                    </Button>
                    <Button className="flex-1" onClick={handleTransferDuplicate} disabled={transferring}>
                      <RefreshCw size={14} className={`mr-2 ${transferring ? "animate-spin" : ""}`} />
                      {transferring ? "Transferindo..." : "Transferir para mim"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Este lead já está atribuído a você.
                  </p>
                  <Button variant="outline" className="w-full" onClick={() => setDuplicateInfo(null)}>
                    Fechar
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>


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
