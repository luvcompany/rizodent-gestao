import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { MapPin } from "lucide-react";

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
  onUpdated: (updates: { cidade?: string | null }) => void;
};

export default function LeadExtraFields({ leadId, cidade, onUpdated }: Props) {
  const [saving, setSaving] = useState(false);
  const [cidadeValue, setCidadeValue] = useState(cidade || "none");

  useEffect(() => {
    setCidadeValue(cidade || "none");
  }, [cidade, leadId]);

  const updateField = useCallback(async (value: string | null) => {
    setSaving(true);
    const { data, error } = await supabase
      .from("crm_leads")
      .update({
        cidade: value || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", leadId)
      .select("cidade")
      .single();
    setSaving(false);
    if (error) {
      toast.error("Erro ao salvar");
      return false;
    }
    onUpdated({ cidade: data?.cidade ?? null });
    return true;
  }, [leadId, onUpdated]);

  const handleCidadeChange = async (value: string) => {
    const previousValue = cidadeValue;
    const normalizedValue = value === "none" ? null : value;

    setCidadeValue(value);
    onUpdated({ cidade: normalizedValue });

    const success = await updateField(normalizedValue);
    if (!success) {
      setCidadeValue(previousValue);
      onUpdated({ cidade: previousValue === "none" ? null : previousValue });
    }
  };

  return (
    <div className="p-4 border-b border-border space-y-2">
      <div>
        <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
          <MapPin size={10} /> Cidade
        </label>
        <select
          value={cidadeValue}
          onChange={(e) => void handleCidadeChange(e.target.value)}
          disabled={saving}
          className="flex h-8 w-full rounded-md border border-input bg-secondary px-3 py-1 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="none">Sem localização</option>
          {CIDADES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
