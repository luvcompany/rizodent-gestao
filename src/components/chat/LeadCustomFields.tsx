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
import { Plus, Trash2, Settings2, ListChecks } from "lucide-react";

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
    // Atualização otimista: guarda o valor anterior para reverter se o banco recusar.
    const previous = values[fieldId] || "";
    setValues((prev) => ({ ...prev, [fieldId]: val }));

    // O `.select()` confere que a linha gravou: RLS barrada devolve sucesso com zero linhas.
    const { data, error } = await supabase
      .from("crm_lead_custom_values")
      .upsert(
        { lead_id: leadId, field_id: fieldId, value: val || null },
        { onConflict: "lead_id,field_id" }
      )
      .select("id");
    if (error) {
      setValues((prev) => ({ ...prev, [fieldId]: previous }));
      toast.error("Erro ao salvar campo: " + error.message);
      return;
    }
    if (!data || data.length === 0) {
      setValues((prev) => ({ ...prev, [fieldId]: previous }));
      toast.error("Seu perfil não tem permissão para editar os campos deste lead.");
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
      // 42501 = RLS recusou o insert (só crc/gerente criam campos).
      if (error.code === "42501") {
        toast.error("Seu perfil não tem permissão para criar campos personalizados.");
      } else {
        toast.error("Erro ao criar campo: " + error.message);
      }
      return;
    }
    setNewFieldName("");
    setNewFieldType("text");
    fetchFields();
    toast.success("Campo criado");
  };

  const deleteField = async (fieldId: string) => {
    const { data, error } = await supabase
      .from("crm_custom_fields")
      .delete()
      .eq("id", fieldId)
      .select("id");
    if (error) {
      toast.error("Erro ao excluir campo");
      return;
    }
    if (!data || data.length === 0) {
      toast.error("Seu perfil não tem permissão para excluir campos personalizados.");
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
            className="h-10 rounded-xl border-input bg-card text-sm"
          />
        );
      case "date":
        return (
          <Input
            type="date"
            value={val}
            onChange={(e) => saveValue(field.id, e.target.value)}
            className="h-10 rounded-xl border-input bg-card text-sm"
          />
        );
      case "select":
        return (
          <Select value={val} onValueChange={(v) => saveValue(field.id, v)}>
            <SelectTrigger className="h-10 rounded-xl border-input bg-card text-sm">
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
            className="h-10 rounded-xl border-input bg-card text-sm"
            placeholder="..."
          />
        );
    }
  };

  return (
    <div className="border-b border-border/60 px-5 py-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <ListChecks size={16} strokeWidth={1.75} className="shrink-0 text-tertiary" />
          <span className="text-[15px] font-semibold text-foreground">Outros campos personalizados</span>
        </span>
        <button onClick={() => setManageOpen(true)} className="-mr-1.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          <Settings2 size={16} strokeWidth={1.75} />
        </button>
      </div>

      {fields.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Nenhum campo personalizado.</p>
      ) : (
        <div className="space-y-3.5">
          {fields.map((field) => (
            <div key={field.id}>
              <label className="mb-1.5 block text-[13px] font-medium text-muted-foreground [overflow-wrap:anywhere]">{field.name}</label>
              {renderFieldInput(field)}
            </div>
          ))}
        </div>
      )}

      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold tracking-tight">Outros campos personalizados</DialogTitle>
            <DialogDescription>Gerencie os campos que aparecerão em todos os leads.</DialogDescription>
          </DialogHeader>

          <div className="max-h-60 space-y-2 overflow-y-auto">
            {fields.map((field) => (
              <div key={field.id} className="flex items-center justify-between gap-3 rounded-xl bg-surface-sunken px-3.5 py-2.5">
                <div className="min-w-0">
                  <span className="text-sm font-medium text-foreground">{field.name}</span>
                  <span className="ml-2 text-xs text-tertiary">({field.field_type})</span>
                </div>
                <button onClick={() => deleteField(field.id)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-destructive transition-colors hover:bg-destructive-soft">
                  <Trash2 size={15} strokeWidth={1.75} />
                </button>
              </div>
            ))}
          </div>

          <div className="space-y-2.5 border-t border-border/60 pt-4">
            <div className="flex gap-2">
              <Input
                value={newFieldName}
                onChange={(e) => setNewFieldName(e.target.value)}
                placeholder="Nome do campo"
                className="h-10 rounded-xl text-sm"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addField(); } }}
              />
              <Select value={newFieldType} onValueChange={setNewFieldType}>
                <SelectTrigger className="h-10 w-32 shrink-0 rounded-xl text-sm">
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
            <Button size="sm" onClick={addField} disabled={saving || !newFieldName.trim()} className="h-10 w-full gap-1.5 rounded-xl">
              <Plus size={15} strokeWidth={1.75} /> Adicionar Campo
            </Button>
          </div>

          <DialogFooter>
            <Button variant="outline" className="h-10 rounded-xl px-4" onClick={() => setManageOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
