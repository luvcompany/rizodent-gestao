import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { MapPin, ChevronDown } from "lucide-react";
import { comValorAtual, useCidadesDoTenant } from "@/hooks/useOpcoesDoTenant";
import { mensagemDeErro } from "@/lib/mensagemDeErro";

type Props = {
  leadId: string;
  cidade: string | null;
  onUpdated: (updates: { cidade?: string | null }) => void;
  /**
   * Paciente principal do lead, para a cidade do cadastro dele acompanhar a do
   * lead. Só quem pode editar pacientes passa (crc/gerente/superadmin): era o
   * que o seletor de Cidade do "Orçamento & Valor" fazia — CONV-19 deixou UM
   * campo de Cidade no painel, este, para todos os papéis.
   */
  pacienteId?: string | null;
};

export default function LeadExtraFields({ leadId, cidade, onUpdated, pacienteId }: Props) {
  const [saving, setSaving] = useState(false);
  const [cidadeValue, setCidadeValue] = useState(cidade || "none");
  // Opções = cidades das clínicas ativas do tenant (+ a do lead, se for outra).
  const cidades = comValorAtual(useCidadesDoTenant(), cidade);

  useEffect(() => {
    setCidadeValue(cidade || "none");
  }, [cidade, leadId]);

  const updateField = useCallback(async (value: string | null) => {
    setSaving(true);
    // Sem .single(): update recusado pela RLS volta sem erro e sem linha, e o
    // .single() transformava isso num erro genérico ("Erro ao salvar").
    const [leadRes, pacienteRes] = await Promise.all([
      supabase
        .from("crm_leads")
        .update({
          cidade: value || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", leadId)
        .select("cidade"),
      pacienteId
        ? supabase.from("pacientes").update({ cidade: value || null }).eq("id", pacienteId).select("id")
        : Promise.resolve({ data: null, error: null }),
    ]);
    setSaving(false);
    if (leadRes.error) {
      toast.error("Erro ao salvar a cidade: " + mensagemDeErro(leadRes.error));
      return false;
    }
    if (!leadRes.data || leadRes.data.length === 0) {
      toast.error("Seu perfil não tem permissão para alterar a cidade deste lead.");
      return false;
    }
    if (pacienteId && (pacienteRes.error || !pacienteRes.data || pacienteRes.data.length === 0)) {
      // A cidade do lead gravou; só o cadastro do paciente ficou como estava.
      toast.error("Cidade salva no lead, mas o cadastro do paciente não foi atualizado.");
    }
    onUpdated({ cidade: (leadRes.data[0] as { cidade: string | null }).cidade ?? null });
    return true;
  }, [leadId, onUpdated, pacienteId]);

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
    <div className="space-y-2 border-b border-border/60 px-5 py-5">
      <div>
        <label className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
          <MapPin size={14} strokeWidth={1.75} className="shrink-0 text-tertiary" /> Cidade
        </label>
        <span className="relative block">
        <select
          value={cidadeValue}
          onChange={(e) => void handleCidadeChange(e.target.value)}
          disabled={saving}
          className="flex h-10 w-full cursor-pointer appearance-none rounded-xl border border-input bg-card pl-3.5 pr-10 text-sm text-foreground ring-offset-background transition-colors hover:border-border focus-visible:border-primary/50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="none">Sem localização</option>
          {cidades.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <ChevronDown size={16} strokeWidth={1.75} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-tertiary" />
        </span>
      </div>
    </div>
  );
}
