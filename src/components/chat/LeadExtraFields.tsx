import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { MapPin } from "lucide-react";

// Cidade canônica única (o legado "VCA" foi unificado em "Vitória da Conquista").
const CIDADES = [
  "Vitória da Conquista",
  "Guanambi",
  "Ipiaú",
  "Itabuna",
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
    <section className="space-y-3 border-b border-border/60 px-5 py-5">
      <h3 className="text-[15px] font-semibold text-foreground">Dados adicionais</h3>
      <div>
        <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
          <MapPin size={10} /> Cidade
        </label>
        <select
          value={cidadeValue}
          onChange={(e) => void handleCidadeChange(e.target.value)}
          disabled={saving}
          className="flex h-10 w-full rounded-xl border border-input bg-surface-sunken px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="none">Sem localização</option>
          {CIDADES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>
    </section>
  );
}
