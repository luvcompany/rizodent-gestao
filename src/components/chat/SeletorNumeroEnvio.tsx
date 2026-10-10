import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { CHAVE_ENVIO_DO_LEAD } from "@/hooks/useEnvioDoLead";
import { mensagemDeErro } from "@/lib/mensagemDeErro";
import { rotuloDoNumero } from "@/lib/numeroWhatsapp";

type NumeroDoSeletor = {
  id: string;
  display_name: string | null;
  phone_e164: string | null;
  is_active: boolean;
};

/** Papéis cujo lead sempre tem número próprio: a opção "Padrão" (número da central) não vale para eles. */
const PAPEIS_SEM_PADRAO = new Set(["closer", "recepcao"]);

/**
 * "Enviar por": escolhe o número de WhatsApp deste lead. "Padrão" deixa o
 * servidor decidir (número padrão de envio, funil ou número principal) — só
 * para a central; closer e recepção escolhem sempre um número próprio.
 * Só números ATIVOS aparecem: número desativado não envia.
 */
export default function SeletorNumeroEnvio({
  leadId, atual, numeros, onChange,
}: { leadId: string; atual: string | null; numeros: NumeroDoSeletor[]; onChange?: (id: string | null) => void }) {
  const queryClient = useQueryClient();
  const { userRole } = useAuth();
  const [valor, setValor] = useState<string>(atual ?? "padrao");
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { setValor(atual ?? "padrao"); }, [atual, leadId]);

  const ativos = numeros.filter((n) => n.is_active);
  if (ativos.length === 0) return null;
  const mostrarPadrao = !PAPEIS_SEM_PADRAO.has(userRole ?? "");
  // Valor que não está na lista (número desativado, ou "Padrão" escondido)
  // fica vazio: o seletor mostra o aviso em vez de um item em branco.
  const valorNaLista = valor === "padrao" ? mostrarPadrao : ativos.some((n) => n.id === valor);
  const marcador = valor !== "padrao" && !valorNaLista ? "Número desativado — escolha outro" : "Escolha o número";

  const trocar = async (v: string) => {
    if (v === valor) return;
    const anterior = valor;
    setValor(v);
    setSalvando(true);
    const novo = v === "padrao" ? null : v;
    const { data, error } = await supabase
      .from("crm_leads")
      .update({ whatsapp_number_id: novo })
      .eq("id", leadId)
      .select("id");
    setSalvando(false);
    if (error || !data || data.length === 0) {
      setValor(anterior);
      toast.error("Não foi possível trocar o número", {
        description: error
          ? mensagemDeErro(error)
          : "O lead não foi alterado (pode ter sido excluído ou você não tem acesso a ele).",
      });
      return;
    }
    onChange?.(novo);
    // O selo/trava do compositor ("Vai sair por") lê o número de envio por esta chave.
    void queryClient.invalidateQueries({ queryKey: [CHAVE_ENVIO_DO_LEAD] });
    toast.success("Número de envio alterado");
  };

  return (
    <div className="flex items-center gap-2 px-3 pt-2 text-xs text-muted-foreground">
      <span className="shrink-0">Enviar por:</span>
      <Select value={valorNaLista ? valor : ""} onValueChange={trocar} disabled={salvando}>
        <SelectTrigger className="h-8 w-auto min-w-[180px] max-w-full rounded-xl text-xs">
          <SelectValue placeholder={marcador} />
        </SelectTrigger>
        <SelectContent>
          {mostrarPadrao && <SelectItem value="padrao">Padrão (número padrão de envio)</SelectItem>}
          {ativos.map((n) => (
            <SelectItem key={n.id} value={n.id}>{rotuloDoNumero(n)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
