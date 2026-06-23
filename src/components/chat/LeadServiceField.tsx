import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
  servicoInteresse: string | null;
  onUpdated: (updates: { servico_interesse?: string | null }) => void;
};

export default function LeadServiceField({ leadId, servicoInteresse, onUpdated }: Props) {
  const [saving, setSaving] = useState(false);
  const [servicoValue, setServicoValue] = useState(servicoInteresse || "");
  const [outrosTexto, setOutrosTexto] = useState(isCustomService(servicoInteresse) ? servicoInteresse || "" : "");
  const lastSavedServicoRef = useRef(servicoInteresse || "");

  useEffect(() => {
    const nextValue = servicoInteresse || "";
    setServicoValue(nextValue);
    setOutrosTexto(isCustomService(servicoInteresse) ? nextValue : "");
    lastSavedServicoRef.current = nextValue;
  }, [servicoInteresse, leadId]);

  const updateField = useCallback(async (value: string | null) => {
    setSaving(true);
    const { data, error } = await supabase
      .from("crm_leads")
      .update({
        servico_interesse: value || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", leadId)
      .select("servico_interesse")
      .single();
    setSaving(false);
    if (error) {
      toast.error("Erro ao salvar");
      return false;
    }
    onUpdated({ servico_interesse: data?.servico_interesse ?? null });
    return true;
  }, [leadId, onUpdated]);

  useEffect(() => {
    const selectValue = SERVICOS.includes(servicoValue) ? servicoValue : (servicoValue ? "OUTROS" : "none");
    if (selectValue !== "OUTROS") return;

    const normalizedCurrent = outrosTexto.trim();
    const normalizedSaved = lastSavedServicoRef.current.trim();

    if (normalizedCurrent === normalizedSaved) return;

    const timeout = window.setTimeout(async () => {
      const success = await updateField(normalizedCurrent || null);
      if (success) {
        lastSavedServicoRef.current = normalizedCurrent;
        setServicoValue(normalizedCurrent);
      }
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [outrosTexto, servicoValue, updateField]);

  const selectValue = SERVICOS.includes(servicoValue) ? servicoValue : (servicoValue ? "OUTROS" : "none");

  const handleChange = async (value: string) => {
    const previousValue = servicoValue;

    if (value === "none") {
      setServicoValue("");
      setOutrosTexto("");
      lastSavedServicoRef.current = "";
      const ok = await updateField(null);
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
    const ok = await updateField(value);
    if (!ok) {
      setServicoValue(previousValue);
      setOutrosTexto(isCustomService(previousValue) ? previousValue : "");
      lastSavedServicoRef.current = previousValue;
    }
  };

  return (
    <div className="mb-3 space-y-2">
      <label className="text-xs text-muted-foreground mb-1 block">Serviço de Interesse</label>
      <Select
        value={selectValue}
        onValueChange={(val) => void handleChange(val)}
        disabled={saving}
      >
        <SelectTrigger className="bg-secondary border-border h-8 text-sm">
          <SelectValue placeholder="Selecione..." />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Selecione...</SelectItem>
          {SERVICOS.map((s) => (
            <SelectItem key={s} value={s}>{s}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selectValue === "OUTROS" && (
        <Input
          value={outrosTexto}
          onChange={(e) => setOutrosTexto(e.target.value)}
          placeholder="Especifique o serviço (restauração, extração, canal...)"
          disabled={saving}
          className="bg-secondary border-border text-sm h-8"
        />
      )}
    </div>
  );
}
