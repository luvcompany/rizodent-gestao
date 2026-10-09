import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Search, Send } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { envioFalhou, motivoDoEnvio } from "@/lib/erroDoEnvio";
import { useEnvioDoLead } from "@/hooks/useEnvioDoLead";
import AvisoDeEnvio from "./AvisoDeEnvio";
import { numerosComMundo, orMesmoMundo } from "@/lib/mundoNumero";

/**
 * Encaminhar uma mensagem do chat para outro lead do mesmo número — CONV-6.
 *
 * Antes só o texto e o tipo chegavam aqui: foto, áudio, vídeo e documento
 * iam sem media_url e o servidor recusava ("Missing media_url…"); a recusa da
 * Meta (HTTP 200 com ok:false, p.ex. fora da janela de 24h) aparecia como
 * "Mensagem encaminhada"; e modelo virava o texto "📋 Template: nome" para o
 * paciente. Agora a mídia vai com a própria media_url e a legenda, qualquer
 * falha aparece com o motivo do servidor, e mensagem que não se encaminha
 * (modelo, sistema, ligação, Instagram) é recusada aqui também — o botão já
 * some em MessageActions.
 */

/** Mensagem inteira (a tela passa `mensagem`; os campos soltos ficam por compatibilidade). */
export type MensagemParaEncaminhar = {
  id: string;
  type: string;
  content: string | null;
  media_url?: string | null;
  template_snapshot?: unknown;
  channel?: string | null;
  status?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** @deprecated use `mensagem` (sem ela a mídia não é encaminhada). */
  messageContent?: string | null;
  /** @deprecated use `mensagem`. */
  messageType?: string;
  mensagem?: MensagemParaEncaminhar | null;
  fromLeadId: string;
};

const TIPOS_DE_MIDIA = new Set(["image", "video", "audio", "document", "sticker"]);
/** Tipos que a Meta não recebe como legenda (o texto iria fora). */
const MIDIA_SEM_LEGENDA = new Set(["audio", "sticker"]);

/** Por que esta mensagem não se encaminha (null = pode). */
export function motivoParaNaoEncaminhar(m: { type: string; content: string | null; template_snapshot?: unknown; channel?: string | null; status?: string | null }): string | null {
  if (m.channel === "instagram" || m.type === "comment") return "Mensagens do Instagram não podem ser encaminhadas por aqui.";
  if (m.template_snapshot || m.type === "template" || (m.content ?? "").startsWith("📋 Template:")) {
    return "Modelos não são encaminhados: envie o modelo pelo botão de modelos da outra conversa.";
  }
  if (m.type === "system" || m.status === "system") return "Mensagens do sistema não podem ser encaminhadas.";
  if (m.type === "call") return "Registros de ligação não podem ser encaminhados.";
  return null;
}

type Lead = {
  id: string;
  name: string;
  phone: string | null;
};

export default function ForwardMessageDialog({ open, onOpenChange, messageContent, messageType, mensagem, fromLeadId }: Props) {
  const [search, setSearch] = useState("");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [sending, setSending] = useState<string | null>(null);
  // Mesmo número = mesma WABA: pausa ou falta de número valem para o destino também.
  const { bloqueio, reconsultar } = useEnvioDoLead(fromLeadId || null, { ativo: open });

  const tipo = mensagem?.type ?? messageType ?? "text";
  const conteudo = mensagem?.content ?? messageContent ?? null;
  const midia = mensagem?.media_url ?? null;
  const naoEncaminha = motivoParaNaoEncaminhar({
    type: tipo,
    content: conteudo,
    template_snapshot: mensagem?.template_snapshot,
    channel: mensagem?.channel,
    status: mensagem?.status,
  });

  // Só é possível encaminhar para leads do MESMO tenant e da MESMA equipe
  // (mundo do número: central, ou o closer/recepção dono) do lead de origem.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      const { data: origem } = await supabase
        .from("crm_leads")
        .select("tenant_id, whatsapp_number_id")
        .eq("id", fromLeadId)
        .maybeSingle();
      if (cancelled) return;
      const tenantId = (origem as any)?.tenant_id ?? null;
      const numberId = (origem as any)?.whatsapp_number_id ?? null;
      if (!tenantId) { setLeads([]); return; }

      let q = supabase
        .from("crm_leads")
        .select("id, name, phone")
        .eq("tenant_id", tenantId)
        .neq("id", fromLeadId);
      // Mesmo MUNDO (equipe) do lead de origem — não o mesmo id de número.
      q = q.or(orMesmoMundo(await numerosComMundo(tenantId), numberId));
      if (cancelled) return;

      // Busca server-side (nome ou telefone) em vez de 50 primeiros alfabéticos.
      const term = search.trim();
      if (term.length >= 2) {
        const digits = term.replace(/\D/g, "");
        const parts = [`name.ilike.%${term}%`];
        if (digits.length >= 3) parts.push(`phone.ilike.%${digits}%`);
        q = q.or(parts.join(","));
      }

      const { data } = await q.order("last_message_at", { ascending: false, nullsFirst: false }).limit(50);
      if (cancelled) return;
      setLeads((data as Lead[]) || []);
    }, 300);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [open, fromLeadId, search]);

  const filtered = leads;

  const handleForward = async (lead: Lead) => {
    if (naoEncaminha) { toast.error(naoEncaminha); return; }
    if (bloqueio) { toast.error(bloqueio.texto); return; }
    if (!lead.phone) {
      toast.error("Lead sem telefone");
      return;
    }

    let body: Record<string, unknown>;
    if (TIPOS_DE_MIDIA.has(tipo)) {
      if (!midia) {
        toast.error("A mídia desta mensagem não está disponível para encaminhar.");
        return;
      }
      const legenda = MIDIA_SEM_LEGENDA.has(tipo) ? "" : (conteudo ?? "").trim();
      body = { lead_id: lead.id, type: tipo, media_url: midia, ...(legenda ? { message: legenda } : {}) };
    } else {
      const texto = (conteudo ?? "").trim();
      if (!texto) {
        toast.error("Esta mensagem não tem texto para encaminhar.");
        return;
      }
      // Botão, lista, localização… chegam como texto (é o que está no balão).
      body = { lead_id: lead.id, type: "text", message: texto };
    }

    setSending(lead.id);
    try {
      const { data, error } = await supabase.functions.invoke("send-whatsapp-message", { body });
      if (envioFalhou(data, error)) {
        const motivo = await motivoDoEnvio(data, error, "Não foi possível encaminhar a mensagem");
        // A Meta aceitou e só o histórico não gravou: foi encaminhada (repetir
        // mandaria duas vezes ao paciente).
        if (motivo.semRegistro) {
          toast.warning(`Encaminhada para ${lead.name}. ${motivo.texto}`);
          onOpenChange(false);
          return;
        }
        if (motivo.pausado) reconsultar();
        toast.error(`Não encaminhada para ${lead.name}: ${motivo.texto}`);
        return;
      }
      toast.success(`Mensagem encaminhada para ${lead.name}`);
      onOpenChange(false);
    } catch {
      toast.error("Não foi possível encaminhar a mensagem. Confira a conexão e tente de novo.");
    } finally {
      setSending(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm overflow-hidden rounded-2xl border-border/60 p-0">
        <DialogHeader className="border-b border-border/60 px-5 py-4">
          <DialogTitle>Encaminhar mensagem</DialogTitle>
        </DialogHeader>
        <div className="px-5 pt-4">
        {bloqueio && <AvisoDeEnvio bloqueio={bloqueio} />}
        {naoEncaminha && <p className="text-sm text-muted-foreground">{naoEncaminha}</p>}
        <div className="relative mb-3 mt-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar lead..."
            className="h-10 rounded-xl border-border/60 bg-surface-sunken pl-9"
          />
        </div>
        </div>
        <div className="max-h-64 space-y-1 overflow-y-auto px-3 pb-4">
          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">Nenhum lead encontrado</p>
          )}
          {filtered.map((lead) => (
            <button
              key={lead.id}
              onClick={() => handleForward(lead)}
              disabled={!!sending || !!bloqueio || !!naoEncaminha}
              className="flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary/20 text-primary text-xs">
                  {lead.name.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground truncate">{lead.name}</div>
                {lead.phone && <div className="text-xs text-muted-foreground">{lead.phone}</div>}
              </div>
              <Send size={14} className="text-muted-foreground" />
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
