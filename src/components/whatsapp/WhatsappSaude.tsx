import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { StatusPill } from "@/components/crm-ui";
import { useToast } from "@/hooks/use-toast";

type Saude = {
  key: string;
  config: { phone_number_id?: string; display_name?: string } | null;
  health_status: string | null;
  health_reason: string | null;
  health_checked_at: string | null;
};

const hora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

function useSaudeWhatsapp() {
  const [itens, setItens] = useState<Saude[]>([]);
  const carregar = useCallback(async () => {
    const { data } = await supabase
      .from("integrations")
      .select("key, config, health_status, health_reason, health_checked_at")
      .like("key", "whatsapp_%")
      .neq("status", "disabled");
    setItens((data as unknown as Saude[]) ?? []);
  }, []);
  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 60_000);
    return () => clearInterval(t);
  }, [carregar]);
  return { itens, carregar };
}

/** Selo de saúde do número na Meta, com botão "Verificar agora". */
export function SeloSaudeWhatsapp({ phoneNumberId }: { phoneNumberId?: string | null }) {
  const { itens, carregar } = useSaudeWhatsapp();
  const [verificando, setVerificando] = useState(false);
  const { toast } = useToast();
  const s = itens.find((i) => i.config?.phone_number_id && String(i.config.phone_number_id) === String(phoneNumberId));
  if (!phoneNumberId || !s) return null;

  const verificar = async () => {
    setVerificando(true);
    const { error } = await supabase.functions.invoke("whatsapp-health-check", { body: {} });
    await carregar();
    setVerificando(false);
    if (error) toast({ title: "Não foi possível verificar agora", variant: "destructive" });
  };

  const tone = s.health_status === "error" ? "destructive" : s.health_status === "warning" ? "warning" : s.health_status === "ok" ? "success" : "muted";
  const rotulo = s.health_status === "error" ? (s.health_reason || "Problema na Meta")
    : s.health_status === "warning" ? (s.health_reason || "Qualidade baixa / Limitado")
    : s.health_status === "ok" ? "Conectado na Meta" : "Ainda não verificado";

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <StatusPill tone={tone as never}>{rotulo}</StatusPill>
      <span className="text-[11px] text-muted-foreground">Checado {hora(s.health_checked_at)}</span>
      <button
        type="button"
        onClick={verificar}
        disabled={verificando}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline disabled:opacity-50"
      >
        <RefreshCw size={11} className={verificando ? "animate-spin" : ""} /> Verificar agora
      </button>
    </div>
  );
}


/**
 * Chave "Número padrão de envio": tudo o que não tem número escolhido
 * (automações, bots, follow-up, leads sem número) sai por este número.
 */
export function PadraoEnvioWhatsapp({ phoneNumberId }: { phoneNumberId?: string | null }) {
  const { toast } = useToast();
  const [num, setNum] = useState<{ id: string; is_default: boolean | null } | null>(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    if (!phoneNumberId) return;
    const { data } = await supabase
      .from("whatsapp_numbers")
      .select("id, is_default")
      .eq("phone_number_id", phoneNumberId)
      .eq("is_active", true)
      .maybeSingle();
    setNum(data as any);
  }, [phoneNumberId]);

  useEffect(() => { carregar(); }, [carregar]);
  if (!num) return null;

  const alternar = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setSalvando(true);
    const novo = !num.is_default;
    if (novo) await supabase.from("whatsapp_numbers").update({ is_default: false }).neq("id", num.id);
    const { error } = await supabase.from("whatsapp_numbers").update({ is_default: novo }).eq("id", num.id);
    setSalvando(false);
    if (error) {
      toast({ title: "Não foi possível alterar o número padrão", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: novo ? "Número padrão de envio definido" : "Número padrão removido — envios voltam ao número principal" });
    setNum({ ...num, is_default: novo });
    window.dispatchEvent(new Event("whatsapp-padrao-alterado"));
  };

  return (
    <button
      type="button"
      onClick={alternar}
      disabled={salvando}
      className={`mt-2 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
        num.is_default ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"
      }`}
    >
      <span className={`h-2 w-2 rounded-full ${num.is_default ? "bg-primary" : "bg-muted-foreground/40"}`} />
      {num.is_default ? "Número padrão de envio" : "Usar como padrão de envio"}
    </button>
  );
}

/**
 * Versão em linha (para dentro da configuração do WhatsApp):
 * interruptor "Número padrão de envio" com explicação.
 */
export function PadraoEnvioSwitch({ phoneNumberId }: { phoneNumberId?: string | null }) {
  const { toast } = useToast();
  const [num, setNum] = useState<{ id: string; is_default: boolean | null } | null>(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    if (!phoneNumberId) return;
    const { data } = await supabase
      .from("whatsapp_numbers")
      .select("id, is_default")
      .eq("phone_number_id", phoneNumberId)
      .eq("is_active", true)
      .maybeSingle();
    setNum(data as any);
  }, [phoneNumberId]);

  useEffect(() => {
    carregar();
    const onChange = () => carregar();
    window.addEventListener("whatsapp-padrao-alterado", onChange);
    return () => window.removeEventListener("whatsapp-padrao-alterado", onChange);
  }, [carregar]);
  if (!num) return null;

  const alternar = async () => {
    setSalvando(true);
    const novo = !num.is_default;
    if (novo) await supabase.from("whatsapp_numbers").update({ is_default: false }).neq("id", num.id);
    const { error } = await supabase.from("whatsapp_numbers").update({ is_default: novo }).eq("id", num.id);
    setSalvando(false);
    if (error) {
      toast({ title: "Não foi possível alterar o número padrão", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: novo ? "Número padrão de envio definido" : "Número padrão removido — envios voltam ao número principal" });
    setNum({ ...num, is_default: novo });
    window.dispatchEvent(new Event("whatsapp-padrao-alterado"));
  };

  return (
    <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${num.is_default ? "border-primary/40 bg-primary/5" : "border-border"}`}>
      <input
        type="checkbox"
        checked={!!num.is_default}
        onChange={alternar}
        disabled={salvando}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-primary disabled:opacity-50"
      />
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">Número padrão de envio</p>
        <p className="text-[11px] text-muted-foreground">
          Automações, bots, follow-up e leads sem número escolhido saem por este número. Marcar aqui desmarca os outros números.
        </p>
      </div>
    </label>
  );
}

/**
 * Seletor do número padrão de envio: lista todos os números ativos do grupo
 * e permite escolher por qual saem automações, bots, follow-up e leads sem
 * número escolhido.
 */
export function PadraoEnvioSelect() {
  const { toast } = useToast();
  const [numeros, setNumeros] = useState<{ id: string; display_name: string | null; phone_number_id: string; is_default: boolean | null }[]>([]);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    const { data } = await supabase
      .from("whatsapp_numbers")
      .select("id, display_name, phone_number_id, is_default")
      .eq("is_active", true)
      .order("display_name");
    setNumeros((data as any) ?? []);
  }, []);

  useEffect(() => {
    carregar();
    const onChange = () => carregar();
    window.addEventListener("whatsapp-padrao-alterado", onChange);
    return () => window.removeEventListener("whatsapp-padrao-alterado", onChange);
  }, [carregar]);

  if (numeros.length === 0) return null;
  const atual = numeros.find((n) => n.is_default);

  const escolher = async (id: string) => {
    if (!id || id === atual?.id) return;
    setSalvando(true);
    await supabase.from("whatsapp_numbers").update({ is_default: false }).neq("id", id);
    const { error } = await supabase.from("whatsapp_numbers").update({ is_default: true }).eq("id", id);
    setSalvando(false);
    if (error) {
      toast({ title: "Não foi possível alterar o número padrão", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Número padrão de envio definido" });
    await carregar();
    window.dispatchEvent(new Event("whatsapp-padrao-alterado"));
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">Número padrão de envio</p>
        <p className="text-[11px] text-muted-foreground">
          Automações, bots, follow-up e leads sem número escolhido saem por este número.
        </p>
      </div>
      <select
        value={atual?.id ?? ""}
        onChange={(e) => escolher(e.target.value)}
        disabled={salvando}
        className="h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground disabled:opacity-50"
      >
        {!atual && <option value="">Escolha o número…</option>}
        {numeros.map((n) => (
          <option key={n.id} value={n.id}>
            {n.display_name || n.phone_number_id}
          </option>
        ))}
      </select>
    </div>
  );
}
