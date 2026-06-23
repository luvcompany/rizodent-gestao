import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { MapPin, Briefcase } from "lucide-react";

const CIDADES = [
  "Vitória da Conquista",
  "Guanambi",
  "Ipiaú",
  "Itabuna",
  "VCA",
];

const SERVICOS = [
  "PRÓTESE",
  "IMPLANTE",
  "ZIGOMÁTICO",
  "FACETA",
  "PROTOCOLO",
  "OUTROS",
];

function isCustomService(value: string | null): boolean {
  return !!value && !SERVICOS.includes(value);
}

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
  const [outrosTexto, setOutrosTexto] = useState(isCustomService(servicoInteresse) ? servicoInteresse || "" : "");
  const lastSavedServicoRef = useRef(servicoInteresse || "");

  useEffect(() => {
    setCidadeValue(cidade || "none");
  }, [cidade, leadId]);

  useEffect(() => {
    const nextValue = servicoInteresse || "";
    setServicoValue(nextValue);
    setOutrosTexto(isCustomService(servicoInteresse) ? nextValue : "");
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
    const selectValue = SERVICOS.includes(servicoValue) ? servicoValue : (servicoValue ? "OUTROS" : "none");
    if (selectValue !== "OUTROS") return;

    const normalizedCurrent = outrosTexto.trim();
    const normalizedSaved = lastSavedServicoRef.current.trim();

    if (normalizedCurrent === normalizedSaved) return;

    const timeout = window.setTimeout(async () => {
      const success = await updateField("servico_interesse", normalizedCurrent || null);
      if (success) {
        lastSavedServicoRef.current = normalizedCurrent;
        setServicoValue(normalizedCurrent);
      }
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [outrosTexto, servicoValue, updateField]);

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

  const selectValue = SERVICOS.includes(servicoValue) ? servicoValue : (servicoValue ? "OUTROS" : "none");

  const handleServicoChange = async (value: string) => {
    const previousValue = servicoValue;

    if (value === "none") {
      setServicoValue("");
      setOutrosTexto("");
      lastSavedServicoRef.current = "";
      const ok = await updateField("servico_interesse", null);
      if (!ok) {
        setServicoValue(previousValue);
        setOutrosTexto(isCustomService(previousValue) ? previousValue : "");
        lastSavedServicoRef.current = previousValue;
      }
      return;
    }

    if (value === "OUTROS") {
      setServicoValue(value);
      setOutrosTexto("");
      return;
    }

    setServicoValue(value);
    setOutrosTexto("");
    lastSavedServicoRef.current = value;
    const ok = await updateField("servico_interesse", value);
    if (!ok) {
      setServicoValue(previousValue);
      setOutrosTexto(isCustomService(previousValue) ? previousValue : "");
      lastSavedServicoRef.current = previousValue;
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

      <div>
        <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
          <Briefcase size={10} /> Serviço de Interesse
        </label>
        <select
          value={selectValue}
          onChange={(e) => void handleServicoChange(e.target.value)}
          disabled={saving}
          className="flex h-8 w-full rounded-md border border-input bg-secondary px-3 py-1 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="none">Selecione...</option>
          {SERVICOS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        {selectValue === "OUTROS" && (
          <Input
            value={outrosTexto}
            onChange={(e) => setOutrosTexto(e.target.value)}
            placeholder="Especifique o serviço (restauração, extração, canal...)"
            disabled={saving}
            className="mt-2 bg-secondary border-border text-sm h-8"
          />
        )}
      </div>
    </div>
  );
}
