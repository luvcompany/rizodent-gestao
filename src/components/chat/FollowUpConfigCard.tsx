import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { RefreshCw } from "lucide-react";

interface Stage {
  id: string;
  name: string;
  color: string;
}

interface Template {
  id: string;
  name: string;
}

interface Props {
  stageId: string;
  stages: Stage[];
  templates: Template[];
}

interface FollowUpConfig {
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
}

const defaultConfig = (stageId: string): FollowUpConfig => ({
  stage_id: stageId,
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

export default function FollowUpConfigCard({ stageId, stages, templates }: Props) {
  const [config, setConfig] = useState<FollowUpConfig>(defaultConfig(stageId));
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("crm_followup_configs")
        .select("*")
        .eq("stage_id", stageId)
        .maybeSingle();
      if (data) {
        setConfig({
          id: data.id,
          stage_id: data.stage_id,
          is_active: data.is_active,
          disparo1_delay_minutes: data.disparo1_delay_minutes,
          disparo1_type: data.disparo1_type,
          disparo1_content: data.disparo1_content || "",
          disparo1_template_id: data.disparo1_template_id,
          disparo2_delay_minutes: data.disparo2_delay_minutes,
          disparo2_type: data.disparo2_type,
          disparo2_content: data.disparo2_content || "",
          disparo2_template_id: data.disparo2_template_id,
          move_to_stage_id: data.move_to_stage_id,
          return_to_stage_id: data.return_to_stage_id,
          stop_on_stages: (data as any).stop_on_stages || [],
          max_attempts: data.max_attempts,
        });
        if (data.is_active) setExpanded(true);
      }
    })();
  }, [stageId]);

  const handleSave = async () => {
    setSaving(true);
    const payload: any = {
      stage_id: stageId,
      is_active: config.is_active,
      disparo1_delay_minutes: config.disparo1_delay_minutes,
      disparo1_type: config.disparo1_type,
      disparo1_content: config.disparo1_content || null,
      disparo1_template_id: config.disparo1_type === "template" ? config.disparo1_template_id : null,
      disparo2_delay_minutes: config.disparo2_delay_minutes,
      disparo2_type: config.disparo2_type,
      disparo2_content: config.disparo2_content || null,
      disparo2_template_id: config.disparo2_type === "template" ? config.disparo2_template_id : null,
      move_to_stage_id: config.move_to_stage_id || null,
      return_to_stage_id: config.return_to_stage_id || null,
      stop_on_stages: config.stop_on_stages,
      max_attempts: config.max_attempts,
      updated_at: new Date().toISOString(),
    };

    if (config.id) {
      await supabase.from("crm_followup_configs").update(payload).eq("id", config.id);
    } else {
      const { data } = await supabase.from("crm_followup_configs").insert(payload).select().single();
      if (data) setConfig(prev => ({ ...prev, id: data.id }));
    }
    toast.success("Follow Up salvo");
    setSaving(false);
  };

  const toggleActive = async (v: boolean) => {
    setConfig(prev => ({ ...prev, is_active: v }));
    if (v) setExpanded(true);
  };

  const renderMessageConfig = (
    prefix: "disparo1" | "disparo2",
    label: string,
    delayLabel: string,
  ) => {
    const typeKey = `${prefix}_type` as keyof FollowUpConfig;
    const contentKey = `${prefix}_content` as keyof FollowUpConfig;
    const templateKey = `${prefix}_template_id` as keyof FollowUpConfig;
    const delayKey = `${prefix}_delay_minutes` as keyof FollowUpConfig;
    const currentType = config[typeKey] as string;

    return (
      <div className="space-y-2 bg-secondary/30 rounded-lg p-3">
        <Label className="text-xs font-semibold text-foreground">{label}</Label>
        <div>
          <Label className="text-[10px] text-muted-foreground">{delayLabel}</Label>
          <Input
            type="number"
            min={1}
            className="h-7 text-xs"
            value={config[delayKey] as number}
            onChange={e => setConfig(prev => ({ ...prev, [delayKey]: parseInt(e.target.value) || 1 }))}
          />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">Tipo de mensagem</Label>
          <Select value={currentType} onValueChange={v => setConfig(prev => ({ ...prev, [typeKey]: v }))}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="text">Texto</SelectItem>
              <SelectItem value="audio">Áudio</SelectItem>
              <SelectItem value="template">Template aprovado</SelectItem>
              <SelectItem value="file">Arquivo</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {currentType === "text" && (
          <Textarea
            className="text-xs min-h-[60px]"
            placeholder="Mensagem de follow up..."
            value={config[contentKey] as string}
            onChange={e => setConfig(prev => ({ ...prev, [contentKey]: e.target.value }))}
          />
        )}
        {currentType === "template" && (
          <Select
            value={(config[templateKey] as string) || ""}
            onValueChange={v => setConfig(prev => ({ ...prev, [templateKey]: v }))}
          >
            <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Selecionar template" /></SelectTrigger>
            <SelectContent>
              {templates.length === 0 && <SelectItem value="none" disabled>Nenhum template aprovado</SelectItem>}
              {templates.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {(currentType === "audio" || currentType === "file") && (
          <Input
            className="h-7 text-xs"
            placeholder="URL do arquivo..."
            value={config[contentKey] as string}
            onChange={e => setConfig(prev => ({ ...prev, [contentKey]: e.target.value }))}
          />
        )}
      </div>
    );
  };

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div
        className="flex items-center justify-between px-3 py-2 bg-amber-500/10 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <RefreshCw size={12} className="text-amber-500" />
          <span className="text-xs font-semibold text-foreground">Follow Up Automático</span>
        </div>
        <Switch
          checked={config.is_active}
          onCheckedChange={toggleActive}
          onClick={e => e.stopPropagation()}
        />
      </div>

      {expanded && (
        <div className="p-3 space-y-3 bg-card">
          {renderMessageConfig("disparo1", "Disparo 1", "Aguardar X minutos sem resposta")}
          {renderMessageConfig("disparo2", "Disparo 2", "Se não responder em X minutos")}

          {/* Movement config */}
          <div className="space-y-2 bg-secondary/30 rounded-lg p-3">
            <Label className="text-xs font-semibold text-foreground">Movimentação</Label>
            <div>
              <Label className="text-[10px] text-muted-foreground">Mover lead para etapa</Label>
              <Select
                value={config.move_to_stage_id || "none"}
                onValueChange={v => setConfig(prev => ({ ...prev, move_to_stage_id: v === "none" ? null : v }))}
              >
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Não mover</SelectItem>
                  {stages.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Quando responder, voltar para</Label>
              <Select
                value={config.return_to_stage_id || "none"}
                onValueChange={v => setConfig(prev => ({ ...prev, return_to_stage_id: v === "none" ? null : v }))}
              >
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Não mover</SelectItem>
                  {stages.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Stop conditions */}
          <div className="space-y-2 bg-secondary/30 rounded-lg p-3">
            <Label className="text-xs font-semibold text-foreground">Encerramentos</Label>
            <Label className="text-[10px] text-muted-foreground">Parar o loop quando lead estiver em:</Label>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {stages.map(s => (
                <label key={s.id} className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
                  <Checkbox
                    checked={config.stop_on_stages.includes(s.id)}
                    onCheckedChange={checked => {
                      setConfig(prev => ({
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
              <Label className="text-[10px] text-muted-foreground">Máximo de tentativas</Label>
              <Input
                type="number"
                min={1}
                className="h-7 text-xs"
                value={config.max_attempts}
                onChange={e => setConfig(prev => ({ ...prev, max_attempts: parseInt(e.target.value) || 1 }))}
              />
            </div>
          </div>

          <Button size="sm" className="w-full text-xs" onClick={handleSave} disabled={saving}>
            {saving ? "Salvando..." : "Salvar Follow Up"}
          </Button>
        </div>
      )}
    </div>
  );
}
