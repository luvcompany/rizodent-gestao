import { useCallback, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { NODE_DEFINITIONS } from "@/types/bot";
import type { Node } from "@xyflow/react";
import { supabase } from "@/integrations/supabase/client";

type Props = {
  node: Node;
  onUpdate: (nodeId: string, data: Record<string, any>) => void;
  onClose: () => void;
};

export default function NodePropertiesPanel({ node, onUpdate, onClose }: Props) {
  const def = NODE_DEFINITIONS.find((d) => d.type === node.type);
  const [stages, setStages] = useState<{ id: string; name: string; color: string }[]>([]);

  useEffect(() => {
    supabase.from("crm_stages").select("id, name, color").order("position").then(({ data }) => {
      if (data) setStages(data);
    });
  }, []);

  const update = useCallback(
    (key: string, value: any) => {
      onUpdate(node.id, { ...node.data, [key]: value });
    },
    [node, onUpdate]
  );

  const renderFields = () => {
    switch (node.type) {
      case "start":
        return <p className="text-sm text-muted-foreground">Este é o ponto de início do fluxo. Conecte-o ao próximo bloco.</p>;

      case "send_text":
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Mensagem</Label>
              <Textarea
                value={(node.data.text as string) || ""}
                onChange={(e) => update("text", e.target.value)}
                placeholder="Digite a mensagem... Use {{lead.nome}} para variáveis"
                rows={5}
                className="mt-1"
              />
            </div>
          </div>
        );

      case "send_image":
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">URL da Imagem</Label>
              <Input value={(node.data.imageUrl as string) || ""} onChange={(e) => update("imageUrl", e.target.value)} placeholder="https://..." className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Legenda (opcional)</Label>
              <Textarea value={(node.data.caption as string) || ""} onChange={(e) => update("caption", e.target.value)} rows={3} className="mt-1" />
            </div>
          </div>
        );

      case "send_audio":
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">URL do Áudio</Label>
              <Input value={(node.data.audioUrl as string) || ""} onChange={(e) => update("audioUrl", e.target.value)} placeholder="https://...ogg" className="mt-1" />
            </div>
          </div>
        );

      case "send_file":
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">URL do Arquivo</Label>
              <Input value={(node.data.fileUrl as string) || ""} onChange={(e) => update("fileUrl", e.target.value)} placeholder="https://...pdf" className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Legenda (opcional)</Label>
              <Textarea value={(node.data.caption as string) || ""} onChange={(e) => update("caption", e.target.value)} rows={2} className="mt-1" />
            </div>
          </div>
        );

      case "send_video":
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">URL do Vídeo</Label>
              <Input value={(node.data.videoUrl as string) || ""} onChange={(e) => update("videoUrl", e.target.value)} placeholder="https://...mp4" className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Legenda (opcional)</Label>
              <Textarea value={(node.data.caption as string) || ""} onChange={(e) => update("caption", e.target.value)} rows={2} className="mt-1" />
            </div>
          </div>
        );

      case "delay":
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Tempo de espera</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  type="number"
                  min={1}
                  value={(node.data.delaySeconds as number) || 5}
                  onChange={(e) => update("delaySeconds", parseInt(e.target.value) || 1)}
                  className="w-24"
                />
                <Select value={(node.data.unit as string) || "seconds"} onValueChange={(v) => update("unit", v)}>
                  <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="seconds">Segundos</SelectItem>
                    <SelectItem value="minutes">Minutos</SelectItem>
                    <SelectItem value="hours">Horas</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        );

      case "wait_reply":
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Timeout (minutos)</Label>
              <Input
                type="number"
                min={1}
                value={(node.data.timeoutMinutes as number) || 60}
                onChange={(e) => update("timeoutMinutes", parseInt(e.target.value) || 60)}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Salvar resposta em campo (opcional)</Label>
              <Input value={(node.data.saveToField as string) || ""} onChange={(e) => update("saveToField", e.target.value)} placeholder="Nome do campo personalizado" className="mt-1" />
            </div>
          </div>
        );

      case "condition":
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Campo</Label>
              <Select value={(node.data.field as string) || ""} onValueChange={(v) => update("field", v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="last_reply">Última resposta</SelectItem>
                  <SelectItem value="lead.name">Nome do lead</SelectItem>
                  <SelectItem value="lead.source">Origem</SelectItem>
                  <SelectItem value="lead.tags">Tags</SelectItem>
                  <SelectItem value="lead.stage">Etapa</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Operador</Label>
              <Select value={(node.data.operator as string) || "equals"} onValueChange={(v) => update("operator", v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="equals">Igual a</SelectItem>
                  <SelectItem value="not_equals">Diferente de</SelectItem>
                  <SelectItem value="contains">Contém</SelectItem>
                  <SelectItem value="not_contains">Não contém</SelectItem>
                  <SelectItem value="starts_with">Começa com</SelectItem>
                  <SelectItem value="is_empty">Está vazio</SelectItem>
                  <SelectItem value="not_empty">Não está vazio</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Valor</Label>
              <Input value={(node.data.value as string) || ""} onChange={(e) => update("value", e.target.value)} className="mt-1" />
            </div>
          </div>
        );

      case "move_stage":
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Etapa de destino</Label>
              <Select value={(node.data.stageId as string) || ""} onValueChange={(v) => update("stageId", v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione a etapa..." /></SelectTrigger>
                <SelectContent>
                  {stages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                        {s.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        );

      case "add_tag":
      case "remove_tag":
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Tag</Label>
              <Input value={(node.data.tag as string) || ""} onChange={(e) => update("tag", e.target.value)} placeholder="Nome da tag" className="mt-1" />
            </div>
          </div>
        );

      case "add_note":
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Nota</Label>
              <Textarea value={(node.data.note as string) || ""} onChange={(e) => update("note", e.target.value)} placeholder="Texto da nota..." rows={4} className="mt-1" />
            </div>
          </div>
        );

      case "create_task":
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Título da tarefa</Label>
              <Input value={(node.data.title as string) || ""} onChange={(e) => update("title", e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Prazo (horas a partir de agora)</Label>
              <Input type="number" min={1} value={(node.data.dueHours as number) || 24} onChange={(e) => update("dueHours", parseInt(e.target.value) || 24)} className="mt-1" />
            </div>
          </div>
        );

      case "transfer_human":
        return <p className="text-sm text-muted-foreground">O bot será encerrado e a conversa voltará ao modo manual.</p>;

      default:
        return <p className="text-sm text-muted-foreground">Tipo de bloco não configurável.</p>;
    }
  };

  return (
    <div className="w-[320px] border-l border-border bg-card flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <span>{def?.icon}</span>
          <h3 className="font-semibold text-sm">{def?.label || "Propriedades"}</h3>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X size={14} />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div>
          <Label className="text-xs">Nome do bloco</Label>
          <Input
            value={(node.data.label as string) || def?.label || ""}
            onChange={(e) => update("label", e.target.value)}
            className="mt-1"
          />
        </div>

        {renderFields()}
      </div>
    </div>
  );
}
