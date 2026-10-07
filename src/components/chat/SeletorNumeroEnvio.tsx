import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Numero = { id: string; nome: string };

/**
 * "Enviar por": escolhe o número de WhatsApp deste lead. "Padrão" deixa o
 * servidor decidir (número padrão de envio, funil ou número principal).
 */
export default function SeletorNumeroEnvio({
  leadId, atual, numeros, onChange,
}: { leadId: string; atual: string | null; numeros: Numero[]; onChange?: (id: string | null) => void }) {
  const [valor, setValor] = useState<string>(atual ?? "padrao");
  useEffect(() => { setValor(atual ?? "padrao"); }, [atual, leadId]);
  if (numeros.length === 0) return null;

  const trocar = async (v: string) => {
    const anterior = valor;
    setValor(v);
    const novo = v === "padrao" ? null : v;
    const { error } = await supabase.from("crm_leads").update({ whatsapp_number_id: novo } as any).eq("id", leadId);
    if (error) {
      setValor(anterior);
      toast.error("Não foi possível trocar o número", { description: error.message });
      return;
    }
    onChange?.(novo);
    toast.success("Número de envio alterado");
  };

  return (
    <div className="flex items-center gap-2 px-3 pt-2 text-xs text-muted-foreground">
      <span className="shrink-0">Enviar por:</span>
      <Select value={valor} onValueChange={trocar}>
        <SelectTrigger className="h-8 w-auto min-w-[180px] max-w-full rounded-xl text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="padrao">Padrão (número padrão de envio)</SelectItem>
          {numeros.map((n) => (
            <SelectItem key={n.id} value={n.id}>{n.nome}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
