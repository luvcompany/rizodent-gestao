import { Phone, PhoneOff, Minus, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { nomeDoNumero, type NumeroWhatsappVisivel, type WhatsappCallRow } from "@/contexts/WhatsappCallContext";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  call: WhatsappCallRow;
  /** Números visíveis ao usuário (undefined enquanto carrega). */
  numerosVisiveis?: NumeroWhatsappVisivel[];
  onAccept: () => void;
  onReject: () => void;
  onMinimize?: () => void;
  onInteract?: () => void;
}

function formatPhone(p: string | null): string {
  if (!p) return "Desconhecido";
  const d = p.replace(/\D/g, "");
  // 55 + DDD + número
  if (d.length >= 12) return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`;
  return `+${d}`;
}

export const IncomingWhatsappCallModal: React.FC<Props> = ({ call, numerosVisiveis, onAccept, onReject, onMinimize, onInteract }) => {
  const navigate = useNavigate();
  const [leadName, setLeadName] = useState<string | null>(null);
  const [resolvedLeadId, setResolvedLeadId] = useState<string | null>(null);

  // Número que recebeu a ligação, pela lista de números visíveis ao usuário:
  // primeiro pelo whatsapp_number_id gravado pelo servidor, depois pelo
  // phone_number_id. undefined = lista ainda carregando; null = o número não
  // está entre os deste usuário (não existe mais "número principal" fora da
  // lista no v2).
  const numero = useMemo<NumeroWhatsappVisivel | null | undefined>(() => {
    if (!numerosVisiveis) return undefined;
    const porId = call.whatsapp_number_id
      ? numerosVisiveis.find((n) => n.id === call.whatsapp_number_id)
      : undefined;
    if (porId) return porId;
    const porPnid = call.phone_number_id
      ? numerosVisiveis.find((n) => n.phone_number_id === String(call.phone_number_id))
      : undefined;
    return porPnid ?? null;
  }, [numerosVisiveis, call.whatsapp_number_id, call.phone_number_id]);
  const numeroId = numero?.id ?? null;
  const indisponivel = numero === null;
  const mostrarNumero = !!numero && (numerosVisiveis?.length ?? 0) > 1;

  useEffect(() => {
    let cancelled = false;
    setLeadName(null);
    setResolvedLeadId(null);
    // Sem o número resolvido não se procura lead: buscar fora do número
    // misturaria conversas de outro "mundo".
    if (!numeroId) return;
    (async () => {
      // 1) Se o call já vier com lead_id, busca direto (a RLS confere o acesso).
      if (call.lead_id) {
        const { data } = await supabase
          .from("crm_leads")
          .select("id, name")
          .eq("id", call.lead_id)
          .maybeSingle();
        if (cancelled) return;
        setLeadName((data as any)?.name ?? null);
        setResolvedLeadId((data as any)?.id ?? call.lead_id);
        return;
      }
      // 2) Fallback: casa pelo telefone DENTRO do número da ligação.
      const digits = (call.from_phone || "").replace(/\D/g, "");
      if (!digits || !call.tenant_id) return;
      const { data } = await supabase
        .from("crm_leads")
        .select("id, name")
        .eq("tenant_id", call.tenant_id)
        .eq("phone", digits)
        .eq("whatsapp_number_id", numeroId)
        .limit(2);
      if (cancelled) return;
      const rows = (data as any[]) || [];
      // Ambíguo (2+): não resolve lead — mostra só o telefone.
      if (rows.length === 1) {
        setLeadName(rows[0].name ?? null);
        setResolvedLeadId(rows[0].id ?? null);
      }
    })();
    return () => { cancelled = true; };
  }, [numeroId, call.lead_id, call.from_phone, call.tenant_id]);

  const displayName = leadName || formatPhone(call.from_phone);
  const initials = (leadName || "?").split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();

  const handleOpenConversation = () => {
    if (!resolvedLeadId) return;
    onMinimize?.();
    navigate(`/crm/conversas?lead=${resolvedLeadId}`);
  };

  return (
    // Fundo com leve escurecimento mas SEM bloquear o CRM (pointer-events-none);
    // só o card recebe cliques. Assim a chamada chama atenção sem travar a tela.
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-[2px] animate-in fade-in pointer-events-none"
      onMouseDown={onInteract}
      onKeyDown={onInteract}
    >
      <div className="pointer-events-auto relative w-full max-w-sm rounded-2xl bg-card border border-border shadow-2xl p-6 flex flex-col items-center gap-5">
        {onMinimize && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onMinimize}
            aria-label="Minimizar chamada"
            title="Minimizar (silencia e recolhe no canto)"
            className="absolute right-2 top-2 h-8 w-8 text-muted-foreground"
          >
            <Minus className="h-4 w-4" />
          </Button>
        )}
        <div className="text-xs uppercase tracking-wider text-muted-foreground animate-pulse">
          Chamada WhatsApp recebida
        </div>
        <Avatar className="h-24 w-24 ring-4 ring-primary/30 animate-pulse">
          <AvatarFallback className="text-2xl bg-primary/10">{initials}</AvatarFallback>
        </Avatar>
        <div className="text-center">
          <div className="text-xl font-semibold">{displayName}</div>
          {leadName && (
            <div className="text-sm text-muted-foreground">{formatPhone(call.from_phone)}</div>
          )}
          {mostrarNumero && numero && (
            <div className="mt-1 text-xs text-muted-foreground">Recebida em {nomeDoNumero(numero)}</div>
          )}
          {indisponivel && (
            <div className="mt-1 text-xs text-warning">Número não disponível para você</div>
          )}
        </div>
        <div className="flex items-center gap-6 mt-3">
          <Button
            size="lg"
            variant="destructive"
            onClick={onReject}
            aria-label="Recusar chamada"
            title="Recusar"
            className="h-14 w-14 rounded-full p-0"
          >
            <PhoneOff className="h-6 w-6" />
          </Button>
          <Button
            size="lg"
            onClick={onAccept}
            aria-label="Atender chamada"
            title="Atender"
            className="h-14 w-14 rounded-full p-0 bg-green-600 hover:bg-green-700"
          >
            <Phone className="h-6 w-6" />
          </Button>
        </div>
        <div className="flex gap-8 text-[10px] text-muted-foreground uppercase tracking-wide">
          <span>Recusar</span>
          <span>Atender</span>
        </div>
        {resolvedLeadId && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleOpenConversation}
            className="mt-1 gap-2"
          >
            <MessageSquare className="h-4 w-4" />
            Ver conversa
          </Button>
        )}
      </div>
    </div>
  );
};
