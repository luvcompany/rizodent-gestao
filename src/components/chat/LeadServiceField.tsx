import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useServicosDoTenant, comValorAtual } from "@/hooks/useOpcoesDoTenant";
import { useVocab } from "@/hooks/useVocab";

// Opções do serviço de interesse: os serviços cadastrados do próprio cliente
// (tipos_procedimento ativos). Sem cadastro, a lista sugerida do segmento.
// "Outro" abre um campo livre; o valor já gravado no lead sempre aparece na
// lista, mesmo que não esteja mais no cadastro.

/** Valor interno da opção "Outro (especificar)". Nunca é gravado. */
const OPCAO_OUTRO = "__outro__";
const OPCAO_NENHUMA = "none";

const semAcento = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
/** "OUTROS"/"Outro" da lista do segmento vira a opção de texto livre. */
const ehOpcaoOutros = (v: string) => ["OUTRO", "OUTROS"].includes(semAcento(v));

type Props = {
  leadId: string;
  servicoInteresse: string | null;
  onUpdated: (updates: { servico_interesse?: string | null }) => void;
};

export default function LeadServiceField({ leadId, servicoInteresse, onUpdated }: Props) {
  const servicosDoTenant = useServicosDoTenant();
  const vocab = useVocab();
  const [saving, setSaving] = useState(false);
  /** Valor gravado no lead (o que o select mostra fora do modo "Outro"). */
  const [servicoValue, setServicoValue] = useState(servicoInteresse || "");
  const [modoOutro, setModoOutro] = useState(false);
  const [outrosTexto, setOutrosTexto] = useState("");
  const lastSavedServicoRef = useRef(servicoInteresse || "");
  const leadAnteriorRef = useRef(leadId);

  // Troca de lead ou mudança externa do valor: sincroniza. O eco do próprio
  // salvamento (valor igual ao último gravado) não tira a pessoa do modo "Outro"
  // no meio da digitação.
  useEffect(() => {
    const nextValue = servicoInteresse || "";
    const trocouDeLead = leadAnteriorRef.current !== leadId;
    leadAnteriorRef.current = leadId;
    if (!trocouDeLead && nextValue === lastSavedServicoRef.current) return;
    setServicoValue(nextValue);
    setModoOutro(false);
    setOutrosTexto("");
    lastSavedServicoRef.current = nextValue;
  }, [servicoInteresse, leadId]);

  const opcoes = useMemo(() => {
    const base = (servicosDoTenant.length > 0 ? servicosDoTenant : vocab.servicosInteresse).filter(
      (s) => !ehOpcaoOutros(s),
    );
    return comValorAtual(base, servicoValue);
  }, [servicosDoTenant, vocab.servicosInteresse, servicoValue]);

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

  // Texto livre ("Outro"): grava 500 ms depois da última tecla. Campo vazio não
  // grava (para limpar, use "Selecione...").
  useEffect(() => {
    if (!modoOutro) return;
    const texto = outrosTexto.trim();
    if (!texto || texto === lastSavedServicoRef.current.trim()) return;

    const timeout = window.setTimeout(async () => {
      const anterior = lastSavedServicoRef.current;
      lastSavedServicoRef.current = texto;
      const success = await updateField(texto);
      if (success) setServicoValue(texto);
      else lastSavedServicoRef.current = anterior;
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [outrosTexto, modoOutro, updateField]);

  const selectValue = modoOutro ? OPCAO_OUTRO : (servicoValue || OPCAO_NENHUMA);

  const handleChange = async (value: string) => {
    const previousValue = servicoValue;

    if (value === OPCAO_OUTRO) {
      setModoOutro(true);
      setOutrosTexto("");
      return;
    }

    const novo = value === OPCAO_NENHUMA ? "" : value;
    setModoOutro(false);
    setOutrosTexto("");
    setServicoValue(novo);
    lastSavedServicoRef.current = novo;
    const ok = await updateField(novo || null);
    if (!ok) {
      setServicoValue(previousValue);
      lastSavedServicoRef.current = previousValue;
    }
  };

  return (
    <div className="mb-3 space-y-2">
      <label className="text-xs text-muted-foreground mb-1 block">{vocab.servico} de interesse</label>
      <Select
        value={selectValue}
        onValueChange={(val) => void handleChange(val)}
        disabled={saving}
      >
        <SelectTrigger className="bg-secondary border-border h-8 text-sm">
          <SelectValue placeholder="Selecione..." />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={OPCAO_NENHUMA}>Selecione...</SelectItem>
          {opcoes.map((s) => (
            <SelectItem key={s} value={s}>{s}</SelectItem>
          ))}
          <SelectItem value={OPCAO_OUTRO}>Outro (especificar)</SelectItem>
        </SelectContent>
      </Select>

      {modoOutro && (
        <Input
          value={outrosTexto}
          onChange={(e) => setOutrosTexto(e.target.value)}
          placeholder="Especifique o que a pessoa procura"
          autoFocus
          className="bg-secondary border-border text-sm h-8"
        />
      )}
    </div>
  );
}
