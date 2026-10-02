import { useState, useEffect, useCallback, useMemo, useRef, memo } from "react";
import { ORIGENS_LEAD, rotuloOrigemLead } from "@/lib/origensLead";
import { nomeDoNumero } from "@/contexts/WhatsappCallContext";
import { podeCriarNoFunil, mensagemDeErroNoFunil } from "@/lib/permissoesFunil";
import { normalizaNomeEtapa } from "@/lib/etapaFuncao";
import { contagem } from "@/lib/plural";
import { toLocalDateISO } from "@/lib/utils";
import { useNavigate, Link } from "react-router-dom";
import { HIDDEN_USER_IDS_PG } from "@/lib/hiddenUsers";
import { supabase } from "@/integrations/supabase/client";
import { anotarNoHistorico } from "@/lib/notaDeSistema";
import { useAuth } from "@/contexts/AuthContext";
import { getMyWhatsappNumberId, numeroDoLeadNovo } from "@/lib/mundoNumero";
import { useNumerosLiberados } from "@/hooks/useNumerosLiberados";
import { useVocab } from "@/hooks/useVocab";
import { useCidadesDoTenant } from "@/hooks/useOpcoesDoTenant";
import { mensagemDeErro } from "@/lib/mensagemDeErro";
import { motivoDoServidor } from "@/lib/erroDeFuncao";
import { contaComoFaturamento, leadSourceMatchesFilter, hojeNoFuso, rangeNoFuso } from "@/lib/reportKit";
import { useHidratarLeadsAvisados } from "@/hooks/useHidratarLeadsAvisados";
import { toast } from "sonner";
import { normalizePhone, lerTelefoneDigitado, formatPhoneDisplayBR } from "@/lib/phoneUtils";
import { cacheDoKanbanVale } from "@/lib/kanbanFresco";
import { contaComoLeadNovo } from "@/lib/leadNovo";
import { ehEtapaDesqualificado, gravarMotivoDesqualificacao } from "@/lib/desqualificacao";
import MotivoDesqualificacaoDialog from "@/components/crm/MotivoDesqualificacaoDialog";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ConversationFilters, { SEM_NUMERO, type ConversationFilterValues, emptyFilters, countActive } from "@/components/chat/ConversationFilters";
import {
  Plus, LayoutGrid, List, Zap, Search,
  Calendar, AlertTriangle, Clock, TrendingUp, Users, MessageSquare, RefreshCw,
  ChevronDown, UserPlus, History
} from "lucide-react";
import { isWithinInterval } from "date-fns";
import { getDateRangeFromFilter } from "@/components/ui/date-range-filter";
import LeadLabelsPopover, { LeadLabelChips, LeadLabelsTrigger } from "@/components/chat/LeadLabelsPopover";
import { useLeadLabels } from "@/hooks/useLeadLabels";

type Stage = {
  id: string;
  pipeline_id: string;
  name: string;
  color: string;
  position: number;
  is_won?: boolean | null;
  funcao?: string | null;
};

type Lead = {
  criado_pela_conciliacao?: boolean | null;
  whatsapp_number_id?: string | null;
  imagem_origem?: string | null;
  descricao_anuncio?: string | null;
  link_anuncio?: string | null;
  id: string;
  pipeline_id: string;
  stage_id: string;
  name: string;
  phone: string | null;
  tags: string[];
  source: string | null;
  value: number | null;
  notes: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  last_message: string | null;
  last_message_at: string | null;
  assigned_to: string | null;
  cidade: string | null;
  servico_interesse?: string | null;
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
  is_default?: boolean | null;
  is_instagram?: boolean | null;
  is_posvenda?: boolean | null;
  // Autoria (migration 20260910160000): a SDR só mexe na estrutura do funil que
  // ela criou. NULL = funil da clínica, e nele ela não escreve.
  created_by?: string | null;
  allowed_roles?: string[] | null;
};

const PRESET_COLORS = [
  // eslint-disable-next-line no-restricted-syntax -- paleta escolhida pelo usuário, não é marca
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
    supabase.from("crm_stages").select("id, pipeline_id, name, color, position").eq("pipeline_id", pipelineId).order("position").order("created_at").order("id").then(({ data }) => {
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

const PAGE_SIZE = 20; // cards iniciais por coluna; o restante carrega ao rolar

// Ordem ÚNICA das colunas (a mesma da tela): created_at DESC, id DESC. A
// paginação é por chave (keyset) a partir do último card carregado nessa
// ordem — por position com .range() repetia/pulava cards (quase todos têm
// position 0) e o lead que acabou de chegar podia não aparecer.
const ordemDaColuna = (a: { created_at: string; id: string }, b: { created_at: string; id: string }) => {
  const d = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  if (d !== 0) return d;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
};
const cursorDaEtapa = <T extends { stage_id: string; created_at: string; id: string }>(lista: T[], stageId: string): T | null => {
  let ultimo: T | null = null;
  for (const l of lista) if (l.stage_id === stageId && (!ultimo || ordemDaColuna(l, ultimo) > 0)) ultimo = l;
  return ultimo;
};
const consultaDaEtapa = (stageId: string, cursor: { created_at: string; id: string } | null, limite: number, comTotal = false) => {
  let q: any = (supabase.from("crm_leads") as any)
    .select(KANBAN_LEAD_COLS, comTotal ? { count: "exact" } : undefined)
    .eq("stage_id", stageId)
    .eq("is_blocked", false);
  if (cursor) q = q.or(`created_at.lt."${cursor.created_at}",and(created_at.eq."${cursor.created_at}",id.lt.${cursor.id})`);
  return q.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limite);
};
// has_task/task_overdue saíram daqui: eram gravados por automação e ficavam
// desatualizados — o selo do card usa as tarefas reais de crm_tasks.
const KANBAN_LEAD_COLS = "id, pipeline_id, stage_id, name, phone, tags, source, value, notes, position, created_at, updated_at, last_message, last_message_at, assigned_to, cidade, servico_interesse, paciente_id, ad_id, ad_account_id, ad_account_name, nome_anuncio, titulo_anuncio, whatsapp_number_id, imagem_origem, descricao_anuncio, link_anuncio";

type NewLeadDialogProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pipelines: Pipeline[];
  stages: Stage[];
  defaultPipelineId: string;
  defaultStageId: string;
  profiles: { id: string; nome: string }[];
  userId: string | undefined;
  leadCountByStage: Record<string, number>;
  onCreated: () => void;
};

const NewLeadDialog = memo(function NewLeadDialog({
  open, onOpenChange, pipelines, stages, defaultPipelineId, defaultStageId,
  profiles, userId, leadCountByStage, onCreated,
}: NewLeadDialogProps) {
  const { userRole } = useAuth();
  const { ativos } = useNumerosLiberados();
  const { servicosInteresse } = useVocab();
  const emptyForm = { name: "", phone: "", stage_id: defaultStageId, source: "", tags: "", value: "", notes: "", pipeline_id: "", cidade: "" };
  const cidadesTenant = useCidadesDoTenant();
  const [form, setForm] = useState(emptyForm);
  const [duplicateInfo, setDuplicateInfo] = useState<{
    existingLeadId: string; existingLeadName: string;
    ownerName: string; ownerId: string | null; phone: string;
    pipelineName: string; stageName: string;
    /** Achou no mundo sem número com mundo ≠ null: única duplicata que o banco aceita. */
    podeDuplicar: boolean; carimbo: string | null;
  } | null>(null);
  const [transferring, setTransferring] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const salvandoRef = useRef(false);
  const [numeroEscolhido, setNumeroEscolhido] = useState<string>("");
  // Um id por abertura do formulário: o segundo envio do mesmo formulário
  // (duplo clique) é recusado pelo banco com 23505.
  const requestIdRef = useRef<string>(crypto.randomUUID());
  const mostraNumero = ativos.length > 1;
  const pipelineDoForm = form.pipeline_id || defaultPipelineId;

  // Sync default stage when opened
  useEffect(() => {
    if (open) {
      requestIdRef.current = crypto.randomUUID();
      setForm(f => ({ ...f, stage_id: defaultStageId, pipeline_id: "" }));
    }
  }, [open, defaultStageId]);

  // Pré-escolhe o número em que o lead moraria no funil escolhido.
  useEffect(() => {
    if (!open || !mostraNumero || !pipelineDoForm) return;
    let vivo = true;
    numeroDoLeadNovo(userRole, pipelineDoForm).then(({ mundo }) => {
      if (!vivo) return;
      setNumeroEscolhido(mundo && ativos.some(n => n.id === mundo) ? mundo : "");
    });
    return () => { vivo = false; };
  }, [open, mostraNumero, pipelineDoForm, userRole, ativos]);

  const handleClose = () => { onOpenChange(false); setForm(emptyForm); setDuplicateInfo(null); setNumeroEscolhido(""); };

  const insertLead = async (gravar: string | null, currentForm: typeof form, carimbo: string | null) => {
    const targetPipeline = currentForm.pipeline_id
      ? pipelines.find(p => p.id === currentForm.pipeline_id)
      : pipelines.find(p => p.id === defaultPipelineId) || pipelines[0];
    if (!targetPipeline) return;
    const tagsArray = currentForm.tags ? currentForm.tags.split(",").map(t => t.trim()).filter(Boolean) : [];
    const { error } = await supabase.from("crm_leads").insert({
      name: currentForm.name,
      phone: gravar,
      stage_id: currentForm.stage_id,
      pipeline_id: targetPipeline.id,
      source: currentForm.source || null,
      ...(currentForm.cidade ? { cidade: currentForm.cidade } : {}),
      tags: tagsArray,
      value: currentForm.value ? parseFloat(currentForm.value) : 0,
      notes: currentForm.notes || null,
      position: leadCountByStage[currentForm.stage_id] || 0,
      assigned_to: userId || null,
      // Cada número é um mundo: número escolhido ou o de closer/recepção; nos
      // demais casos vai NULL e o gatilho carimba (canal do funil ou padrão).
      whatsapp_number_id: carimbo,
      client_request_id: requestIdRef.current,
    } as any);
    if (error) {
      console.error("[Kanban] Erro ao criar lead:", error);
      const code = (error as any).code;
      const msg = String((error as any).message || "");
      if (code === "23505" && /client_request/i.test(msg)) {
        // Mesmo formulário enviado de novo: o primeiro envio já criou o lead.
        invalidateKanbanCache();
        handleClose();
        onCreated();
        return;
      }
      if (code === "23505" && /tenant_phone_uniq/i.test(msg)) {
        toast.error("Já existe um lead com este telefone neste número de WhatsApp.", { duration: 10000 });
        return;
      }
      if (code === "42501" || /row-level security/i.test(msg)) {
        toast.error("Você não tem acesso a este número de WhatsApp ou a este funil. Escolha outro número ou peça ao administrador.", { duration: 10000 });
        return;
      }
      toast.error(mensagemDeErro(error), { duration: 10000 });
      return;
    }
    // As automações de entrada são enfileiradas pelo próprio banco.
    toast.success("Lead criado com sucesso");
    invalidateKanbanCache();
    handleClose();
    onCreated();
  };

  const handleSave = async () => {
    if (salvandoRef.current) return;
    if (!form.name.trim()) { toast.error("Informe o nome do lead."); return; }
    if (!form.stage_id) { toast.error("Escolha a etapa inicial."); return; }
    const tel = lerTelefoneDigitado(form.phone);
    if (tel.erro) { toast.error(tel.erro); return; }
    salvandoRef.current = true;
    setSalvando(true);
    try {
      const pipelineAlvo = form.pipeline_id
        ? pipelines.find(p => p.id === form.pipeline_id)
        : pipelines.find(p => p.id === defaultPipelineId) || pipelines[0];
      const escolhido = mostraNumero && numeroEscolhido ? numeroEscolhido : null;
      const { carimbo, mundo } = pipelineAlvo
        ? await numeroDoLeadNovo(userRole, pipelineAlvo.id, escolhido)
        : { carimbo: escolhido ?? await getMyWhatsappNumberId(userRole), mundo: escolhido ?? await getMyWhatsappNumberId(userRole) };
      if (tel.gravar) {
        // Duplicado é avaliado no número em que o lead vai morar e nos leads
        // ainda sem número, que o webhook adota na primeira resposta.
        const mundosParaChecar: (string | null)[] = mundo ? [mundo, null] : [null];
        for (const numeroId of mundosParaChecar) {
          const { data, error: dupErr } = await supabase.rpc("check_duplicate_phone", {
            p_phone: tel.gravar,
            _whatsapp_number_id: numeroId,
          } as any);
          if (dupErr) console.error("[Kanban] check_duplicate_phone falhou:", dupErr);
          const achados = (data as any[] | null) ?? [];
          if (achados.length > 0) {
            const dup = achados[0];
            const owner = profiles.find(p => p.id === dup.assigned_to);
            // SDR: lead de outra dona volta mascarado (nome/dona/funil/etapa NULL).
            const mascarado = userRole === "sdr" && !dup.lead_name;
            setDuplicateInfo({
              existingLeadId: dup.lead_id,
              existingLeadName: dup.lead_name || (mascarado ? "Lead de outra pessoa da equipe" : "Lead sem nome"),
              ownerName: owner?.nome || (mascarado ? "Outra pessoa" : "Sem responsável"),
              ownerId: dup.assigned_to, phone: tel.gravar,
              pipelineName: dup.pipeline_name || "", stageName: dup.stage_name || "",
              podeDuplicar: numeroId === null && mundo !== null,
              carimbo: carimbo ?? mundo,
            });
            return;
          }
        }
      }
      await insertLead(tel.gravar, form, carimbo);
    } finally {
      salvandoRef.current = false;
      setSalvando(false);
    }
  };

  const handleTransfer = async () => {
    if (!duplicateInfo || !userId) return;
    setTransferring(true);
    try {
      const { data, error } = await supabase.functions.invoke("transfer-lead", {
        body: { leadId: duplicateInfo.existingLeadId, newUserId: userId },
      });
      if (error) {
        toast.error(await motivoDoServidor(data, error, "Não foi possível transferir o lead."));
        return;
      }
      toast.success(`Lead "${duplicateInfo.existingLeadName}" transferido para você!`);
      invalidateKanbanCache();
      handleClose();
      onCreated();
    } finally { setTransferring(false); }
  };

  // Move o lead EXISTENTE para a etapa/funil que o usuário estava criando.
  const handleMoveExisting = async () => {
    if (!duplicateInfo) return;
    const targetPipeline = form.pipeline_id
      ? pipelines.find(p => p.id === form.pipeline_id)
      : pipelines.find(p => p.id === defaultPipelineId) || pipelines[0];
    if (!targetPipeline || !form.stage_id) {
      toast.error("Selecione funil e etapa antes de mover");
      return;
    }
    setTransferring(true);
    try {
      const { data: movedRows, error } = await supabase.from("crm_leads")
        .update({
          stage_id: form.stage_id,
          pipeline_id: targetPipeline.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", duplicateInfo.existingLeadId)
        .select("id");
      if (error) { toast.error(mensagemDeErro(error)); return; }
      // Update barrado pela RLS devolve ZERO linhas, não erro.
      if (!movedRows || movedRows.length === 0) {
        toast.error("Seu perfil não tem permissão para mover este lead.");
        return;
      }
      toast.success(`Lead "${duplicateInfo.existingLeadName}" movido para a etapa atual`);
      invalidateKanbanCache();
      handleClose();
      onCreated();
    } finally { setTransferring(false); }
  };

  // Cria o lead no número escolhido mesmo havendo um lead sem número com o
  // mesmo telefone (única combinação aceita pelo índice único).
  const handleForceDuplicate = async () => {
    if (!duplicateInfo || salvandoRef.current) return;
    salvandoRef.current = true;
    setSalvando(true);
    setTransferring(true);
    try {
      await insertLead(duplicateInfo.phone, form, duplicateInfo.carimbo);
    } finally {
      salvandoRef.current = false;
      setSalvando(false);
      setTransferring(false);
      setDuplicateInfo(null);
    }
  };

  const set = (field: string, value: string) => setForm(f => ({ ...f, [field]: value }));

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
        <DialogContent className="sm:max-w-xl rounded-2xl">
          <DialogHeader><DialogTitle className="text-lg tracking-tight">Novo Lead</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-3.5 pt-1">
            <div><Label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">Nome *</Label><Input value={form.name} onChange={e => set("name", e.target.value)} /></div>
            <div><Label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">Telefone</Label><Input value={form.phone} onChange={e => set("phone", e.target.value)} /></div>
            <div>
              <Label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">Funil *</Label>
              <Select value={form.pipeline_id || defaultPipelineId} onValueChange={v => setForm(f => ({ ...f, pipeline_id: v, stage_id: "" }))}>
                <SelectTrigger><SelectValue placeholder="Selecione o funil" /></SelectTrigger>
                <SelectContent>{pipelines.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">Etapa Inicial *</Label>
              <NewLeadStageSelector
                pipelineId={form.pipeline_id || defaultPipelineId}
                allPipelines={pipelines}
                currentStages={stages}
                currentPipelineId={defaultPipelineId}
                value={form.stage_id}
                onChange={v => set("stage_id", v)}
              />
            </div>
            <div>
              <Label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">Origem</Label>
              <Select value={form.source} onValueChange={v => set("source", v)}>
                <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                <SelectContent>
                  {[
                  ...ORIGENS_LEAD.map((o) => ({ value: o.valor, label: o.rotulo })),
                  ].map(s =>
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">Tags (separadas por vírgula)</Label><Input placeholder={servicosInteresse.length >= 2 ? `ex.: ${servicosInteresse.slice(0, 2).join(", ")}` : "ex.: retorno, avaliação"} value={form.tags} onChange={e => set("tags", e.target.value)} /></div>
            {mostraNumero && (
              <div className="sm:col-span-2">
                <Label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">Número de WhatsApp</Label>
                <Select value={numeroEscolhido} onValueChange={setNumeroEscolhido}>
                  <SelectTrigger><SelectValue placeholder="Selecione o número" /></SelectTrigger>
                  <SelectContent>{ativos.map(n => <SelectItem key={n.id} value={n.id}>{n.display_name || formatPhoneDisplayBR(n.phone_e164)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div className="sm:col-span-2"><Label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">Valor (R$)</Label><Input type="number" value={form.value} onChange={e => set("value", e.target.value)} /></div>
            <div className="sm:col-span-2"><Label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">Observações</Label><Textarea rows={3} value={form.notes} onChange={e => set("notes", e.target.value)} /></div>
            <Button className="w-full sm:col-span-2 h-11 rounded-xl font-semibold shadow-brand mt-1" onClick={handleSave} disabled={salvando}>{salvando ? "Salvando…" : "Salvar Lead"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!duplicateInfo} onOpenChange={(v) => { if (!v) setDuplicateInfo(null); }}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 tracking-tight">
              <AlertTriangle size={18} className="text-warning" /> Lead já cadastrado
            </DialogTitle>
          </DialogHeader>
          {duplicateInfo && (
            <div className="space-y-4">
              <div className="bg-surface-sunken border border-border/60 rounded-xl p-4 space-y-2">
                <p className="text-sm">Já existe um lead com o telefone <strong>{formatPhoneDisplayBR(duplicateInfo.phone)}</strong>:</p>
                <div className="flex items-center gap-2 mt-2">
                  <Users size={14} className="text-primary" />
                  <span className="text-sm font-medium">{duplicateInfo.existingLeadName}</span>
                </div>
                {(duplicateInfo.pipelineName || duplicateInfo.stageName) && (
                  <p className="text-xs text-muted-foreground">
                    Funil: <strong>{duplicateInfo.pipelineName}</strong>
                    {duplicateInfo.stageName && <> · Etapa: <strong>{duplicateInfo.stageName}</strong></>}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">Responsável: <strong>{duplicateInfo.ownerName}</strong></p>
              </div>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Escolha o que deseja fazer com este lead:
                </p>
                <div className="grid grid-cols-1 gap-2">
                  {/* SDR: lead que não é dela não pode ser movido (RLS) nem
                      transferido (transfer-lead devolve 403) — sem oferecer
                      botões que sempre falham. */}
                  {!(userRole === "sdr" && duplicateInfo.ownerId !== userId) && (
                    <Button
                      className="w-full justify-start"
                      onClick={handleMoveExisting}
                      disabled={transferring || salvando}
                    >
                      <RefreshCw size={14} className={`mr-2 ${transferring ? "animate-spin" : ""}`} />
                      Mover lead existente para esta etapa
                    </Button>
                  )}
                  {duplicateInfo.podeDuplicar && (
                  <Button
                    variant="secondary"
                    className="w-full justify-start"
                    onClick={handleForceDuplicate}
                    disabled={transferring || salvando}
                  >
                    <AlertTriangle size={14} className="mr-2" />
                    Duplicar mesmo assim (criar novo lead)
                  </Button>
                  )}
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => setDuplicateInfo(null)}
                    disabled={transferring}
                  >
                    Cancelar
                  </Button>
                </div>
                {duplicateInfo.ownerId !== userId && userRole !== "sdr" && (
                  <p className="text-xs text-muted-foreground pt-2 border-t">
                    💡 Se preferir, você também pode <button onClick={handleTransfer} disabled={transferring} className="text-primary underline hover:no-underline">transferir o lead atual para você</button> sem mover de etapa.
                  </p>
                )}
                {duplicateInfo.ownerId !== userId && userRole === "sdr" && (
                  <p className="text-xs text-muted-foreground pt-2 border-t">
                    Esse lead já está com outra pessoa da equipe. Peça ao CRC para transferi-lo para você, se for o caso.
                  </p>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
});

// Sentinel invisível no fim de cada coluna — dispara loadMore ao entrar na viewport
function SentinelLoader({ onVisible }: { onVisible: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onVisible);
  cb.current = onVisible;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) cb.current(); },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []); // monta/desmonta com a coluna

  return <div ref={ref} className="h-2 flex-shrink-0" />;
}

// Contadores do funil inteiro, vindos do banco (kanban_contadores): o topo do
// Kanban precisa do número real, não do que está carregado na tela.
type KanbanContadores = {
  por_etapa: Record<string, number>;
  total: number;
  com_tarefa_hoje: number;
  tarefa_atrasada: number;
  sem_tarefa: number;
  novos_hoje: number;
  novos_ontem: number;
};

// Cache de módulo: sobrevive à navegação entre páginas, TTL de 2 minutos.
type KanbanCacheEntry = {
  contadores: KanbanContadores | null;
  pipelines: Pipeline[];
  stages: Stage[];
  leads: Lead[];
  stageTotalCounts: Record<string, number>;
  profiles: { id: string; nome: string }[];
  vendasConcluidas: number;
  leadMonthValueMap: Map<string, number>;
  leadAllTimeValueMap: Map<string, number>;
  leadsWithPagamento: Set<string>;
  taskTodayLeadIds: Set<string>;
  taskOverdueLeadIds: Set<string>;
  taskAnyLeadIds: Set<string>;
};
const kanbanDataCache: {
  userId: string | null;
  pipelineId: string | null;
  entry: KanbanCacheEntry | null;
  timestamp: number;
} = { userId: null, pipelineId: null, entry: null, timestamp: 0 };
const KANBAN_CACHE_TTL = 5 * 60_000;
export const invalidateKanbanCache = () => {
  kanbanDataCache.timestamp = 0;
  kanbanDataCache.entry = null;
  kanbanDataCache.userId = null;
  kanbanDataCache.pipelineId = null;
};

// ── localStorage: persiste o cache entre reloads de página ──────────────────
// v4: armazena somente uma fatia pequena por coluna + totais, evitando reidratar milhares de cards.
// v5 (14/09/2026): "Vendas concluídas" passou a usar a régua de faturamento de
// marketing. A versão SOBE junto com a mudança de régua — senão o navegador de
// quem já usou a tela continuaria mostrando o total antigo até o cache vencer,
// e pareceria que o conserto não foi feito.
// v6 (01/10/2026): o quadro passou a guardar os contadores do funil inteiro e
// os campos has_task/task_overdue saíram dos cards — formato novo.
const KANBAN_LS_KEY = "crm:kanban_cache_v7";
const KANBAN_LS_TTL = 15 * 60_000;

function loadKanbanCacheFromLS(userId: string, pipelineId: string): KanbanCacheEntry | null {
  try {
    const raw = localStorage.getItem(`${KANBAN_LS_KEY}:${userId}:${pipelineId}`);
    if (!raw) return null;
    const { entry, ts } = JSON.parse(raw);
    if (Date.now() - ts > KANBAN_LS_TTL) return null;
    // Lead mudou numa conversa depois que este quadro foi salvo: não serve.
    if (!cacheDoKanbanVale(ts)) return null;
    return {
      ...entry,
      stageTotalCounts: entry.stageTotalCounts || {},
      contadores: entry.contadores ?? null,
      leadMonthValueMap: new Map<string, number>(entry.leadMonthValueMap),
      leadAllTimeValueMap: new Map<string, number>(entry.leadAllTimeValueMap),
      leadsWithPagamento: new Set<string>(entry.leadsWithPagamento),
      taskTodayLeadIds: new Set<string>(entry.taskTodayLeadIds),
      taskOverdueLeadIds: new Set<string>(entry.taskOverdueLeadIds),
      taskAnyLeadIds: new Set<string>(entry.taskAnyLeadIds),
    };
  } catch { return null; }
}

function saveKanbanCacheToLS(userId: string, pipelineId: string, entry: KanbanCacheEntry): void {
  try {
    const serializable = {
      ...entry,
      leadMonthValueMap: Array.from(entry.leadMonthValueMap.entries()),
      leadAllTimeValueMap: Array.from(entry.leadAllTimeValueMap.entries()),
      leadsWithPagamento: Array.from(entry.leadsWithPagamento),
      taskTodayLeadIds: Array.from(entry.taskTodayLeadIds),
      taskOverdueLeadIds: Array.from(entry.taskOverdueLeadIds),
      taskAnyLeadIds: Array.from(entry.taskAnyLeadIds),
    };
    localStorage.setItem(`${KANBAN_LS_KEY}:${userId}:${pipelineId}`, JSON.stringify({ entry: serializable, ts: Date.now() }));
  } catch {} // QuotaExceededError silenciado
}

export default function CrmKanban() {
  const { ativos: numerosAtivosDoFiltro } = useNumerosLiberados();
  const numerosDoFiltro = useMemo(
    () => (numerosAtivosDoFiltro.length > 1
      ? numerosAtivosDoFiltro.map((n: any) => ({ id: n.id, nome: nomeDoNumero(n), pausado: n.waba_pausada === true }))
      : []),
    [numerosAtivosDoFiltro],
  );
  const navigate = useNavigate();
  const { user, userRole } = useAuth();
  // SDR, recepção e closer não veem vendas nem valores no Kanban.
  const veVendas = !["sdr", "recepcao", "closer"].includes(userRole ?? "");
  const { semNumeroLiberado, aviso: avisoSemNumero } = useNumerosLiberados();
  const [semFunil, setSemFunil] = useState(false);
  const bloqueioNovoLead: string | null = semFunil
    ? "Sem funil disponível para o seu perfil"
    : semNumeroLiberado ? avisoSemNumero : null;
  // Lê o cache do localStorage uma única vez no primeiro render para evitar spinner.
  // CRÍTICO: chave inclui user.id para não vazar dados entre usuários quando
  // troca de sessão no mesmo navegador (CRC ↔ Pós-Venda).
  const [_lsInit] = useState<KanbanCacheEntry | null>(() => {
    if (!user?.id) return null;
    const stored = typeof window !== "undefined" ? localStorage.getItem("crm:lastPipelineId") : null;
    if (!stored) return null;
    return loadKanbanCacheFromLS(user.id, stored);
  });
  const [pipelines, setPipelines] = useState<Pipeline[]>(_lsInit?.pipelines || []);
  const [pipeline, setPipeline] = useState<Pipeline | null>(() => {
    if (!_lsInit) return null;
    const stored = typeof window !== "undefined" ? localStorage.getItem("crm:lastPipelineId") : null;
    return _lsInit.pipelines.find(p => p.id === stored) || _lsInit.pipelines[0] || null;
  });
  const [stages, setStages] = useState<Stage[]>(_lsInit?.stages || []);
  const [leads, setLeads] = useState<Lead[]>(_lsInit?.leads || []);
  const [stageTotalCounts, setStageTotalCounts] = useState<Record<string, number>>(_lsInit?.stageTotalCounts || {});
  const [loading, setLoading] = useState(!_lsInit);
  // Etapas cuja carga falhou: a coluna mostra o aviso com "tentar de novo".
  const [stageLoadErrors, setStageLoadErrors] = useState<Record<string, boolean>>({});
  // Funil atual lido por ref no fetchData (fora das dependências, para a carga
  // não se repetir) e id da chamada mais recente (respostas antigas são descartadas).
  const pipelineAtualRef = useRef<string | null>(null);
  const fetchRequestIdRef = useRef(0);
  const [newLeadOpen, setNewLeadOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"kanban" | "list">("kanban");
  const [searchTerm, setSearchTerm] = useState(() => {
    try {
      const fromConversa = sessionStorage.getItem("crm:fromConversa") === "true";
      return fromConversa ? (localStorage.getItem("crm:kanbanSearch") || "") : "";
    } catch { return ""; }
  });
  const [kanbanFilters, setKanbanFilters] = useState<ConversationFilterValues>(() => {
    try {
      const fromConversa = sessionStorage.getItem("crm:fromConversa") === "true";
      if (fromConversa) {
        const saved = localStorage.getItem("crm:kanbanFilters");
        return saved ? JSON.parse(saved) : emptyFilters;
      }
      return emptyFilters;
    } catch { return emptyFilters; }
  });
  const [profiles, setProfiles] = useState<{ id: string; nome: string }[]>(_lsInit?.profiles || []);
  const [leadsWithPagamento, setLeadsWithPagamento] = useState<Set<string>>(_lsInit?.leadsWithPagamento || new Set());
  const [taskTodayLeadIds, setTaskTodayLeadIds] = useState<Set<string>>(_lsInit?.taskTodayLeadIds || new Set());
  const [taskOverdueLeadIds, setTaskOverdueLeadIds] = useState<Set<string>>(_lsInit?.taskOverdueLeadIds || new Set());
  const [taskAnyLeadIds, setTaskAnyLeadIds] = useState<Set<string>>(_lsInit?.taskAnyLeadIds || new Set());
  // Contadores do funil inteiro (kanban_contadores). Enquanto não chegam, os
  // selos do topo mostram "—" em vez de um número só dos cards carregados.
  const [contadores, setContadores] = useState<KanbanContadores | null>(_lsInit?.contadores ?? null);
  const [metricsLoading, setMetricsLoading] = useState(!_lsInit?.contadores);
  const { labelsByLead } = useLeadLabels();

  // Quantos leads cada coluna exibe (scroll infinito)
  const [stageVisibleCounts, setStageVisibleCounts] = useState<Record<string, number>>({});
  const loadingMoreStagesRef = useRef<Set<string>>(new Set());
  const hydratingAllRef = useRef(false);
  const loadMoreForStage = useCallback(async (stageId: string) => {
    if (loadingMoreStagesRef.current.has(stageId)) return;
    const loaded = leads.filter(l => l.stage_id === stageId).length;
    const total = stageTotalCounts[stageId] ?? loaded;
    if (loaded >= total) return;
    loadingMoreStagesRef.current.add(stageId);
    try {
      const { data, error } = await consultaDaEtapa(stageId, cursorDaEtapa(leads, stageId), PAGE_SIZE);
      if (error) {
        setStageLoadErrors(prev => ({ ...prev, [stageId]: true }));
        return;
      }
      if (data?.length) {
        setLeads(prev => {
          const existing = new Set(prev.map(l => l.id));
          const incoming = (data as Lead[]).filter(l => !existing.has(l.id));
          return incoming.length ? [...prev, ...incoming] : prev;
        });
        setStageVisibleCounts(prev => ({ ...prev, [stageId]: loaded + data.length }));
      }
    } finally {
      loadingMoreStagesRef.current.delete(stageId);
    }
  }, [leads, stageTotalCounts]);

  const hydrateAllStageLeads = useCallback(async () => {
    if (hydratingAllRef.current || stages.length === 0) return;
    const missingStages = stages.filter(stage => {
      const loaded = leads.filter(l => l.stage_id === stage.id).length;
      const total = stageTotalCounts[stage.id] ?? loaded;
      return loaded < total;
    });
    if (missingStages.length === 0) return;
    hydratingAllRef.current = true;
    try {
      const chunks = await Promise.all(missingStages.map(async (stage) => {
        const loaded = leads.filter(l => l.stage_id === stage.id).length;
        const total = stageTotalCounts[stage.id] ?? loaded;
        const out: Lead[] = [];
        let cursor: { created_at: string; id: string } | null = cursorDaEtapa(leads, stage.id);
        let carregados = loaded;
        while (carregados < total) {
          const { data, error } = await consultaDaEtapa(stage.id, cursor, 1000);
          if (error) { setStageLoadErrors(prev => ({ ...prev, [stage.id]: true })); break; }
          if (!data?.length) break;
          const rows = data as Lead[];
          out.push(...rows);
          carregados += rows.length;
          cursor = rows[rows.length - 1];
          if (rows.length < 1000) break;
        }
        return out;
      }));
      const incoming = chunks.flat();
      if (incoming.length) {
        setLeads(prev => {
          const existing = new Set(prev.map(l => l.id));
          const unique = incoming.filter(l => !existing.has(l.id));
          return unique.length ? [...prev, ...unique] : prev;
        });
      }
    } finally {
      hydratingAllRef.current = false;
    }
  }, [stages, leads, stageTotalCounts]);

  // New stage between columns
  const [newStageOpen, setNewStageOpen] = useState(false);
  const [newStageInsertIdx, setNewStageInsertIdx] = useState<number | null>(null);
  const [newStageName, setNewStageName] = useState("");
  const [newStageColor, setNewStageColor] = useState("#6366f1");
  const [useCustomColor, setUseCustomColor] = useState(false);

  const [newLeadDefaultStageId, setNewLeadDefaultStageId] = useState("");

  const fetchData = useCallback(async (selectedPipelineId?: string) => {
    const requestId = ++fetchRequestIdRef.current;
    const obsoleta = () => requestId !== fetchRequestIdRef.current;
    const pipelineAtualId = pipelineAtualRef.current;
    const stored = typeof window !== "undefined" ? localStorage.getItem("crm:lastPipelineId") : null;
    const targetPipelineId = selectedPipelineId || pipelineAtualId || stored || undefined;
    const isPosvendaOnly = userRole === "posvenda";

    // ── Cache hit: serve os dados instantaneamente ──────────────────────────
    // Inclui userId no check para invalidar quando trocar de usuário.
    if (
      kanbanDataCache.entry &&
      kanbanDataCache.userId === (user?.id ?? null) &&
      kanbanDataCache.pipelineId === (targetPipelineId ?? null) &&
      Date.now() - kanbanDataCache.timestamp < KANBAN_CACHE_TTL &&
      // Lead mudou numa conversa (desfecho, troca de etapa) depois do cache:
      // servir o cache mostraria o card na coluna antiga.
      cacheDoKanbanVale(kanbanDataCache.timestamp)
    ) {
      const e = kanbanDataCache.entry;
      setPipelines(e.pipelines);
      const p = e.pipelines.find(pp => pp.id === targetPipelineId) || e.pipelines[0];
      if (p) setPipeline(p);
      setStages(e.stages);
      setLeads(e.leads);
      setStageTotalCounts(e.stageTotalCounts || {});
      setStageLoadErrors({});
      setProfiles(e.profiles);
      setVendasConcluidas(e.vendasConcluidas);
      setLeadMonthValueMap(e.leadMonthValueMap);
      setLeadAllTimeValueMap(e.leadAllTimeValueMap);
      setLeadsWithPagamento(e.leadsWithPagamento);
      setTaskTodayLeadIds(e.taskTodayLeadIds ?? new Set());
      setTaskOverdueLeadIds(e.taskOverdueLeadIds ?? new Set());
      setTaskAnyLeadIds(e.taskAnyLeadIds ?? new Set());
      setContadores(e.contadores ?? null);
      setMetricsLoading(!e.contadores);
      setLoading(false);
      return;
    }

    setLoading(true);
    setMetricsLoading(true);

    const now = new Date();
    const monthStart = toLocalDateISO(new Date(now.getFullYear(), now.getMonth(), 1));
    // Vendas do mês contam só até HOJE: parcela lançada para data futura ainda
    // não foi recebida (mesma régua do Dashboard principal e do Início).
    const fimDoMes = toLocalDateISO(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    const hojeClinica = hojeNoFuso();
    const monthEnd = hojeClinica < fimDoMes ? hojeClinica : fimDoMes;

    const fetchStageLeads = async (stageId: string): Promise<{ rows: Lead[]; count: number; erro: boolean }> => {
      const { data, error, count } = await consultaDaEtapa(stageId, null, PAGE_SIZE, true);
      if (error) return { rows: [], count: 0, erro: true };
      return { rows: (data as Lead[]) || [], count: count || 0, erro: false };
    };

    // ── Fase 1: pipelines, perfis, etapas, leads e followups em paralelo ────
    const [pipelinesRes, profilesRes, stagesRes] = await Promise.all([
      supabase.from("crm_pipelines").select("id, name, color, description, created_at, is_default, is_instagram, is_posvenda, created_by, allowed_roles").order("position", { ascending: true, nullsFirst: false }).order("created_at"),
      supabase.from("profiles").select("id, nome").not("id","in",HIDDEN_USER_IDS_PG),
      targetPipelineId
        ? supabase.from("crm_stages").select("id, pipeline_id, name, color, position, is_won").eq("pipeline_id", targetPipelineId).order("position").order("created_at").order("id")
        : Promise.resolve({ data: null }),
    ]);
    if (obsoleta()) return;

    const pList = (pipelinesRes.data as Pipeline[]) || [];
    // Identifica pipelines default/pós-venda via flag, com FALLBACK ao regex de nome
    // (cobre tenants cujos funis ainda não têm as flags preenchidas).
    const principal =
      pList.find(pp => pp.is_default) ||
      pList[0];
    const posvendaPipeline =
      pList.find(pp => pp.is_posvenda);
    const defaultPipeline = isPosvendaOnly
      ? (posvendaPipeline || pList[0])
      : principal;


    let p: Pipeline | undefined;
    if (selectedPipelineId) {
      p = pList.find(pp => pp.id === selectedPipelineId) || defaultPipeline;
    } else if (pipelineAtualId) {
      p = pList.find(pp => pp.id === pipelineAtualId) || defaultPipeline;
    } else if (stored && pList.find(pp => pp.id === stored)) {
      const storedPipeline = pList.find(pp => pp.id === stored)!;
      const isStoredPosvenda = !!storedPipeline.is_posvenda;
      if (!isPosvendaOnly && isStoredPosvenda) {
        p = defaultPipeline;
      } else {
        p = storedPipeline;
      }
    } else {
      p = defaultPipeline;
    }

    if (!p) {
      setSemFunil(pList.length === 0);
      if (pList.length === 0) { setPipelines([]); setPipeline(null); setStages([]); setLeads([]); }
      setLoading(false);
      return;
    }
    setSemFunil(false);

    setPipelines(pList);
    setPipeline(p);
    try { localStorage.setItem("crm:lastPipelineId", p.id); } catch {}

    let finalStages: Stage[];
    let finalLeads: Lead[];
    let totalCounts: Record<string, number> = {};
    if (targetPipelineId === p.id && stagesRes.data) {
      finalStages = (stagesRes.data as Stage[]) || [];
    } else {
      const s2 = await supabase.from("crm_stages").select("id, pipeline_id, name, color, position, is_won").eq("pipeline_id", p.id).order("position").order("created_at").order("id");
      finalStages = (s2.data as Stage[]) || [];
      if (obsoleta()) return;
    }
    const stageLeadChunks = await Promise.all(finalStages.map(s => fetchStageLeads(s.id)));
    if (obsoleta()) return;
    finalLeads = stageLeadChunks.flatMap(chunk => chunk.rows);
    const errosDeCarga: Record<string, boolean> = {};
    finalStages.forEach((s, index) => {
      totalCounts[s.id] = stageLeadChunks[index]?.count || 0;
      if (stageLeadChunks[index]?.erro) errosDeCarga[s.id] = true;
    });

    setStageLoadErrors(errosDeCarga);
    setStages(finalStages);
    setLeads(finalLeads);
    setStageTotalCounts(totalCounts);

    const finalProfiles = (profilesRes.data as { id: string; nome: string }[]) || [];
    setProfiles(finalProfiles);

    // Mostra o board imediatamente — pagamentos carregam em background
    setLoading(false);

    // ── Fase 2: pagamentos via view server-side (evita arrays .in() grandes) ──
    const leadIds = finalLeads.map(l => l.id);
    let vendasConcluidasVal = 0;
    const monthMap = new Map<string, number>();
    const allTimeMap = new Map<string, number>();
    const paidLeadIds = new Set<string>();

    // Total de vendas do mês: pagamentos da clínica no período, independente do
    // pipeline atual — lead movido para pós-venda continua sendo contabilizado.
    // O RLS garante o escopo da clínica.
    //
    // A régua é a MESMA do Dashboard principal e dos relatórios
    // (contaComoFaturamento): fora manutenção de ortodontia e pagamento marcado
    // como não-marketing. Duas razões: "venda concluída" não é mensalidade de
    // paciente antigo de orto, e antes disto este card mostrava R$ 92.742,44
    // enquanto o Dashboard mostrava R$ 79.212,44 no MESMO mês — R$ 13.530,00 de
    // diferença sem nenhuma tela explicando qual era qual (decisão do dono em
    // 14/09/2026: um número só no sistema inteiro).
    if (veVendas) {
    const { data: allMonthPags } = await supabase
      .from("pagamentos")
      .select("valor, recorrencia_orto, nao_marketing")
      .gte("data_pagamento", monthStart)
      .lte("data_pagamento", monthEnd);
    vendasConcluidasVal = (allMonthPags || [])
      .filter(contaComoFaturamento)
      .reduce((sum: number, pg: any) => sum + Number(pg.valor || 0), 0);

    if (leadIds.length > 0) {
      // Monta mapa paciente→lead usando o campo direto dos leads (não precisa de .in() grande)
      const pacienteToLead = new Map<string, string>();
      finalLeads.forEach(l => {
        if (l.paciente_id) pacienteToLead.set(l.paciente_id, l.id);
      });

      // Vínculos adicionais via crm_lead_pacientes (em lotes para evitar URL longa)
      const BATCH = 200;
      for (let i = 0; i < leadIds.length; i += BATCH) {
        const batch = leadIds.slice(i, i + BATCH);
        const { data: linksData } = await supabase
          .from("crm_lead_pacientes")
          .select("lead_id, paciente_id, is_primary")
          .in("lead_id", batch);
        (linksData || []).forEach((l: any) => {
          const existing = pacienteToLead.get(l.paciente_id);
          if (!existing || l.is_primary) pacienteToLead.set(l.paciente_id, l.lead_id);
        });
      }

      const pacienteIds = [...pacienteToLead.keys()];

      // Consulta a view server-side para saber quais leads têm pagamentos
      // (não usa .in() com leadIds — é filtrado por RLS no banco)
      const { data: paidRows } = await supabase
        .from("crm_leads_com_pagamento")
        .select("lead_id");
      const paidSet = new Set((paidRows || []).map((r: any) => r.lead_id));
      finalLeads.forEach(l => { if (paidSet.has(l.id)) paidLeadIds.add(l.id); });

      if (pacienteIds.length > 0) {
        // Busca pagamentos por lead (para monthMap e allTimeMap do pipeline atual)
        const PAC_BATCH = 200;
        for (let i = 0; i < pacienteIds.length; i += PAC_BATCH) {
          const batch = pacienteIds.slice(i, i + PAC_BATCH);
          const [{ data: pags }, { data: allPags }] = await Promise.all([
            supabase.from("pagamentos").select("valor, paciente_id")
              .in("paciente_id", batch)
              .gte("data_pagamento", monthStart).lte("data_pagamento", monthEnd),
            supabase.from("pagamentos").select("paciente_id, valor")
              .in("paciente_id", batch),
          ]);

          (pags || []).forEach((pg: any) => {
            const leadId = pacienteToLead.get(pg.paciente_id);
            if (leadId) monthMap.set(leadId, (monthMap.get(leadId) || 0) + Number(pg.valor || 0));
          });

          (allPags || []).forEach((pg: any) => {
            const leadId = pacienteToLead.get(pg.paciente_id);
            if (leadId) {
              allTimeMap.set(leadId, (allTimeMap.get(leadId) || 0) + Number(pg.valor || 0));
            }
          });
        }
      }
    } // fecha if (leadIds.length > 0)
    } // fecha if (veVendas)

    if (obsoleta()) return;
    setVendasConcluidas(vendasConcluidasVal);
    setLeadMonthValueMap(monthMap);
    setLeadAllTimeValueMap(allTimeMap);
    setLeadsWithPagamento(paidLeadIds);

    // ── Pagamento NÃO move mais o card daqui ────────────────────────────────
    //
    // Até 17/09/2026 esta tela movia sozinha para "Contratado" todo lead com
    // pagamento — quem abrisse o Kanban executava a movimentação. Isso brigava
    // com a ordem do dono ("aguarde 24 horas pra mover pra contratado"): o lead
    // sumia da tela da SDR no instante em que alguém da gestão abrisse o quadro.
    //
    // Quem move agora é o banco, depois da espera: o gatilho do pagamento põe o
    // lead na fila crm_contratado_pendente e o cron 'contratado-apos-carencia'
    // muda a etapa (e entrega o lead da SDR ao administrador no mesmo passo).
    // A bolinha de "tem pagamento" (leadsWithPagamento) continua, para o card
    // mostrar a venda mesmo antes de mudar de etapa.

    // ── Fase 3: métricas de tarefas com dados reais de crm_tasks ─────────────
    // due_date é um datetime — usar range de dia inteiro no fuso do tenant
    // (tenants.timezone), não -03:00 fixo. Status concluída = "done".
    const todayISO = hojeNoFuso();
    const { gteIso: todayStart, lteIso: todayEnd } = rangeNoFuso(todayISO, todayISO);
    const taskTodayIds = new Set<string>();
    const taskOverdueIds = new Set<string>();
    const taskAnyIds = new Set<string>();

    const [{ data: tasksTodayData }, { data: tasksOverdueData }, { data: tasksAnyData }, contadoresRes] = await Promise.all([
      // Tarefas vencendo HOJE
      supabase.from("crm_tasks")
        .select("lead_id")
        .gte("due_date", todayStart)
        .lte("due_date", todayEnd)
        .neq("status", "done"),
      // Tarefas ATRASADAS (vencidas antes de hoje)
      supabase.from("crm_tasks")
        .select("lead_id")
        .lt("due_date", todayStart)
        .neq("status", "done"),
      // Qualquer tarefa pendente
      supabase.from("crm_tasks")
        .select("lead_id")
        .neq("status", "done"),
      // Contadores do funil inteiro — o banco conta com as mesmas regras de acesso
      (supabase.rpc as any)("kanban_contadores", { p_pipeline: p.id }),
    ]);
    if (obsoleta()) return;

    // Sem filtro por pipeline — as métricas devem bater com o calendário de tarefas
    (tasksTodayData || []).forEach((t: any) => taskTodayIds.add(t.lead_id));
    (tasksOverdueData || []).forEach((t: any) => taskOverdueIds.add(t.lead_id));
    (tasksAnyData || []).forEach((t: any) => taskAnyIds.add(t.lead_id));

    setTaskTodayLeadIds(taskTodayIds);
    setTaskOverdueLeadIds(taskOverdueIds);
    setTaskAnyLeadIds(taskAnyIds);

    const contadoresVal: KanbanContadores | null = contadoresRes?.data
      ? {
          por_etapa: (contadoresRes.data as any).por_etapa || {},
          total: Number((contadoresRes.data as any).total || 0),
          com_tarefa_hoje: Number((contadoresRes.data as any).com_tarefa_hoje || 0),
          tarefa_atrasada: Number((contadoresRes.data as any).tarefa_atrasada || 0),
          sem_tarefa: Number((contadoresRes.data as any).sem_tarefa || 0),
          novos_hoje: Number((contadoresRes.data as any).novos_hoje || 0),
          novos_ontem: Number((contadoresRes.data as any).novos_ontem || 0),
        }
      : null;
    setContadores(contadoresVal);
    setMetricsLoading(false);
    // por_etapa é a contagem real da coluna: vale mais que o count da 1ª página
    if (contadoresVal) {
      Object.entries(contadoresVal.por_etapa).forEach(([stageId, qtd]) => {
        totalCounts[stageId] = Number(qtd || 0);
      });
      setStageTotalCounts({ ...totalCounts });
    }


    // ── Salva no cache (depois dos pagamentos para ter dados completos) ──────
    if (Object.keys(errosDeCarga).length > 0) return; // coluna com erro não vai para o cache
    kanbanDataCache.userId = user?.id ?? null;
    kanbanDataCache.pipelineId = p.id;
    kanbanDataCache.timestamp = Date.now();
    kanbanDataCache.entry = {
      pipelines: pList,
      stages: finalStages,
      leads: finalLeads,
      stageTotalCounts: totalCounts,
      profiles: finalProfiles,
      vendasConcluidas: vendasConcluidasVal,
      leadMonthValueMap: monthMap,
      leadAllTimeValueMap: allTimeMap,
      leadsWithPagamento: paidLeadIds,
      taskTodayLeadIds: taskTodayIds,
      taskOverdueLeadIds: taskOverdueIds,
      taskAnyLeadIds: taskAnyIds,
      contadores: contadoresVal,
    };
    if (user?.id) saveKanbanCacheToLS(user.id, p.id, kanbanDataCache.entry);
  }, [userRole, user?.id, veVendas]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Trocar de funil: limpa o quadro na hora (aparece o esqueleto) e carrega o novo.
  const trocarFunil = (pipelineId: string) => {
    setLeads([]);
    setStages([]);
    setStageTotalCounts({});
    setStageLoadErrors({});
    setStageVisibleCounts({});
    setContadores(null);
    setMetricsLoading(true);
    setLoading(true);
    fetchData(pipelineId);
  };

  // "Tentar de novo" de uma coluna: recarrega só a primeira página daquela etapa.
  const recarregarEtapa = async (stageId: string) => {
    const pipelineDaChamada = pipelineAtualRef.current;
    const { data, error, count } = await consultaDaEtapa(stageId, null, PAGE_SIZE, true);
    if (pipelineDaChamada !== pipelineAtualRef.current) return;
    if (error) {
      setStageLoadErrors(prev => ({ ...prev, [stageId]: true }));
      toast.error(mensagemDeErro(error));
      return;
    }
    const rows = (data as Lead[]) || [];
    setLeads(prev => [...prev.filter(l => l.stage_id !== stageId), ...rows.filter(r => !prev.some(l => l.id === r.id && l.stage_id !== stageId))]);
    setStageTotalCounts(prev => ({ ...prev, [stageId]: count || 0 }));
    setStageVisibleCounts(prev => ({ ...prev, [stageId]: PAGE_SIZE }));
    setStageLoadErrors(prev => { const n = { ...prev }; delete n[stageId]; return n; });
  };

  // ── Lead que PASSOU A SER MEU e não está no quadro ─────────────────────────
  //
  // O DEFEITO (relato da SDR em 16/09/2026: "o lead ficou oculto e não apareceu
  // pra ela"). Todo lead distribuído nasce sem dona e recebe a dona num UPDATE
  // logo depois; para a SDR, portanto, a distribuição sempre chega como UPDATE
  // de um lead que ela não tinha. O handler abaixo descartava esse caso
  // (`if (!exists) return prev`) — só INSERT recarregava o quadro, e a SDR nem
  // recebe o INSERT, porque na hora dele o lead ainda não é dela. Resultado:
  // NENHUM lead distribuído aparecia no Kanban até recarregar a página.
  //
  // POR QUE NÃO SIMPLESMENTE RECARREGAR O QUADRO. As colunas carregam 20 cards e
  // o resto ao rolar; qualquer mensagem nova num lead fora da página gera o
  // mesmo UPDATE-de-lead-ausente. Recarregar a cada um viraria um laço, pior
  // ainda para o gestor, que recebe os eventos da clínica inteira. Então só
  // reage quando o lead É DA PRÓPRIA USUÁRIA, é do funil aberto, e não foi
  // tentado há pouco — busca AQUELE lead e reconta só a coluna dele.
  const pipelineIdRef = useRef<string | null>(null);
  pipelineIdRef.current = pipeline?.id ?? null;
  pipelineAtualRef.current = pipeline?.id ?? null;
  const userIdRef = useRef<string | null>(null);
  userIdRef.current = user?.id ?? null;
  const leadsNoQuadroRef = useRef<Set<string>>(new Set());
  useEffect(() => { leadsNoQuadroRef.current = new Set(leads.map(l => l.id)); }, [leads]);
  const tentadosNoQuadroRef = useRef<Map<string, number>>(new Map());

  const avisarLeadNoQuadro = useHidratarLeadsAvisados<Lead>(
    async (ids) => {
      const { data } = await supabase
        .from("crm_leads")
        .select(KANBAN_LEAD_COLS)
        .in("id", ids)
        .eq("is_blocked", false);
      return (data as Lead[]) || [];
    },
    (novos) => {
      const doFunil = novos.filter(n => n.pipeline_id === pipelineIdRef.current);
      if (doFunil.length === 0) return;
      setLeads(prev => {
        const ja = new Set(prev.map(l => l.id));
        const entram = doFunil.filter(n => !ja.has(n.id));
        return entram.length ? [...entram, ...prev] : prev;
      });
      // O card entra mesmo com a coluna paginada...
      setStageVisibleCounts(prev => {
        const n = { ...prev };
        doFunil.forEach(l => { n[l.stage_id] = (n[l.stage_id] || PAGE_SIZE) + 1; });
        return n;
      });
      // ...e o contador da coluna é RECONTADO no banco, não somado de cabeça:
      // não dá para saber daqui se o lead já estava contado.
      const etapas: string[] = [...new Set(doFunil.map(l => String(l.stage_id)))];
      void Promise.all(etapas.map(async (sid) => {
        const { count } = await supabase
          .from("crm_leads")
          .select("id", { count: "exact", head: true })
          .eq("stage_id", sid)
          .eq("is_blocked", false);
        return [sid, count] as const;
      })).then((contagens) => {
        setStageTotalCounts(prev => {
          const n = { ...prev };
          contagens.forEach(([sid, c]) => { if (typeof c === "number") n[sid] = c; });
          return n;
        });
      });
      invalidateKanbanCache();
    },
  );

  // ── Real-time: atualiza leads no kanban sem recarregar a página ────────────
  useEffect(() => {
    const channel = supabase
      .channel("kanban-leads-realtime")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "crm_leads" },
        (payload) => {
          const updated = payload.new as any;
          if (!leadsNoQuadroRef.current.has(updated.id)) {
            const agora = Date.now();
            const ultimaTentativa = tentadosNoQuadroRef.current.get(updated.id) ?? 0;
            if (
              !updated.is_blocked &&
              userIdRef.current && updated.assigned_to === userIdRef.current &&
              updated.pipeline_id === pipelineIdRef.current &&
              agora - ultimaTentativa > 60_000
            ) {
              tentadosNoQuadroRef.current.set(updated.id, agora);
              avisarLeadNoQuadro(updated.id);
            }
            return;
          }
          setLeads(prev => prev.map(l => l.id === updated.id ? { ...l, ...updated } : l));
          // Invalida cache para próxima visita buscar dados frescos
          invalidateKanbanCache();
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "crm_leads" },
        () => {
          // Novo lead criado: invalida cache e recarrega
          invalidateKanbanCache();
          fetchData();
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchData, avisarLeadNoQuadro]);

  // Consome a flag de "voltou de uma conversa" — só vale uma vez por montagem
  useEffect(() => {
    try { sessionStorage.removeItem("crm:fromConversa"); } catch {}
  }, []);

  // Reseta contadores de visibilidade ao trocar de pipeline
  useEffect(() => { setStageVisibleCounts({}); }, [pipeline?.id]);

  // Navega para uma conversa de lead e sinaliza que voltará ao kanban
  const navigateToLead = useCallback((leadId: string) => {
    try { sessionStorage.setItem("crm:fromConversa", "true"); } catch {}
    navigate(`/crm/conversa/${leadId}`);
  }, [navigate]);

  // Persiste filtros e busca no localStorage para sobreviver à navegação
  useEffect(() => {
    try { localStorage.setItem("crm:kanbanFilters", JSON.stringify(kanbanFilters)); } catch {}
  }, [kanbanFilters]);

  useEffect(() => {
    try { localStorage.setItem("crm:kanbanSearch", searchTerm); } catch {}
  }, [searchTerm]);

  useEffect(() => {
    if (viewMode === "list" || searchTerm || countActive({ ...kanbanFilters, pipelineId: "" }) > 0) {
      hydrateAllStageLeads();
    }
  }, [viewMode, searchTerm, kanbanFilters, hydrateAllStageLeads]);

  // Soltar em "Desqualificado" espera o motivo; cancelar deixa o card onde estava.
  const [desqualificarDrop, setDesqualificarDrop] = useState<DropResult | null>(null);

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination) return;
    const destino = stages.find(s => s.id === result.destination!.droppableId);
    const origem = leads.find(l => l.id === result.draggableId)?.stage_id;
    if (destino && ehEtapaDesqualificado(destino) && origem !== destino.id) {
      setDesqualificarDrop(result);
      return;
    }
    await moverCard(result);
  };

  const moverCard = async (result: DropResult, motivo?: string) => {
    if (!result.destination) return;
    const leadId = result.draggableId;
    const newStageId = result.destination.droppableId;
    const newPosition = result.destination.index;
    const movedLead = leads.find(l => l.id === leadId);
    const previousStageId = movedLead?.stage_id;

    const mudouEtapa = !!previousStageId && previousStageId !== newStageId;
    const posicaoAnterior = movedLead?.position;
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, stage_id: newStageId, position: newPosition } : l));
    if (mudouEtapa) {
      setStageTotalCounts(prev => ({
        ...prev,
        [previousStageId!]: Math.max(0, (prev[previousStageId!] ?? 1) - 1),
        [newStageId]: (prev[newStageId] ?? 0) + 1,
      }));
    }
    // Desfaz a atualização otimista: o card e os totais voltam.
    const desfazer = () => {
      if (!movedLead) return;
      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, stage_id: previousStageId!, position: posicaoAnterior as any } : l));
      if (mudouEtapa) {
        setStageTotalCounts(prev => ({
          ...prev,
          [previousStageId!]: (prev[previousStageId!] ?? 0) + 1,
          [newStageId]: Math.max(0, (prev[newStageId] ?? 1) - 1),
        }));
      }
    };
    // Update barrado pela RLS não devolve erro — devolve sucesso com ZERO
    // linhas. O `.select()` torna a resposta verificável; sem ele o card ficava
    // na coluna nova, disparava histórico/automação e voltava sozinho no
    // próximo carregamento.
    const { data: movedRows, error } = await supabase.from("crm_leads").update({
      stage_id: newStageId, position: newPosition, updated_at: new Date().toISOString()
    }).eq("id", leadId).select("id");
    if (error) { desfazer(); toast.error("Erro ao mover lead: " + mensagemDeErro(error)); return; }
    if (!movedRows || movedRows.length === 0) {
      desfazer();
      toast.error("Seu perfil não tem permissão para mover este lead.");
      return;
    }

    // Mensagem de sistema (mesma do chat). O histórico de etapa é escrito SÓ
    // pelo gatilho sync_lead_stage_history: este trecho também inseria a
    // passagem à mão e cada arrasto ficava registrado duas vezes (a do gatilho
    // e esta, sem autor).
    if (previousStageId && previousStageId !== newStageId) {
      if (motivo) {
        const gravou = await gravarMotivoDesqualificacao(leadId, newStageId, motivo);
        if (!gravou) toast.error("O lead foi desqualificado, mas o motivo não foi registrado no histórico.");
      }

      // Insert system message
      const fromName = stages.find(s => s.id === previousStageId)?.name || "?";
      const toName = stages.find(s => s.id === newStageId)?.name || "?";
      await anotarNoHistorico(leadId, `📋 Etapa alterada: ${fromName} → ${toName}${motivo ? ` · Motivo: ${motivo}` : ""}`);
      // Automações da etapa: o banco já enfileira ao mudar de etapa.
    }

  };

  const leadCountByStage = useMemo(() => {
    const m: Record<string, number> = {};
    leads.forEach(l => { m[l.stage_id] = (m[l.stage_id] || 0) + 1; });
    return m;
  }, [leads]);

  // Quem vê o "+": a mesma régua de crm_stages_inserir (a permissão é do banco).
  const podeCriarEtapa = podeCriarNoFunil(userRole, pipeline as any, user?.id);
  const [criandoEtapa, setCriandoEtapa] = useState(false);

  const handleAddStage = async () => {
    if (!pipeline) return;
    const nome = newStageName.trim();
    if (!nome) { toast.error("Dê um nome à etapa."); return; }
    const repetida = stages.find((s) => normalizaNomeEtapa(s.name) === normalizaNomeEtapa(nome));
    if (repetida) { toast.error(`Já existe a etapa "${repetida.name}" neste funil.`); return; }
    if (criandoEtapa) return;
    setCriandoEtapa(true);
    try {
      // CRClin: sem crm_stages_inserir — o mesmo caminho que o CRClin sempre
      // usou: empurra as posições numa instrução só (tudo ou nada, contagem
      // conferida) e insere a etapa.
      const insertPos = newStageInsertIdx !== null ? newStageInsertIdx + 1 : stages.length;
      if (newStageInsertIdx !== null) {
        const aEmpurrar = stages.filter((s) => s.position >= insertPos);
        if (aEmpurrar.length > 0) {
          const { data: shifted, error: shiftError } = await supabase.rpc("crm_stages_empurrar_posicao", {
            p_pipeline_id: pipeline.id,
            p_de_posicao: insertPos,
          });
          if (shiftError) { toast.error("Erro ao reordenar as etapas: " + mensagemDeErroNoFunil(shiftError, userRole)); return; }
          if (Number(shifted ?? 0) !== aEmpurrar.length) {
            toast.error("Seu perfil não tem permissão para reordenar as etapas deste funil.");
            return;
          }
        }
      }
      const { error } = await supabase.from("crm_stages").insert({
        pipeline_id: pipeline.id, name: nome, color: newStageColor, position: insertPos,
      });
      if (error) { toast.error("Erro ao criar etapa: " + mensagemDeErroNoFunil(error, userRole)); return; }
      toast.success("Etapa criada");
      invalidateKanbanCache();
      setNewStageOpen(false);
      setNewStageName("");
      setNewStageColor("#6366f1");
      setNewStageInsertIdx(null);
      setUseCustomColor(false);
      fetchData(pipeline.id);
    } finally {
      setCriandoEtapa(false);
    }
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
      if (kanbanFilters.whatsappNumberIds?.length) {
        const n = l.whatsapp_number_id;
        const ok = n ? kanbanFilters.whatsappNumberIds.includes(n) : kanbanFilters.whatsappNumberIds.includes(SEM_NUMERO);
        if (!ok) return false;
      }
      if (kanbanFilters.stageId && l.stage_id !== kanbanFilters.stageId) return false;
      if (kanbanFilters.assignedTo && l.assigned_to !== kanbanFilters.assignedTo) return false;
      if (kanbanFilters.tags.length && !kanbanFilters.tags.some((t) => l.tags?.includes(t))) return false;
      if (kanbanFilters.source) {
        if (!leadSourceMatchesFilter(l.source, kanbanFilters.source)) return false;
      }

      if (kanbanFilters.cidade && (l.cidade || "") !== kanbanFilters.cidade) return false;
      if (kanbanFilters.servicoInteresse && ((l as any).servico_interesse || "") !== kanbanFilters.servicoInteresse) return false;
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
  const hasClientFilters = useMemo(() => (
    !!searchTerm || countActive({ ...kanbanFilters, pipelineId: "" }) > 0
  ), [searchTerm, kanbanFilters]);
  const visibleTotalCount = useMemo(() => {
    if (hasClientFilters) return allFilteredLeads.length;
    const total = Object.values(stageTotalCounts).reduce((sum, value) => sum + value, 0);
    return total || allFilteredLeads.length;
  }, [hasClientFilters, allFilteredLeads.length, stageTotalCounts]);

  // Pré-computa os leads de cada etapa UMA vez — não re-executa ao digitar no modal
  const stageLeadsMap = useMemo(() => {
    const map = new Map<string, Lead[]>();
    for (const stage of stages) {
      const filtered = applyFilters(leads.filter(l => l.stage_id === stage.id));
      filtered.sort(ordemDaColuna);
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
  const today = toLocalDateISO();
  const yesterday = toLocalDateISO(new Date(Date.now() - 86400000));
  // Dia de criação no fuso local (created_at vem em UTC: comparar o texto
  // jogava quem entrou depois das 21h para o dia seguinte). Lead criado pela
  // conciliação do Dontus não é lead novo (ver leadNovo.ts).
  const novoNoDia = (l: Lead, dia: string) => contaComoLeadNovo(l) && toLocalDateISO(new Date(l.created_at)) === dia;

  // Todas as colunas já têm todos os cards na memória?
  const todasAsColunasCarregadas = useMemo(() => stages.every(stage => {
    const carregados = leads.filter(l => l.stage_id === stage.id).length;
    return carregados >= (stageTotalCounts[stage.id] ?? carregados);
  }), [stages, leads, stageTotalCounts]);

  // Sem busca/filtro: números do funil inteiro vindos do banco. Com busca ou
  // filtro: conta no navegador, mas só quando todas as colunas estão carregadas
  // — senão o número seria apenas dos 20 cards por coluna.
  const metricas = useMemo(() => {
    if (!hasClientFilters) {
      if (!contadores) return null;
      return {
        withTaskToday: contadores.com_tarefa_hoje,
        noTasks: contadores.sem_tarefa,
        overdue: contadores.tarefa_atrasada,
        newToday: contadores.novos_hoje,
        newYesterday: contadores.novos_ontem,
      };
    }
    if (!todasAsColunasCarregadas) return null;
    return {
      withTaskToday: myLeads.filter(l => taskTodayLeadIds.has(l.id)).length,
      noTasks: myLeads.filter(l => !taskAnyLeadIds.has(l.id)).length,
      overdue: myLeads.filter(l => taskOverdueLeadIds.has(l.id)).length,
      newToday: myLeads.filter(l => novoNoDia(l, today)).length,
      newYesterday: myLeads.filter(l => novoNoDia(l, yesterday)).length,
    };
  }, [hasClientFilters, contadores, todasAsColunasCarregadas, myLeads, taskTodayLeadIds, taskAnyLeadIds, taskOverdueLeadIds, today, yesterday]);

  const metricaOuTraco = (valor?: number) => (metricas && !metricsLoading ? String(valor ?? 0) : "—");

  // Modal de métrica: guarda o CRITÉRIO, não a lista — a lista é derivada de
  // myLeads, então cresce sozinha quando as colunas que faltavam chegam.
  const [metricModal, setMetricModal] = useState<{ title: string; filterFn: (l: Lead) => boolean } | null>(null);

  const openMetricModal = (title: string, filterFn: (l: Lead) => boolean) => {
    setMetricModal({ title, filterFn });
    if (!todasAsColunasCarregadas) hydrateAllStageLeads();
  };

  const metricModalLeads = useMemo(
    () => (metricModal ? myLeads.filter(metricModal.filterFn) : []),
    [metricModal, myLeads],
  );

  // Estados de pagamento — preenchidos dentro do fetchData (sem useEffect separado)
  const [vendasConcluidas, setVendasConcluidas] = useState(_lsInit?.vendasConcluidas || 0);
  const [leadMonthValueMap, setLeadMonthValueMap] = useState<Map<string, number>>(_lsInit?.leadMonthValueMap || new Map());
  const [leadAllTimeValueMap, setLeadAllTimeValueMap] = useState<Map<string, number>>(_lsInit?.leadAllTimeValueMap || new Map());

  const formatCurrency = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  if (loading && leads.length === 0) {
    return (
      <div className="flex flex-col bg-background -m-2 sm:-m-4 lg:-m-6" style={{ height: "calc(100vh - 4rem)", overflow: "hidden" }}>
        <div className="px-3 sm:px-4 lg:px-6 pt-4 lg:pt-5 pb-3 flex items-center gap-3">
          <div className="h-10 w-10 bg-muted animate-pulse rounded-xl" />
          <div className="h-7 w-44 bg-muted animate-pulse rounded-lg" />
          <div className="h-10 w-32 bg-muted animate-pulse rounded-xl ml-auto" />
        </div>
        <div className="px-3 sm:px-4 lg:px-6 pb-3 flex items-center gap-3 overflow-hidden">
          {[1,2,3,4,5].map(i => <div key={i} className="h-14 w-44 flex-shrink-0 bg-muted animate-pulse rounded-2xl" />)}
        </div>
        <div className="flex gap-4 px-3 sm:px-4 lg:px-6 pb-4 flex-1">
          {[1,2,3,4,5].map(i => (
            <div key={i} className="w-[280px] flex-shrink-0 bg-muted/60 rounded-2xl p-3 space-y-2.5">
              <div className="h-5 w-28 bg-muted animate-pulse rounded-lg" />
              {[1,2,3].map(j => <div key={j} className="h-24 bg-muted animate-pulse rounded-xl" />)}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col bg-background -m-2 sm:-m-4 lg:-m-6" style={{ height: "calc(100vh - 4rem)", overflow: "hidden" }}>
      {/* Header - FIXED, no horizontal scroll */}
      <div style={{ flexShrink: 0, width: "100%", overflowX: "hidden" }} className="bg-background px-3 sm:px-4 lg:px-6 pt-3 lg:pt-4 pb-3 flex items-center gap-x-2.5 sm:gap-x-3 gap-y-2 sm:gap-y-2.5 flex-wrap">
         <div className="contents">
          <span className="order-1 flex h-9 w-9 lg:h-10 lg:w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <LayoutGrid size={20} strokeWidth={1.75} />
          </span>
          {pipelines.length > 1 && (
            <span className="relative order-3 sm:order-4 inline-flex">
            <select
              className="h-9 sm:h-10 max-w-[170px] sm:max-w-[240px] appearance-none rounded-xl border border-border/60 bg-card pl-3.5 pr-9 text-sm font-semibold text-foreground shadow-xs cursor-pointer transition-colors hover:border-border focus:outline-none focus:ring-2 focus:ring-primary/30"
              value={pipeline?.id || ""}
              onChange={(e) => trocarFunil(e.target.value)}
            >
              {pipelines.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <ChevronDown size={16} strokeWidth={1.75} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-tertiary" />
            </span>
          )}
          <h1 className="order-1 min-w-0 break-words text-[28px] font-bold leading-tight tracking-tight text-foreground sm:text-[32px]">{pipeline?.name || "CRM"}</h1>
          <div className="order-3 sm:order-4 inline-flex items-center gap-0.5 rounded-full border border-border/60 bg-card p-1 shadow-xs">
            <button
              onClick={() => setViewMode("kanban")}
              className={`h-7 sm:h-8 w-9 sm:w-10 rounded-full flex items-center justify-center transition-all ${viewMode === "kanban" ? "border border-primary/20 bg-primary-soft text-primary-soft-fg" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              <LayoutGrid size={16} strokeWidth={1.75} />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`h-7 sm:h-8 w-9 sm:w-10 rounded-full flex items-center justify-center transition-all ${viewMode === "list" ? "border border-primary/20 bg-primary-soft text-primary-soft-fg" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              <List size={16} strokeWidth={1.75} />
            </button>
          </div>
          <div className="order-3 sm:order-4 [&>button]:h-9 sm:[&>button]:h-10 [&>button]:rounded-xl [&>button]:border-border/60 [&>button]:bg-card [&>button]:px-3.5 [&>button]:text-sm [&>button]:font-semibold [&>button]:shadow-xs">
          <ConversationFilters
            stages={stages}
            profiles={profiles}
            allTags={allTags}
            filters={{ ...kanbanFilters, pipelineId: pipeline?.id || "" }}
            onApply={(f) => {
              if (f.pipelineId && f.pipelineId !== pipeline?.id) {
                fetchData(f.pipelineId);
                setKanbanFilters({ ...f, pipelineId: "", stageId: "", status: "" });
              } else {
                setKanbanFilters({ ...f, pipelineId: "", status: "" });
              }
            }}
            ocultarStatus
            ocultarPagamentos={!veVendas}
            numeros={numerosDoFiltro}
            pipelines={pipelines}
            adAccounts={adAccounts}
            ads={ads}
          />
          </div>
          <div className="order-5 sm:order-4 relative w-full sm:w-72">
            <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-tertiary z-10 pointer-events-none" />
            <input
              className="h-9 sm:h-10 w-full pl-9 pr-3 text-sm rounded-xl border border-border/60 bg-card text-foreground shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 placeholder:text-tertiary"
              placeholder="Buscar…"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
            {searchTerm.replace(/\D/g, "").length >= 3 && (() => {
              return allFilteredLeads.length > 0 && allFilteredLeads.length <= 10 ? (
                <div className="absolute top-full left-0 right-0 z-50 mt-2 p-1.5 bg-card border border-border/60 rounded-xl shadow-float max-h-64 overflow-y-auto min-w-[260px]">
                  {allFilteredLeads.slice(0, 6).map((lead) => (
                    <button
                      key={lead.id}
                      onClick={() => { navigateToLead(lead.id); setSearchTerm(""); }}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-left rounded-lg hover:bg-surface-sunken transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-semibold text-foreground truncate block">{lead.name}</span>
                        <span className="text-xs text-tertiary tabular-nums">{lead.phone ? formatPhoneDisplayBR(lead.phone) : "Sem telefone"}</span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : null;
            })()}
          </div>
        </div>
        <div className="order-2 basis-full h-0" />
        <div className="contents">
          <span className="order-4 sm:order-1 sm:ml-auto inline-flex h-7 sm:h-8 items-center rounded-full bg-slate-soft px-3 text-xs font-semibold text-slate-soft-foreground tabular-nums whitespace-nowrap">{contagem(visibleTotalCount, "lead", "leads")}</span>
          <Button variant="outline" className="order-4 sm:order-1 h-9 lg:h-10 rounded-xl px-2.5 sm:px-3 lg:px-4 text-[13px] sm:text-sm font-semibold bg-card shadow-xs" onClick={() => navigate("/crm/automacoes")}>
            <Zap size={16} strokeWidth={1.75} className="mr-1.5 text-primary" /> AUTOMATIZE
          </Button>
          <Button className="order-1 ml-auto sm:ml-0 h-9 lg:h-10 rounded-xl px-3 lg:px-4 font-semibold shadow-brand" disabled={bloqueioNovoLead !== null} title={bloqueioNovoLead ?? undefined} onClick={() => { setNewLeadDefaultStageId(stages[0]?.id || ""); setNewLeadOpen(true); }}>
            <Plus size={16} strokeWidth={2} className="mr-1.5" /> NOVO LEAD
          </Button>
        </div>
      </div>

      {semNumeroLiberado && (
        <div className="mx-3 mb-3 sm:mx-4 lg:mx-6 rounded-lg bg-warning-soft px-3 py-2 text-[13px] leading-snug text-warning-soft-foreground">
          {avisoSemNumero}
        </div>
      )}

      {/* Metrics bar - FIXED, no horizontal scroll */}
      <div style={{ flexShrink: 0, width: "100%" }} className="flex flex-nowrap items-stretch gap-2 overflow-x-auto px-3 pb-3 sm:px-4 lg:gap-2.5 lg:px-6 lg:pb-4 md:max-[1399px]:grid md:max-[1399px]:grid-cols-6 max-[1100px]:grid-cols-3 xl:grid xl:grid-cols-[repeat(5,minmax(0,1fr))_minmax(0,1.75fr)]">
        <MetricBadge icon={<Calendar size={16} strokeWidth={1.75} />} label="Com tarefas para hoje" value={metricaOuTraco(metricas?.withTaskToday)} variant="info"
          onClick={() => openMetricModal("Com tarefas para hoje", l => taskTodayLeadIds.has(l.id))} />
        <MetricBadge icon={<Users size={16} strokeWidth={1.75} />} label="Sem tarefas atribuídas" value={metricaOuTraco(metricas?.noTasks)} variant="muted"
          onClick={() => openMetricModal("Sem tarefas atribuídas", l => !taskAnyLeadIds.has(l.id))} />
        <MetricBadge icon={<AlertTriangle size={16} strokeWidth={1.75} />} label="Com tarefas atrasadas" value={metricaOuTraco(metricas?.overdue)} variant="destructive"
          onClick={() => openMetricModal("Com tarefas atrasadas", l => taskOverdueLeadIds.has(l.id))} />
        <MetricBadge icon={<UserPlus size={16} strokeWidth={1.75} />} label="Novo hoje" value={metricaOuTraco(metricas?.newToday)} variant="primary"
          onClick={() => openMetricModal("Novos leads hoje", l => novoNoDia(l, today))} />
        <MetricBadge icon={<History size={16} strokeWidth={1.75} />} label="Ontem" value={metricaOuTraco(metricas?.newYesterday)} variant="muted"
          onClick={() => openMetricModal("Novos leads ontem", l => novoNoDia(l, yesterday))} />
        {veVendas && (
        <MetricBadge icon={<TrendingUp size={16} strokeWidth={1.75} />} label="Vendas concluídas (mês)" value={formatCurrency(vendasConcluidas)} variant="success"
          onClick={() => openMetricModal("Leads com vendas no mês", l => (leadMonthValueMap.get(l.id) || 0) > 0)} />
        )}
      </div>

      {/* Kanban area - SCROLLABLE horizontally */}
      {semFunil ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <p className="max-w-md rounded-lg bg-warning-soft px-4 py-3 text-center text-sm leading-snug text-warning-soft-foreground">
            Seu perfil ainda não tem funil — peça ao(à) gestor(a).
          </p>
        </div>
      ) : viewMode === "kanban" ? (
        <div
          style={{ flex: 1, overflowX: "auto", overflowY: "hidden" }}
          className="px-3 sm:px-4 lg:px-6 pb-3 lg:pb-5 snap-x snap-mandatory lg:snap-none"
        >
          <MotivoDesqualificacaoDialog
            open={!!desqualificarDrop}
            nomeDoLead={desqualificarDrop ? leads.find(l => l.id === desqualificarDrop.draggableId)?.name : null}
            onCancelar={() => setDesqualificarDrop(null)}
            onConfirmar={(motivo) => {
              const drop = desqualificarDrop;
              setDesqualificarDrop(null);
              if (drop) moverCard(drop, motivo);
            }}
          />
          <DragDropContext onDragEnd={handleDragEnd}>
            <div className="flex gap-4 h-full min-w-max">
              {stages.map((stage, idx) => {
                const stageLeads = stageLeadsMap.get(stage.id) || [];
                const visibleCount = stageVisibleCounts[stage.id] || PAGE_SIZE;
                const visibleLeads = stageLeads.slice(0, visibleCount);
                const totalStageLeads = hasClientFilters
                  ? stageLeads.length
                  : (stageTotalCounts[stage.id] ?? stageLeads.length);
                const hasMore = totalStageLeads > stageLeads.length || stageLeads.length > visibleCount;
                const stageValue = stageLeads.reduce((a, l) => a + (leadAllTimeValueMap.get(l.id) ?? l.value ?? 0), 0);
                const colunaCompleta = stageLeads.length >= totalStageLeads;
                return (
                  <div key={stage.id} className="flex items-start gap-1.5 sm:gap-2 snap-start scroll-ml-3 lg:snap-align-none">
                    <div
                      className="w-[76vw] max-w-[300px] sm:w-[280px] flex-shrink-0 flex flex-col rounded-card border border-border/60 overflow-hidden h-full shadow-card"
                      style={{ backgroundColor: `color-mix(in srgb, ${stage.color} 5%, hsl(var(--card) / 0.55))` }}
                    >
                      <div
                        className="h-[3px] flex-shrink-0"
                        style={{ backgroundImage: `linear-gradient(90deg, ${stage.color}, color-mix(in srgb, ${stage.color} 25%, transparent))` }}
                      />
                      <div
                        className="px-3.5 py-2.5 flex-shrink-0 flex items-center gap-2"
                        style={{ backgroundImage: `linear-gradient(180deg, color-mix(in srgb, ${stage.color} 16%, transparent), color-mix(in srgb, ${stage.color} 3%, transparent))` }}
                      >
                        <div className="flex flex-1 min-w-0 items-center gap-2 font-semibold text-sm text-foreground tracking-tight">
                          <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full ring-4 ring-card/70" style={{ backgroundColor: stage.color }} />
                          <span className="min-w-0 truncate leading-snug" title={stage.name}>{stage.name}</span>
                        </div>
                        <div className="ml-auto flex-shrink-0 inline-flex h-6 items-center rounded-full bg-card/85 px-2.5 text-[11px] font-medium text-muted-foreground tabular-nums shadow-xs">{contagem(totalStageLeads, "lead", "leads")}{veVendas && colunaCompleta ? ` · ${formatCurrency(stageValue)}` : ""}</div>
                      </div>

                      {idx === 0 && (
                        <div className="px-2.5 pt-0.5 pb-2 flex-shrink-0">
                          <button
                            onClick={() => { setNewLeadDefaultStageId(stage.id); setNewLeadOpen(true); }}
                            disabled={bloqueioNovoLead !== null}
                            title={bloqueioNovoLead ?? undefined}
                            className="disabled:opacity-50 disabled:pointer-events-none w-full h-8 text-[13px] font-medium text-primary bg-card/60 border border-dashed border-primary/40 hover:bg-primary-soft hover:border-primary/60 rounded-xl flex items-center justify-center gap-1.5 transition-colors"
                          >
                            <Plus size={14} strokeWidth={2} /> Adição rápida
                          </button>
                        </div>
                      )}

                      <Droppable droppableId={stage.id}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.droppableProps}
                            className={`flex-1 overflow-y-auto px-2.5 pt-0.5 pb-3 min-h-[100px] transition-colors ${snapshot.isDraggingOver ? "bg-primary/5" : ""}`}
                          >
                            {visibleLeads.map((lead, lIdx) => (
                              <Draggable key={lead.id} draggableId={lead.id} index={lIdx}>
                                {(prov, snap) => (
                                  <div
                                    ref={prov.innerRef}
                                    {...prov.draggableProps}
                                    {...prov.dragHandleProps}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => navigateToLead(lead.id)}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter" || event.key === " ") {
                                        event.preventDefault();
                                        navigateToLead(lead.id);
                                      }
                                    }}
                                    className={`block bg-card rounded-xl shadow-xs border border-border/60 mb-2 cursor-pointer hover:shadow-card hover:border-border transition-[box-shadow,border-color] overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${snap.isDragging ? "shadow-float ring-2 ring-primary" : ""}`}
                                  >
                                    {/* Color stripe from labels */}
                                    {(() => {
                                      const ll = labelsByLead(lead.id);
                                      if (ll.length === 0) return null;
                                      return (
                                        <div className="flex h-1.5 w-full">
                                          {ll.map(l => (
                                            <div key={l.id} className="flex-1" style={{ backgroundColor: l.color }} title={l.description ? `${l.name} — ${l.description}` : l.name} />
                                          ))}
                                        </div>
                                      );
                                    })()}
                                    <div className="px-3 pt-2.5 pb-2.5 flex flex-wrap items-center gap-x-2">
                                    <div className="contents">
                                      <div className="-order-4 flex grow basis-[calc(100%-5.5rem)] items-center gap-1.5 min-w-0">
                                        <span className="font-semibold text-sm text-foreground leading-snug tracking-tight">{lead.name}</span>
                                      </div>
                                       <div
                                         className="contents"
                                         onPointerDown={(e) => e.stopPropagation()}
                                         onMouseDown={(e) => e.stopPropagation()}
                                         onClick={(e) => e.stopPropagation()}
                                       >
                                         <span className="-order-1 ml-auto -mr-1.5 mt-0.5 flex"><LeadLabelsPopover leadId={lead.id} trigger={<LeadLabelsTrigger leadId={lead.id} />} /></span>
                                        <span className="-order-3 ml-auto text-[11.5px] text-tertiary whitespace-nowrap tabular-nums" title="Data de entrada do lead">
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
                                    <div className="-order-2 mt-0.5 text-xs font-medium text-primary cursor-pointer hover:underline tabular-nums">
                                      Lead #{lead.id.slice(0, 8)}
                                    </div>
                                    <LeadLabelChips leadId={lead.id} />
                                    {lead.tags && lead.tags.length > 0 && (
                                      <div className="basis-full flex flex-wrap gap-1 mt-1.5">
                                        {lead.tags.map(tag => (
                                          <span key={tag} className="text-[11px] font-medium bg-muted text-muted-foreground px-2 py-0.5 rounded-full">#{tag}</span>
                                        ))}
                                      </div>
                                    )}
                                    <div className="basis-full flex items-center justify-between gap-2 mt-2 pt-2 border-t border-border/60">
                                      {(() => {
                                        // Prioriza valor de pagamento real vinculado (all-time);
                                        // se não houver, cai no valor manual do lead.
                                        const paidValue = leadAllTimeValueMap.get(lead.id);
                                        const displayValue = paidValue ?? (lead.value || null);
                                        return veVendas && displayValue
                                          ? <span className="text-[13px] font-semibold text-foreground tabular-nums">{formatCurrency(displayValue)}</span>
                                          : <span />;
                                      })()}
                                      <span className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-semibold whitespace-nowrap ${taskOverdueLeadIds.has(lead.id) ? "bg-destructive-soft text-destructive-soft-foreground" : taskAnyLeadIds.has(lead.id) ? "bg-success-soft text-success-soft-foreground" : "bg-slate-soft text-slate-soft-foreground"}`}>
                                        <span className="h-1.5 w-1.5 rounded-full bg-current" />
                                        {taskOverdueLeadIds.has(lead.id) ? "Atrasada" : taskAnyLeadIds.has(lead.id) ? "Com tarefa" : "Sem Tarefas"}
                                      </span>
                                    </div>
                                    </div>
                                  </div>
                                )}
                              </Draggable>
                            ))}
                            {provided.placeholder}
                            {stageLoadErrors[stage.id] && (
                              <div className="py-3 text-center text-[12px] text-muted-foreground">
                                Não foi possível carregar —{" "}
                                <button type="button" onClick={() => recarregarEtapa(stage.id)} className="font-medium text-primary hover:underline">
                                  tentar de novo
                                </button>
                              </div>
                            )}
                            {hasMore && !stageLoadErrors[stage.id] && (
                              <SentinelLoader
                                key={`${stage.id}-${visibleCount}`}
                                onVisible={() => loadMoreForStage(stage.id)}
                              />
                            )}
                            {hasMore && (
                              <p className="text-center text-[11px] font-medium text-tertiary tabular-nums py-2">
                                {Math.min(stageLeads.length, totalStageLeads)} de {contagem(totalStageLeads, "lead", "leads")}
                              </p>
                            )}
                          </div>
                        )}
                      </Droppable>
                    </div>

                    {/* "+" ENTRE colunas insere no meio, e inserir no meio EMPURRA a
                        posição de todas as etapas seguintes. A SDR não altera etapa
                        de funil da clínica, então para ela o laço de deslocamento
                        falhava na primeira etapa que não é dela: ela lia "sem
                        permissão para reordenar" e a etapa nunca era criada. Pior,
                        o laço parava no meio e podia deixar a ordem deslocada sem
                        etapa nova nenhuma. Some o botão para quem não pode empurrar;
                        o "+" do fim da régua continua, e ele não desloca ninguém. */}
                    {idx < stages.length - 1 && podeCriarEtapa && (
                      <button
                        onClick={() => { setNewStageInsertIdx(idx); setNewStageOpen(true); }}
                        className="flex-shrink-0 mt-2.5 w-6 h-6 sm:w-8 sm:h-8 rounded-full border border-dashed border-border bg-card/60 text-muted-foreground hover:text-primary hover:border-primary hover:bg-primary-soft flex items-center justify-center text-base font-medium leading-none transition-colors"
                      >
                        +
                      </button>
                    )}
                  </div>
                );
              })}
              {podeCriarEtapa && stages.length > 0 && (
                <button
                  aria-label="Nova etapa no fim"
                  onClick={() => { setNewStageInsertIdx(null); setNewStageOpen(true); }}
                  className="flex-shrink-0 mt-2.5 w-6 h-6 sm:w-8 sm:h-8 rounded-full border border-dashed border-border bg-card/60 text-muted-foreground hover:text-primary hover:border-primary hover:bg-primary-soft flex items-center justify-center text-base font-medium leading-none transition-colors"
                >
                  +
                </button>
              )}
            </div>
          </DragDropContext>
        </div>
      ) : (
        /* LIST VIEW */
        <div style={{ flex: 1, overflowY: "auto" }} className="px-3 sm:px-4 lg:px-6 pb-4 lg:pb-6">
          <div className="overflow-hidden rounded-card border border-border/60 bg-card shadow-card">
            <div className="overflow-x-auto">
            <table className="w-full table-fixed text-sm">
              <thead>
                <tr className="border-b border-border/60">
                  <th className="h-11 w-[17%] px-2 text-left text-xs font-medium text-tertiary lg:px-3 xl:px-5">Nome</th>
                  <th className="h-11 w-[14%] px-2 text-left text-xs font-medium text-tertiary lg:px-3 xl:px-4">Telefone</th>
                  <th className="h-11 w-[14%] px-2 text-left text-xs font-medium text-tertiary lg:px-3 xl:px-4">Etapa</th>
                  <th className="h-11 w-[11%] px-2 text-left text-xs font-medium text-tertiary lg:px-3 xl:px-4">Origem</th>
                  <th className="h-11 w-[12%] px-2 text-left text-xs font-medium text-tertiary lg:px-3 xl:px-4">Valor</th>
                  <th className="h-11 w-[12%] px-2 text-left text-xs font-medium text-tertiary lg:px-3 xl:px-4">Tags</th>
                  <th className="h-11 w-[12%] px-2 text-left text-xs font-medium text-tertiary lg:px-3 xl:px-4">Status</th>
                  <th className="h-11 w-[10%] px-2 text-right text-xs font-medium text-tertiary lg:px-3 xl:px-5">Criado em</th>
                </tr>
              </thead>
              <tbody>
                {allFilteredLeads.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-16 text-sm text-muted-foreground">
                      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-sunken text-tertiary">
                      <MessageSquare size={22} strokeWidth={1.75} className="" />
                      </div>
                      Nenhum lead encontrado
                    </td>
                  </tr>
                ) : (
                  allFilteredLeads.map((lead) => {
                    const stage = stages.find((s) => s.id === lead.stage_id);
                    return (
                      <tr key={lead.id} className="h-14 border-b border-border/60 last:border-b-0 hover:bg-surface-sunken/60 transition-colors">
                         <td className="px-2 py-2.5 lg:px-3 xl:px-5">
                           <Link to={`/crm/conversa/${lead.id}`} className="block truncate font-semibold text-foreground transition-colors hover:text-primary">
                            {lead.name}
                          </Link>
                        </td>
                         <td className="truncate px-2 py-2.5 text-xs tabular-nums text-muted-foreground lg:px-3 xl:px-4">{lead.phone ? formatPhoneDisplayBR(lead.phone) : "—"}</td>
                         <td className="overflow-hidden px-2 py-2.5 lg:px-3 xl:px-4">
                          {stage && (
                            <span
                              className="inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium whitespace-nowrap"
                              style={{ backgroundColor: `color-mix(in srgb, ${stage.color} 13%, transparent)` }}
                            >
                              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: stage.color }} />
                              <span className="text-foreground">{stage.name}</span>
                            </span>
                          )}
                        </td>
                         <td className="truncate px-2 py-2.5 text-xs text-muted-foreground lg:px-3 xl:px-4">{rotuloOrigemLead(lead.source) || "—"}</td>
                         <td className="truncate px-2 py-2.5 text-xs font-semibold tabular-nums text-foreground lg:px-3 xl:px-4">{lead.value ? formatCurrency(lead.value) : "—"}</td>
                         <td className="overflow-hidden px-2 py-2.5 lg:px-3 xl:px-4">
                           <div className="flex max-w-full gap-1 overflow-hidden">
                            {lead.tags?.map((t: string) => (
                              <Badge key={t} variant="secondary" className="rounded-full bg-muted px-2 text-[11px] font-medium text-muted-foreground">#{t}</Badge>
                            ))}
                          </div>
                        </td>
                         <td className="overflow-hidden px-2 py-2.5 lg:px-3 xl:px-4">
                          <span className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-semibold whitespace-nowrap ${taskOverdueLeadIds.has(lead.id) ? "bg-destructive-soft text-destructive-soft-foreground" : taskAnyLeadIds.has(lead.id) ? "bg-success-soft text-success-soft-foreground" : "bg-slate-soft text-slate-soft-foreground"}`}>
                            <span className="h-1.5 w-1.5 rounded-full bg-current" />
                            {taskOverdueLeadIds.has(lead.id) ? "Atrasada" : taskAnyLeadIds.has(lead.id) ? "Com tarefa" : "Sem Tarefas"}
                          </span>
                        </td>
                         <td className="truncate px-2 py-2.5 text-right text-[11px] tabular-nums text-tertiary lg:px-3 xl:px-5">
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
        </div>
      )}

      {/* New Lead Modal — componente isolado para evitar re-render do kanban ao digitar */}
      <NewLeadDialog
        open={newLeadOpen}
        onOpenChange={setNewLeadOpen}
        pipelines={pipelines}
        stages={stages}
        defaultPipelineId={pipeline?.id || ""}
        defaultStageId={newLeadDefaultStageId}
        profiles={profiles}
        userId={user?.id}
        leadCountByStage={leadCountByStage}
        onCreated={fetchData}
      />


      <Dialog open={newStageOpen} onOpenChange={(open) => { setNewStageOpen(open); if (!open) { setNewStageInsertIdx(null); setUseCustomColor(false); } }}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader><DialogTitle>Nova Etapa</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nome</Label><Input value={newStageName} onChange={e => setNewStageName(e.target.value)} placeholder="Ex: Qualificação" className="h-10 rounded-xl" /></div>
            <div>
              <Label>Cor</Label>
              <div className="grid grid-cols-10 gap-2 mt-2">
                {PRESET_COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => { setNewStageColor(c); setUseCustomColor(false); }}
                    className={`w-7 h-7 rounded-full transition-all ${newStageColor === c && !useCustomColor ? "ring-2 ring-foreground ring-offset-2 ring-offset-background" : "hover:ring-2 hover:ring-border hover:ring-offset-1 hover:ring-offset-background"}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <button
                onClick={() => setUseCustomColor(true)}
                className="text-xs font-medium text-primary hover:underline mt-3"
              >
                Cor personalizada
              </button>
              {useCustomColor && (
                <input type="color" value={newStageColor} onChange={e => setNewStageColor(e.target.value)} className="w-full h-10 rounded-xl border border-border/60 bg-card p-1 cursor-pointer mt-2" />
              )}
            </div>
            <Button className="h-10 w-full rounded-xl" onClick={handleAddStage} disabled={criandoEtapa}>Criar Etapa</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal de métrica */}
      <Dialog open={!!metricModal} onOpenChange={() => setMetricModal(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col rounded-2xl">
          <DialogHeader>
            <DialogTitle className="tracking-tight">{metricModal?.title} <span className="text-tertiary font-medium text-sm tabular-nums">({metricModalLeads.length})</span></DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-1 pr-1 -mx-1">
            {!todasAsColunasCarregadas && (
              <p className="text-sm text-muted-foreground text-center py-8">Carregando…</p>
            )}
            {todasAsColunasCarregadas && metricModalLeads.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">Nenhum lead encontrado.</p>
            )}
            {metricModalLeads.map(l => {
              const stage = stages.find(s => s.id === l.stage_id);
              return (
                <button
                  key={l.id}
                  className="w-full text-left flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-surface-sunken transition-colors"
                  onClick={() => { setMetricModal(null); navigateToLead(l.id); }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{l.name}</p>
                    <p className="text-xs text-tertiary tabular-nums truncate">{l.phone ? formatPhoneDisplayBR(l.phone) : "—"}</p>
                  </div>
                  {stage && (
                    <span className="inline-flex h-6 items-center text-[11px] font-medium px-2.5 rounded-full whitespace-nowrap flex-shrink-0"
                      style={{ backgroundColor: stage.color + "33", color: stage.color }}>
                      {stage.name}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}

function MetricBadge({ icon, label, value, variant, onClick }: { icon: React.ReactNode; label: string; value: string | number; variant: "info" | "muted" | "destructive" | "success" | "primary"; onClick?: () => void }) {
  // Tom de cada métrica (pele): "muted" = slate e "primary" = laranja ("novo").
  const colorMap = {
    info: "bg-info-soft text-info",
    muted: "bg-slate-soft text-slate",
    destructive: "bg-destructive-soft text-destructive",
    success: "bg-success-soft text-success",
    primary: "bg-orange-soft text-orange",
  };
  const color = colorMap[variant];
  return (
    <button
      onClick={onClick}
      className={`group flex min-w-0 flex-shrink-0 items-center gap-2 rounded-card border border-border/60 bg-card px-3 text-left shadow-card md:max-[1399px]:h-auto md:max-[1399px]:min-h-16 md:max-[1399px]:flex-col md:max-[1399px]:items-start md:max-[1399px]:justify-center xl:h-14 xl:min-w-0 xl:gap-2.5 ${onClick ? "cursor-pointer transition-[box-shadow,border-color] hover:border-border hover:shadow-card" : "cursor-default"}`}
    >
      <span className={`flex h-7 w-7 xl:h-9 xl:w-9 flex-shrink-0 items-center justify-center rounded-lg xl:rounded-xl ${color}`}>{icon}</span>
       <div className="flex min-w-0 flex-row-reverse items-center justify-end gap-2 md:max-[1399px]:w-full md:max-[1399px]:flex-col-reverse md:max-[1399px]:items-start md:max-[1399px]:gap-1 xl:gap-1.5">
         <span className="text-xs font-medium leading-tight text-muted-foreground md:max-[1399px]:whitespace-normal xl:text-[11.5px] xl:whitespace-normal">{label}:</span>
        <span className="flex-shrink-0 text-lg xl:text-[22px] font-bold leading-none tracking-tight text-foreground tabular-nums">{value}</span>
      </div>
    </button>
  );
}
