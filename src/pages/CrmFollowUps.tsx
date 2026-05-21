import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, RefreshCw, Pencil, Trash2 } from "lucide-react";
import FollowUpDisparoInput, { type DisparoData } from "@/components/chat/FollowUpDisparoInput";

type Pipeline = { id: string; name: string };
type Stage = { id: string; pipeline_id: string; name: string; color: string; position: number };

interface FollowUpConfig {
  id?: string;
  stage_id: string;
  is_active: boolean;
  disparos: DisparoData[];
  move_to_stage_id: string | null;
  move_to_pipeline_id: string | null;
  return_to_stage_id: string | null;
  return_to_pipeline_id: string | null;
  stop_on_stages: string[];
  max_attempts: number;
}

const emptyDisparo = (): DisparoData => ({
  delay_minutes: 10,
  content: "",
  audio_url: null,
  file_url: null,
  file_name: null,
  template_id: null,
});

const emptyConfig = (): FollowUpConfig => ({
  stage_id: "",
  is_active: false,
  disparos: [emptyDisparo()],
  move_to_stage_id: null,
  move_to_pipeline_id: null,
  return_to_stage_id: null,
  return_to_pipeline_id: null,
  stop_on_stages: [],
  max_attempts: 10,
});

// ── Cache ──────────────────────────────────────────────────────────────────
type FollowUpsCache = {
  configs: (FollowUpConfig & { id: string })[];
  pipelines: Pipeline[];
  stages: Stage[];
};
const _fuCache: { data: FollowUpsCache | null; ts: number } = { data: null, ts: 0 };
const FU_MODULE_TTL = 2 * 60_000;
const FU_LS_KEY = "crm:followups_cache_v1";
const FU_LS_TTL = 15 * 60_000;

function readFuCache(): FollowUpsCache | null {
  if (_fuCache.data && Date.now() - _fuCache.ts < FU_MODULE_TTL) return _fuCache.data;
  try {
    const raw = localStorage.getItem(FU_LS_KEY);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw) as { data: FollowUpsCache; ts: number };
    if (Date.now() - ts > FU_LS_TTL) return null;
    _fuCache.data = data; _fuCache.ts = ts;
    return data;
  } catch { return null; }
}

function writeFuCache(data: FollowUpsCache) {
  _fuCache.data = data; _fuCache.ts = Date.now();
  try { localStorage.setItem(FU_LS_KEY, JSON.stringify({ data, ts: _fuCache.ts })); } catch {}
}
// ──────────────────────────────────────────────────────────────────────────

export default function CrmFollowUps() {
  const [_lsInit] = useState<FollowUpsCache | null>(() => readFuCache());
  const [configs, setConfigs] = useState<(FollowUpConfig & { id: string })[]>(() => readFuCache()?.configs || []);
  const [pipelines, setPipelines] = useState<Pipeline[]>(() => readFuCache()?.pipelines || []);
  const [stages, setStages] = useState<Stage[]>(() => readFuCache()?.stages || []);
  const [loading, setLoading] = useState(!_lsInit);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FollowUpConfig>(emptyConfig());
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    const [cfgRes, pipeRes, stgRes] = await Promise.all([
      supabase.from("crm_followup_configs").select("*").order("created_at", { ascending: false }),
      supabase.from("crm_pipelines").select("id, name").order("created_at"),
      supabase.from("crm_stages").select("*").order("position"),
    ]);

    const rawConfigs = (cfgRes.data as any[]) || [];
    // Map DB rows to our interface, supporting both old (disparo1/2) and new (disparos jsonb)
    const mapped = rawConfigs.map((c: any) => {
      let disparos: DisparoData[] = [];
      if (c.disparos && Array.isArray(c.disparos) && c.disparos.length > 0) {
        disparos = c.disparos;
      } else {
        // Legacy: convert disparo1/2 columns
        disparos = [
          { delay_minutes: c.disparo1_delay_minutes || 10, content: c.disparo1_content || "", audio_url: null, file_url: null, file_name: null, template_id: c.disparo1_template_id },
          { delay_minutes: c.disparo2_delay_minutes || 120, content: c.disparo2_content || "", audio_url: null, file_url: null, file_name: null, template_id: c.disparo2_template_id },
        ].filter(d => d.content || d.template_id);
        if (disparos.length === 0) disparos = [emptyDisparo()];
      }
      return {
        id: c.id,
        stage_id: c.stage_id,
        is_active: c.is_active,
        disparos,
        move_to_stage_id: c.move_to_stage_id,
        move_to_pipeline_id: null,
        return_to_stage_id: c.return_to_stage_id,
        return_to_pipeline_id: null,
        stop_on_stages: c.stop_on_stages || [],
        max_attempts: c.max_attempts,
      };
    });

    const pipes = (pipeRes.data as Pipeline[]) || [];
    const stgs = (stgRes.data as Stage[]) || [];
    setConfigs(mapped);
    setPipelines(pipes);
    setStages(stgs);
    writeFuCache({ configs: mapped, pipelines: pipes, stages: stgs });
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSave = async () => {
    if (!form.stage_id) { toast.error("Selecione a etapa de origem"); return; }
    if (form.disparos.length === 0) { toast.error("Adicione pelo menos um disparo"); return; }

    const payload: any = {
      stage_id: form.stage_id,
      is_active: form.is_active,
      disparos: form.disparos,
      // Keep legacy columns in sync with first 2 disparos for backward compat
      disparo1_delay_minutes: form.disparos[0]?.delay_minutes || 10,
      disparo1_type: form.disparos[0]?.audio_url ? "audio" : form.disparos[0]?.file_url ? "file" : "text",
      disparo1_content: form.disparos[0]?.content || form.disparos[0]?.audio_url || form.disparos[0]?.file_url || null,
      disparo1_template_id: form.disparos[0]?.template_id || null,
      disparo2_delay_minutes: form.disparos[1]?.delay_minutes || 120,
      disparo2_type: form.disparos[1]?.audio_url ? "audio" : form.disparos[1]?.file_url ? "file" : "text",
      disparo2_content: form.disparos[1]?.content || form.disparos[1]?.audio_url || form.disparos[1]?.file_url || null,
      disparo2_template_id: form.disparos[1]?.template_id || null,
      move_to_stage_id: form.move_to_stage_id || null,
      return_to_stage_id: form.return_to_stage_id || null,
      stop_on_stages: form.stop_on_stages,
      max_attempts: form.max_attempts,
      updated_at: new Date().toISOString(),
    };

    if (form.id) {
      await supabase.from("crm_followup_configs").update(payload).eq("id", form.id);
    } else {
      await supabase.from("crm_followup_configs").insert(payload);
    }
    toast.success("Follow Up salvo");
    setFormOpen(false);
    setForm(emptyConfig());
    fetchData();
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    await supabase.from("crm_followup_configs").delete().eq("id", deleteId);
    toast.success("Follow Up removido");
    setDeleteId(null);
    fetchData();
  };

  const openEdit = (cfg: FollowUpConfig & { id: string }) => {
    // Infer pipeline IDs from stage IDs
    const movePipeline = cfg.move_to_stage_id ? stages.find(s => s.id === cfg.move_to_stage_id)?.pipeline_id || null : null;
    const returnPipeline = cfg.return_to_stage_id ? stages.find(s => s.id === cfg.return_to_stage_id)?.pipeline_id || null : null;
    setForm({ ...cfg, move_to_pipeline_id: movePipeline, return_to_pipeline_id: returnPipeline });
    setFormOpen(true);
  };

  const openNew = () => { setForm(emptyConfig()); setFormOpen(true); };

  const getStageName = (id: string) => stages.find(s => s.id === id)?.name || "—";
  const getStageColor = (id: string) => stages.find(s => s.id === id)?.color || "#6366f1";
  const getPipelineName = (stageId: string) => {
    const stage = stages.find(s => s.id === stageId);
    return stage ? pipelines.find(p => p.id === stage.pipeline_id)?.name || "" : "";
  };

  const addDisparo = () => {
    setForm(prev => ({ ...prev, disparos: [...prev.disparos, emptyDisparo()] }));
  };

  const updateDisparo = (idx: number, d: DisparoData) => {
    setForm(prev => ({ ...prev, disparos: prev.disparos.map((x, i) => i === idx ? d : x) }));
  };

  const removeDisparo = (idx: number) => {
    setForm(prev => ({ ...prev, disparos: prev.disparos.filter((_, i) => i !== idx) }));
  };

  // Filtered stages for movement selectors
  const moveStages = form.move_to_pipeline_id ? stages.filter(s => s.pipeline_id === form.move_to_pipeline_id) : [];
  const returnStages = form.return_to_pipeline_id ? stages.filter(s => s.pipeline_id === form.return_to_pipeline_id) : [];

  // Mostrar spinner completo apenas na primeira visita (sem cache nenhum)
  if (loading && configs.length === 0 && pipelines.length === 0) return <div className="flex items-center justify-center h-96"><span className="text-muted-foreground">Carregando...</span></div>;

  return (
    <div className="flex flex-col gap-6 -m-6 p-6 bg-background min-h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <RefreshCw size={20} className="text-primary" />
            Follow Ups
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Configure sequências automáticas de follow up</p>
        </div>
        <Button onClick={openNew} size="sm"><Plus size={14} className="mr-1" /> Novo Follow Up</Button>
      </div>

      {/* List */}
      {configs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <RefreshCw size={40} className="text-muted-foreground/30 mb-4" />
          <h2 className="text-lg font-medium text-foreground mb-1">Nenhum Follow Up criado</h2>
          <p className="text-sm text-muted-foreground mb-4">Crie seu primeiro follow up automático</p>
          <Button onClick={openNew}><Plus size={14} className="mr-1" /> Criar Follow Up</Button>
        </div>
      ) : (
        <div className="grid gap-3">
          {configs.map(cfg => (
            <div key={cfg.id} className="bg-card border border-border rounded-lg p-4 flex items-center justify-between hover:border-primary/30 transition-colors">
              <div className="flex items-center gap-4 min-w-0">
                <div className={`w-2 h-10 rounded-full ${cfg.is_active ? "bg-green-500" : "bg-muted-foreground/30"}`} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-medium text-sm text-foreground">
                      Follow Up —{" "}
                      <span className="inline-flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: getStageColor(cfg.stage_id) }} />
                        {getStageName(cfg.stage_id)}
                      </span>
                    </span>
                    <Badge variant={cfg.is_active ? "default" : "secondary"} className="text-[10px]">
                      {cfg.is_active ? "Ativo" : "Inativo"}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">{getPipelineName(cfg.stage_id)}</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>{cfg.disparos.length} disparo{cfg.disparos.length !== 1 ? "s" : ""}</span>
                    <span>Max: {cfg.max_attempts}x</span>
                    {cfg.move_to_stage_id && <span>→ {getStageName(cfg.move_to_stage_id)}</span>}
                    {cfg.return_to_stage_id && <span>← {getStageName(cfg.return_to_stage_id)}</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => openEdit(cfg)}>
                  <Pencil size={14} />
                </Button>
                <Button variant="ghost" size="sm" className="h-8 px-2 text-destructive" onClick={() => setDeleteId(cfg.id)}>
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Form Dialog */}
      <Dialog open={formOpen} onOpenChange={v => { if (!v) { setFormOpen(false); setForm(emptyConfig()); } }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw size={16} className="text-primary" />
              {form.id ? "Editar Follow Up" : "Novo Follow Up"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Stage + Active */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Etapa de origem</Label>
                <Select value={form.stage_id || ""} onValueChange={v => setForm(prev => ({ ...prev, stage_id: v }))}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Selecionar etapa" /></SelectTrigger>
                  <SelectContent>
                    {pipelines.map(p => {
                      const pipeStages = stages.filter(s => s.pipeline_id === p.id);
                      return pipeStages.map(s => (
                        <SelectItem key={s.id} value={s.id}>
                          <span className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                            {p.name} → {s.name}
                          </span>
                        </SelectItem>
                      ));
                    })}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end pb-1">
                <div className="flex items-center gap-2">
                  <Switch checked={form.is_active} onCheckedChange={v => setForm(prev => ({ ...prev, is_active: v }))} />
                  <Label className="text-sm">Ativo</Label>
                </div>
              </div>
            </div>

            {/* Dynamic Disparos */}
            {form.disparos.map((d, idx) => (
              <FollowUpDisparoInput
                key={idx}
                index={idx}
                disparo={d}
                onChange={updated => updateDisparo(idx, updated)}
                onRemove={() => removeDisparo(idx)}
                canRemove={form.disparos.length > 1}
              />
            ))}

            <Button variant="outline" size="sm" onClick={addDisparo} className="w-full gap-1.5">
              <Plus size={14} /> Adicionar Disparo
            </Button>

            {/* Movement */}
            <div className="rounded-lg border border-border p-4 bg-secondary/20 space-y-3">
              <h4 className="text-sm font-semibold text-foreground">Movimentação</h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Mover lead para funil</Label>
                  <Select
                    value={form.move_to_pipeline_id || "none"}
                    onValueChange={v => setForm(prev => ({ ...prev, move_to_pipeline_id: v === "none" ? null : v, move_to_stage_id: null }))}
                  >
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Não mover</SelectItem>
                      {pipelines.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {form.move_to_pipeline_id && (
                    <>
                      <Label className="text-xs text-muted-foreground">Etapa</Label>
                      <Select
                        value={form.move_to_stage_id || "none"}
                        onValueChange={v => setForm(prev => ({ ...prev, move_to_stage_id: v === "none" ? null : v }))}
                      >
                        <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Selecionar</SelectItem>
                          {moveStages.map(s => (
                            <SelectItem key={s.id} value={s.id}>
                              <span className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                                {s.name}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </>
                  )}
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Quando responder, voltar para funil</Label>
                  <Select
                    value={form.return_to_pipeline_id || "none"}
                    onValueChange={v => setForm(prev => ({ ...prev, return_to_pipeline_id: v === "none" ? null : v, return_to_stage_id: null }))}
                  >
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Não mover</SelectItem>
                      {pipelines.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {form.return_to_pipeline_id && (
                    <>
                      <Label className="text-xs text-muted-foreground">Etapa</Label>
                      <Select
                        value={form.return_to_stage_id || "none"}
                        onValueChange={v => setForm(prev => ({ ...prev, return_to_stage_id: v === "none" ? null : v }))}
                      >
                        <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Selecionar</SelectItem>
                          {returnStages.map(s => (
                            <SelectItem key={s.id} value={s.id}>
                              <span className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                                {s.name}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Stop conditions */}
            <div className="rounded-lg border border-border p-4 bg-secondary/20 space-y-3">
              <h4 className="text-sm font-semibold text-foreground">Encerramentos</h4>
              <Label className="text-xs text-muted-foreground">Parar o loop quando lead estiver em:</Label>
              <div className="grid grid-cols-3 gap-2 max-h-40 overflow-y-auto">
                {stages.map(s => (
                  <label key={s.id} className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
                    <Checkbox
                      checked={form.stop_on_stages.includes(s.id)}
                      onCheckedChange={checked => {
                        setForm(prev => ({
                          ...prev,
                          stop_on_stages: checked
                            ? [...prev.stop_on_stages, s.id]
                            : prev.stop_on_stages.filter(id => id !== s.id),
                        }));
                      }}
                    />
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                    {s.name}
                  </label>
                ))}
              </div>
              <div className="pt-1">
                <Label className="text-xs text-muted-foreground">Máximo de tentativas</Label>
                <Input
                  type="number" min={1} className="h-8 text-sm w-32"
                  value={form.max_attempts}
                  onChange={e => setForm(prev => ({ ...prev, max_attempts: parseInt(e.target.value) || 1 }))}
                />
              </div>
            </div>

            <Button className="w-full" onClick={handleSave}>
              {form.id ? "Salvar Alterações" : "Criar Follow Up"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Excluir Follow Up?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Esta ação é irreversível.</p>
          <div className="flex gap-2 justify-end mt-4">
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDelete}>Excluir</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
