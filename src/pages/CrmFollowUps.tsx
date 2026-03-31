import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, RefreshCw, Pencil, Trash2, ArrowLeft } from "lucide-react";

type Pipeline = { id: string; name: string };
type Stage = { id: string; pipeline_id: string; name: string; color: string; position: number };
type Template = { id: string; name: string };
type FollowUpConfig = {
  id?: string;
  stage_id: string;
  is_active: boolean;
  disparo1_delay_minutes: number;
  disparo1_type: string;
  disparo1_content: string;
  disparo1_template_id: string | null;
  disparo2_delay_minutes: number;
  disparo2_type: string;
  disparo2_content: string;
  disparo2_template_id: string | null;
  move_to_stage_id: string | null;
  return_to_stage_id: string | null;
  stop_on_stages: string[];
  max_attempts: number;
};

const emptyConfig = (): FollowUpConfig => ({
  stage_id: "",
  is_active: false,
  disparo1_delay_minutes: 10,
  disparo1_type: "text",
  disparo1_content: "",
  disparo1_template_id: null,
  disparo2_delay_minutes: 120,
  disparo2_type: "text",
  disparo2_content: "",
  disparo2_template_id: null,
  move_to_stage_id: null,
  return_to_stage_id: null,
  stop_on_stages: [],
  max_attempts: 10,
});

export default function CrmFollowUps() {
  const [configs, setConfigs] = useState<(FollowUpConfig & { id: string })[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FollowUpConfig>(emptyConfig());
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [cfgRes, pipeRes, stgRes, tplRes] = await Promise.all([
      supabase.from("crm_followup_configs").select("*").order("created_at", { ascending: false }),
      supabase.from("crm_pipelines").select("id, name").order("created_at"),
      supabase.from("crm_stages").select("*").order("position"),
      supabase.from("crm_whatsapp_templates").select("id, name").eq("status", "APPROVED"),
    ]);
    setConfigs((cfgRes.data as any[]) || []);
    setPipelines((pipeRes.data as Pipeline[]) || []);
    setStages((stgRes.data as Stage[]) || []);
    setTemplates((tplRes.data as Template[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSave = async () => {
    if (!form.stage_id) {
      toast.error("Selecione a etapa de origem");
      return;
    }
    const payload: any = {
      stage_id: form.stage_id,
      is_active: form.is_active,
      disparo1_delay_minutes: form.disparo1_delay_minutes,
      disparo1_type: form.disparo1_type,
      disparo1_content: form.disparo1_content || null,
      disparo1_template_id: form.disparo1_type === "template" ? form.disparo1_template_id : null,
      disparo2_delay_minutes: form.disparo2_delay_minutes,
      disparo2_type: form.disparo2_type,
      disparo2_content: form.disparo2_content || null,
      disparo2_template_id: form.disparo2_type === "template" ? form.disparo2_template_id : null,
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
    setForm({
      ...cfg,
      disparo1_content: cfg.disparo1_content || "",
      disparo2_content: cfg.disparo2_content || "",
      stop_on_stages: (cfg as any).stop_on_stages || [],
    });
    setFormOpen(true);
  };

  const openNew = () => {
    setForm(emptyConfig());
    setFormOpen(true);
  };

  const getStageName = (id: string) => stages.find(s => s.id === id)?.name || "—";
  const getStageColor = (id: string) => stages.find(s => s.id === id)?.color || "#6366f1";
  const getPipelineName = (stageId: string) => {
    const stage = stages.find(s => s.id === stageId);
    if (!stage) return "";
    return pipelines.find(p => p.id === stage.pipeline_id)?.name || "";
  };

  const typeLabel: Record<string, string> = {
    text: "Texto", audio: "Áudio", template: "Template", file: "Arquivo",
  };

  const renderDisparoForm = (prefix: "disparo1" | "disparo2", label: string, delayLabel: string) => {
    const typeKey = `${prefix}_type` as keyof FollowUpConfig;
    const contentKey = `${prefix}_content` as keyof FollowUpConfig;
    const templateKey = `${prefix}_template_id` as keyof FollowUpConfig;
    const delayKey = `${prefix}_delay_minutes` as keyof FollowUpConfig;
    const currentType = form[typeKey] as string;

    return (
      <div className="space-y-3 rounded-lg border border-border p-4 bg-secondary/20">
        <h4 className="text-sm font-semibold text-foreground">{label}</h4>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-muted-foreground">{delayLabel}</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number" min={1} className="h-8 text-sm"
                value={form[delayKey] as number}
                onChange={e => setForm(prev => ({ ...prev, [delayKey]: parseInt(e.target.value) || 1 }))}
              />
              <span className="text-xs text-muted-foreground whitespace-nowrap">minutos</span>
            </div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Tipo de mensagem</Label>
            <Select value={currentType} onValueChange={v => setForm(prev => ({ ...prev, [typeKey]: v }))}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="text">Texto</SelectItem>
                <SelectItem value="audio">Áudio</SelectItem>
                <SelectItem value="template">Template aprovado</SelectItem>
                <SelectItem value="file">Arquivo</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {currentType === "text" && (
          <Textarea
            className="text-sm min-h-[70px]"
            placeholder="Mensagem de follow up..."
            value={form[contentKey] as string}
            onChange={e => setForm(prev => ({ ...prev, [contentKey]: e.target.value }))}
          />
        )}
        {currentType === "template" && (
          <Select
            value={(form[templateKey] as string) || ""}
            onValueChange={v => setForm(prev => ({ ...prev, [templateKey]: v }))}
          >
            <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Selecionar template" /></SelectTrigger>
            <SelectContent>
              {templates.length === 0 && <SelectItem value="none" disabled>Nenhum template aprovado</SelectItem>}
              {templates.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {(currentType === "audio" || currentType === "file") && (
          <Input
            className="h-8 text-sm"
            placeholder="URL do arquivo..."
            value={form[contentKey] as string}
            onChange={e => setForm(prev => ({ ...prev, [contentKey]: e.target.value }))}
          />
        )}
      </div>
    );
  };

  if (loading) return <div className="flex items-center justify-center h-96"><span className="text-muted-foreground">Carregando...</span></div>;

  return (
    <div className="flex flex-col gap-6 -m-6 p-6 bg-background min-h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <RefreshCw size={20} className="text-primary" />
            Follow Ups
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Configure sequências automáticas de follow up para seus leads</p>
        </div>
        <Button onClick={openNew} size="sm">
          <Plus size={14} className="mr-1" /> Novo Follow Up
        </Button>
      </div>

      {/* List */}
      {configs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <RefreshCw size={40} className="text-muted-foreground/30 mb-4" />
          <h2 className="text-lg font-medium text-foreground mb-1">Nenhum Follow Up criado</h2>
          <p className="text-sm text-muted-foreground mb-4">Crie seu primeiro follow up para automatizar o acompanhamento dos leads</p>
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
                    <span>D1: {typeLabel[cfg.disparo1_type] || cfg.disparo1_type} ({cfg.disparo1_delay_minutes}min)</span>
                    <span>D2: {typeLabel[cfg.disparo2_type] || cfg.disparo2_type} ({cfg.disparo2_delay_minutes}min)</span>
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

            {/* Disparo 1 */}
            {renderDisparoForm("disparo1", "Disparo 1 — Primeira mensagem", "Aguardar sem resposta")}

            {/* Disparo 2 */}
            {renderDisparoForm("disparo2", "Disparo 2 — Segunda mensagem", "Se não responder em")}

            {/* Movement */}
            <div className="rounded-lg border border-border p-4 bg-secondary/20 space-y-3">
              <h4 className="text-sm font-semibold text-foreground">Movimentação</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Mover lead para etapa</Label>
                  <Select value={form.move_to_stage_id || "none"} onValueChange={v => setForm(prev => ({ ...prev, move_to_stage_id: v === "none" ? null : v }))}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Não mover</SelectItem>
                      {stages.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Quando responder, voltar para</Label>
                  <Select value={form.return_to_stage_id || "none"} onValueChange={v => setForm(prev => ({ ...prev, return_to_stage_id: v === "none" ? null : v }))}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Não mover</SelectItem>
                      {stages.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
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
          <p className="text-sm text-muted-foreground">Esta ação é irreversível. Leads na fila deste follow up serão removidos.</p>
          <div className="flex gap-2 justify-end mt-4">
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDelete}>Excluir</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
