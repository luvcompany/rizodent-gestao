import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { MapPin, Pencil } from "lucide-react";

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
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setCidadeValue(cidade || "none");
    setEditing(false);
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
    if (success) {
      setEditing(false);
    } else {
      setCidadeValue(previousValue);
      onUpdated({ cidade: previousValue === "none" ? null : previousValue });
    }
  };

  const displayValue = cidadeValue === "none" ? null : cidadeValue;

  return (
    <div className="p-4 border-b border-border space-y-2">
      <div>
        <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
          <MapPin size={10} /> Cidade
        </label>

        {!editing ? (
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-foreground">
              {displayValue ?? <span className="text-muted-foreground italic">Automática (aguardando)</span>}
            </span>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-[11px] text-muted-foreground hover:text-primary inline-flex items-center gap-1"
              title="Corrigir manualmente (exceção)"
            >
              <Pencil size={10} /> corrigir
            </button>
          </div>
        ) : (
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
        )}
      </div>
    </div>
  );
}
