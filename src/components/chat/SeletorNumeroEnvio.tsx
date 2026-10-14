import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CHAVE_ENVIO_DO_LEAD } from "@/hooks/useEnvioDoLead";
import { mensagemDeErro } from "@/lib/mensagemDeErro";
import { rotuloDoNumero } from "@/lib/numeroWhatsapp";

type NumeroDoSeletor = {
  id: string;
  display_name: string | null;
  phone_e164: string | null;
  is_active: boolean;
};

type Opcao = {
  numero_id: string;
  display_name: string | null;
  phone_e164: string | null;
  /** 'equipe' = número da equipe do lead; 'janela' = número de outra equipe em que o paciente escreveu. */
  motivo: "equipe" | "janela";
  janela_ate: string | null;
  escolhido: boolean;
};

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/**
 * "Responder por": por qual número sai a resposta deste lead.
 * "Automático" = o servidor decide (número em que o paciente escreveu nas
 * últimas 24h; senão o número da equipe do lead). A lista vem do banco
 * (opcoes_numero_resposta): números ativos da equipe do lead que a pessoa
 * acessa e, com a janela aberta, o número de OUTRA equipe em que o paciente
 * escreveu — o caso do lead transferido da central para o closer (dono,
 * 14/10/2026). A escolha fica no lead (numero_resposta_id) e é conferida de
 * novo no envio; modelo sai sempre por número da equipe.
 */
export default function SeletorNumeroEnvio({
  leadId, atual, onChange,
}: { leadId: string; atual: string | null; numeros?: NumeroDoSeletor[]; onChange?: (id: string | null) => void }) {
  const queryClient = useQueryClient();
  const { data: opcoes = [], refetch } = useQuery({
    queryKey: ["opcoes_numero_resposta", leadId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("opcoes_numero_resposta" as any, { p_lead: leadId });
      if (error) throw error;
      return (data ?? []) as Opcao[];
    },
    refetchInterval: 60_000,
    staleTime: 15_000,
  });
  const escolhida = opcoes.find((o) => o.escolhido)?.numero_id ?? null;
  const [valor, setValor] = useState<string>("auto");
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { setValor(escolhida ?? "auto"); }, [escolhida, leadId]);
  // Mudou o lead/número do lead: a lista muda junto.
  useEffect(() => { void refetch(); }, [atual, refetch]);

  if (opcoes.length === 0) return null;
  const janela = opcoes.find((o) => o.motivo === "janela" || o.janela_ate);

  const trocar = async (v: string) => {
    if (v === valor) return;
    const anterior = valor;
    setValor(v);
    setSalvando(true);
    const novo = v === "auto" ? null : v;
    const { error } = await supabase.rpc("definir_numero_resposta" as any, { p_lead: leadId, p_numero: novo });
    setSalvando(false);
    if (error) {
      setValor(anterior);
      toast.error("Não foi possível trocar o número", { description: mensagemDeErro(error) });
      return;
    }
    onChange?.(novo);
    // O selo/trava do compositor ("Vai sair por") lê o número de envio por esta chave.
    void queryClient.invalidateQueries({ queryKey: [CHAVE_ENVIO_DO_LEAD] });
    void refetch();
    toast.success(novo ? "Resposta vai sair por esse número" : "Número de resposta automático");
  };

  return (
    <div className="flex items-center gap-2 px-3 pt-2 text-xs text-muted-foreground">
      <span className="shrink-0">Responder por:</span>
      <Select value={valor} onValueChange={trocar} disabled={salvando}>
        <SelectTrigger className="h-8 w-auto min-w-[180px] max-w-full rounded-xl text-xs">
          <SelectValue placeholder="Escolha o número" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">
            {janela?.janela_ate
              ? `Automático (onde o paciente escreveu, até ${hora(janela.janela_ate)})`
              : "Automático"}
          </SelectItem>
          {opcoes.map((o) => (
            <SelectItem key={o.numero_id} value={o.numero_id}>
              {rotuloDoNumero({ display_name: o.display_name, phone_e164: o.phone_e164 } as any)}
              {o.janela_ate ? ` — paciente escreveu aqui (até ${hora(o.janela_ate)})` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
