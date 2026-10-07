import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, RefreshCw } from "lucide-react";
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

  const tone = s.health_status === "error" ? "destructive" : s.health_status === "warning" ? "warning" : s.health_status === "ok" ? "success" : "slate";
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

/** Faixa no topo do CRM quando algum número do grupo do usuário está com problema. */
export function AvisoWhatsappDesconectado() {
  const { itens } = useSaudeWhatsapp();
  const navigate = useNavigate();
  const comProblema = itens.filter((i) => i.health_status === "error");
  if (comProblema.length === 0) return null;
  return (
    <button
      type="button"
      onClick={() => navigate("../integracoes", { relative: "path" })}
      className="mb-3 flex w-full items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-left text-sm text-destructive"
    >
      <AlertTriangle size={16} className="shrink-0" />
      <span className="min-w-0 flex-1">
        {comProblema.map((i) => (
          <span key={i.key} className="block truncate">
            <strong>{i.config?.display_name || "WhatsApp"}</strong>: {i.health_reason || "desconectado da Meta"} — automações pausadas
          </span>
        ))}
      </span>
    </button>
  );
}
