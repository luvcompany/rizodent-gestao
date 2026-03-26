import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Search, MessageSquare, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

type LeadConversation = {
  id: string;
  name: string;
  phone: string | null;
  last_message: string | null;
  last_message_at: string | null;
  tags: string[] | null;
  source: string | null;
};

export default function CrmConversas() {
  const navigate = useNavigate();
  const [leads, setLeads] = useState<LeadConversation[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLeads = async () => {
      const { data } = await supabase
        .from("crm_leads")
        .select("id, name, phone, last_message, last_message_at, tags, source")
        .not("last_message_at", "is", null)
        .order("last_message_at", { ascending: false });
      setLeads((data as LeadConversation[]) || []);
      setLoading(false);
    };
    fetchLeads();
  }, []);

  const filtered = leads.filter((l) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return l.name.toLowerCase().includes(s) || l.phone?.includes(s) || l.last_message?.toLowerCase().includes(s);
  });

  return (
    <div className="flex flex-col overflow-hidden bg-background -m-6" style={{ height: "calc(100vh - 4rem)" }}>
      <div className="flex-shrink-0 bg-card border-b border-border px-6 py-4">
        <h1 className="text-lg font-bold text-foreground">Conversas</h1>
        <p className="text-sm text-muted-foreground">Todas as conversas com leads</p>
      </div>

      <div className="flex-shrink-0 px-6 py-3 border-b border-border">
        <div className="relative max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, telefone ou mensagem..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground">Carregando...</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
            <MessageSquare size={32} className="opacity-50" />
            <p>Nenhuma conversa encontrada</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((lead) => {
              const initials = lead.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
              return (
                <button
                  key={lead.id}
                  onClick={() => navigate(`/crm/conversa/${lead.id}`)}
                  className="w-full flex items-center gap-4 px-6 py-4 hover:bg-card/50 transition-colors text-left"
                >
                  <Avatar className="h-10 w-10 flex-shrink-0">
                    <AvatarFallback className="bg-primary/20 text-primary text-xs font-bold">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground truncate">{lead.name}</span>
                      {lead.source && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          {lead.source}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground truncate">
                      {lead.last_message || "Sem mensagens"}
                    </p>
                  </div>
                  {lead.last_message_at && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground flex-shrink-0">
                      <Clock size={12} />
                      {formatDistanceToNow(new Date(lead.last_message_at), { addSuffix: true, locale: ptBR })}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
