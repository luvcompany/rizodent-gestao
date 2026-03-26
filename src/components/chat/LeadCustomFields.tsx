import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Plus, Trash2, Settings2 } from "lucide-react";

type CustomField = {
  id: string;
  name: string;
  field_type: string;
  options: string[];
  position: number;
};

type CustomValue = {
  id: string;
  field_id: string;
  value: string | null;
};

type Props = {
  leadId: string;
};

export default function LeadCustomFields({ leadId }: Props) {
  const [fields, setFields] = useState<CustomField[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [manageOpen, setManageOpen] = useState(false);
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState("text");
  const [saving, setSaving] = useState(false);

  const fetchFields = async () => {
    const { data } = await supabase
      .from("crm_custom_fields")
      .select("*")
      .order("position");
    if (data) {
      setFields(data.map((f: any) => ({
        ...f,
        options: Array.isArray(f.options) ? f.options : [],
      })));
    }
  };

  const fetchValues = async () => {
    const { data } = await supabase
      .from("crm_lead_custom_values")
      .select("*")
      .eq("lead_id", leadId);
    if (data) {
      const map: Record<string, string> = {};
      data.forEach((v: any) => { if (v.value) map[v.field_id] = v.value; });
      setValues(map);
    }
  };

  useEffect(() => {
    fetchFields();
    fetchValues();
  }, [leadId]);

  const saveValue = async (fieldId: string, val: string) => {
    setValues((prev) => ({ ...prev, [fieldId]: val }));

    const { error } = await supabase
      .from("crm_lead_custom_values")
      .upsert(
        { lead_id: leadId, field_id: fieldId, value: val || null },
        { onConflict: "lead_id,field_id" }
      );
    if (error) {
      toast.error("Erro ao salvar campo");
    }
  };

  const addField = async () => {
    if (!newFieldName.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("crm_custom_fields").insert({
      name: newFieldName.trim(),
      field_type: newFieldType,
      position: fields.length,
    });
    setSaving(false);
    if (error) {
      toast.error("Erro ao criar campo");
      return;
    }
    setNewFieldName("");
    setNewFieldType("text");
    fetchFields();
    toast.success("Campo criado");
  };

  const deleteField = async (fieldId: string) => {
    const { error } = await supabase.from("crm_custom_fields").delete().eq("id", fieldId);
    if (error) {
      toast.error("Erro ao excluir campo");
      return;
    }
    setFields((prev) => prev.filter((f) => f.id !== fieldId));
    toast.success("Campo excluído");
  };

  const renderFieldInput = (field: CustomField) => {
    const val = values[field.id] || "";

    switch (field.field_type) {
      case "boolean":
        return (
          <Switch
            checked={val === "true"}
            onCheckedChange={(checked) => saveValue(field.id, checked.toString())}
          />
        );
      case "number":
        return (
          <Input
            type="number"
            value={val}
            onChange={(e) => saveValue(field.id, e.target.value)}
            className="bg-secondary border-border text-sm h-8"
          />
        );
      case "date":
        return (
          <Input
            type="date"
            value={val}
            onChange={(e) => saveValue(field.id, e.target.value)}
            className="bg-secondary border-border text-sm h-8"
          />
        );
      case "select":
        return (
          <Select value={val} onValueChange={(v) => saveValue(field.id, v)}>
            <SelectTrigger className="bg-secondary border-border text-sm h-8">
              <SelectValue placeholder="Selecione..." />
            </SelectTrigger>
            <SelectContent>
              {field.options.map((opt) => (
                <SelectItem key={opt} value={opt}>{opt}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      default:
        return (
          <Input
            value={val}
            onChange={(e) => saveValue(field.id, e.target.value)}
            className="bg-secondary border-border text-sm h-8"
            placeholder="..."
          />
        );
    }
  };

  return (
    <div className="p-4 border-b border-border">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-muted-foreground uppercase">Campos Personalizados</span>
        <button onClick={() => setManageOpen(true)} className="text-muted-foreground hover:text-foreground">
          <Settings2 size={14} />
        </button>
      </div>

      {fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum campo personalizado.</p>
      ) : (
        <div className="space-y-2">
          {fields.map((field) => (
            <div key={field.id}>
              <label className="text-xs text-muted-foreground">{field.name}</label>
              {renderFieldInput(field)}
            </div>
          ))}
        </div>
      )}

      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Campos Personalizados</DialogTitle>
            <DialogDescription>Gerencie os campos que aparecerão em todos os leads.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3 max-h-60 overflow-y-auto">
            {fields.map((field) => (
              <div key={field.id} className="flex items-center justify-between p-2 bg-secondary rounded">
                <div>
                  <span className="text-sm font-medium text-foreground">{field.name}</span>
                  <span className="text-xs text-muted-foreground ml-2">({field.field_type})</span>
                </div>
                <button onClick={() => deleteField(field.id)} className="text-destructive hover:text-destructive/80">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          <div className="border-t border-border pt-3 space-y-2">
            <div className="flex gap-2">
              <Input
                value={newFieldName}
                onChange={(e) => setNewFieldName(e.target.value)}
                placeholder="Nome do campo"
                className="text-sm"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addField(); } }}
              />
              <Select value={newFieldType} onValueChange={setNewFieldType}>
                <SelectTrigger className="w-28 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">Texto</SelectItem>
                  <SelectItem value="number">Número</SelectItem>
                  <SelectItem value="date">Data</SelectItem>
                  <SelectItem value="boolean">Sim/Não</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" onClick={addField} disabled={saving || !newFieldName.trim()} className="w-full">
              <Plus size={14} className="mr-1" /> Adicionar Campo
            </Button>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setManageOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
