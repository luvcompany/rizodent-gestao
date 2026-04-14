import { useState, useCallback, useEffect, useRef } from "react";
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
  const [cidadeValue, setCidadeValue] = useState(cidade || "none");
  const [servicoValue, setServicoValue] = useState(servicoInteresse || "");
  const lastSavedServicoRef = useRef(servicoInteresse || "");

  useEffect(() => {
    setCidadeValue(cidade || "none");
  }, [cidade, leadId]);

  useEffect(() => {
    const nextValue = servicoInteresse || "";
    setServicoValue(nextValue);
    lastSavedServicoRef.current = nextValue;
  }, [servicoInteresse, leadId]);

  const updateField = useCallback(async (field: "cidade" | "servico_interesse", value: string | null) => {
    setSaving(true);
    const payload = { updated_at: new Date().toISOString() } as any;
    payload[field] = value || null;
    const { data, error } = await supabase
      .from("crm_leads")
      .update(payload)
      .eq("id", leadId)
      .select("cidade, servico_interesse")
      .single();
    setSaving(false);
    if (error) {
      toast.error("Erro ao salvar");
      return false;
    }
    onUpdated({
      cidade: data?.cidade ?? null,
      servico_interesse: data?.servico_interesse ?? null,
    });
    return true;
  }, [leadId, onUpdated]);

  useEffect(() => {
    const normalizedCurrent = servicoValue.trim();
    const normalizedSaved = lastSavedServicoRef.current.trim();

    if (normalizedCurrent === normalizedSaved) return;

    const timeout = window.setTimeout(async () => {
      const success = await updateField("servico_interesse", normalizedCurrent || null);
      if (success) {
        lastSavedServicoRef.current = normalizedCurrent;
      }
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [servicoValue, updateField]);

  const handleCidadeChange = async (value: string) => {
    const previousValue = cidadeValue;
    const normalizedValue = value === "none" ? null : value;

    setCidadeValue(value);
    onUpdated({ cidade: normalizedValue });

    const success = await updateField("cidade", normalizedValue);
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
        <Select
          value={cidadeValue}
          onValueChange={handleCidadeChange}
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
          value={servicoValue}
          onChange={(e) => setServicoValue(e.target.value)}
          placeholder="Ex: Implante, Ortodontia..."
          className="bg-secondary border-border text-sm h-8"
        />
      </div>
    </div>
  );
}
