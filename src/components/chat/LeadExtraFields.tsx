import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MapPin, Briefcase } from "lucide-react";

const CIDADES = [
  "Vitória da Conquista",
  "Guanambi",
  "Ipiaú",
  "Itabuna",
  "VCA",
];

type Props = {
  leadId: string;
  cidade: string | null;
  servicoInteresse: string | null;
  onUpdated: (updates: { cidade?: string | null; servico_interesse?: string | null }) => void;
};

export default function LeadExtraFields({ leadId, cidade, servicoInteresse, onUpdated }: Props) {
  const [saving, setSaving] = useState(false);

  const updateField = useCallback(async (field: "cidade" | "servico_interesse", value: string | null) => {
    setSaving(true);
    const payload = { updated_at: new Date().toISOString() } as any;
    payload[field] = value || null;
    const { error } = await supabase
      .from("crm_leads")
      .update(payload)
      .eq("id", leadId);
    setSaving(false);
    if (error) {
      toast.error("Erro ao salvar");
      return;
    }
    onUpdated({ [field]: value || null });
  }, [leadId, onUpdated]);

  return (
    <div className="p-4 border-b border-border space-y-2">
      <div>
        <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
          <MapPin size={10} /> Cidade
        </label>
        <Select
          value={cidade || "none"}
          onValueChange={(v) => updateField("cidade", v === "none" ? null : v)}
        >
          <SelectTrigger className="bg-secondary border-border text-sm h-8">
            <SelectValue placeholder="Selecionar cidade..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">—</SelectItem>
            {CIDADES.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
          <Briefcase size={10} /> Serviço de Interesse
        </label>
        <Input
          value={servicoInteresse || ""}
          onChange={(e) => {
            onUpdated({ servico_interesse: e.target.value });
          }}
          onBlur={(e) => updateField("servico_interesse", e.target.value)}
          placeholder="Ex: Implante, Ortodontia..."
          className="bg-secondary border-border text-sm h-8"
        />
      </div>
    </div>
  );
}
