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

  useEffect(() => {
    if (!open) return;
    const fetchLeads = async () => {
      const { data } = await supabase
        .from("crm_leads")
        .select("id, name, phone")
        .neq("id", fromLeadId)
        .order("name")
        .limit(50);
      setLeads((data as Lead[]) || []);
    };
    fetchLeads();
  }, [open, fromLeadId]);

  const filtered = search
    ? leads.filter((l) => l.name.toLowerCase().includes(search.toLowerCase()) || l.phone?.includes(search))
    : leads;

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
