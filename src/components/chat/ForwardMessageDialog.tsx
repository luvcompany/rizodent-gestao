import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Search, Send } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messageContent: string | null;
  messageType: string;
  fromLeadId: string;
};

type Lead = {
  id: string;
  name: string;
  phone: string | null;
};

export default function ForwardMessageDialog({ open, onOpenChange, messageContent, messageType, fromLeadId }: Props) {
  const [search, setSearch] = useState("");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [sending, setSending] = useState<string | null>(null);

  // Cada número é um mundo: só é possível encaminhar para leads do MESMO
  // tenant e da MESMA conexão (whatsapp_number_id) do lead de origem.
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
      q = numberId ? q.eq("whatsapp_number_id", numberId) : q.is("whatsapp_number_id", null);

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
    if (!lead.phone) {
      toast.error("Lead sem telefone");
      return;
    }
    setSending(lead.id);
    try {
      const { error } = await supabase.functions.invoke("send-whatsapp-message", {
        body: {
          lead_id: lead.id,
          to: lead.phone,
          message: messageContent || "",
          type: messageType === "text" ? "text" : messageType,
        },
      });
      if (error) {
        toast.error("Erro ao encaminhar");
      } else {
        toast.success(`Mensagem encaminhada para ${lead.name}`);
        onOpenChange(false);
      }
    } finally {
      setSending(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Encaminhar mensagem</DialogTitle>
        </DialogHeader>
        <div className="relative mb-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar lead..."
            className="pl-9"
          />
        </div>
        <div className="max-h-64 overflow-y-auto space-y-1">
          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">Nenhum lead encontrado</p>
          )}
          {filtered.map((lead) => (
            <button
              key={lead.id}
              onClick={() => handleForward(lead)}
              disabled={sending === lead.id}
              className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-secondary transition-colors text-left"
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
