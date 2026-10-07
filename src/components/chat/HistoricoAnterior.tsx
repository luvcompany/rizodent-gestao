import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, History } from "lucide-react";

type Msg = { id: string; content: string | null; direction: string; created_at: string; sent_by_name?: string | null; message_type?: string | null };

/** Conta as mensagens de leads mesclados (histórico anterior) deste lead. */
export function useHistoricoAnterior(leadId: string | null) {
  const [qtd, setQtd] = useState(0);
  useEffect(() => {
    setQtd(0);
    if (!leadId) return;
    let vivo = true;
    supabase.from("messages").select("id", { count: "exact", head: true })
      .eq("lead_id", leadId).not("historico_de_lead_id" as any, "is", null)
      .then(({ count }) => { if (vivo) setQtd(count ?? 0); });
    return () => { vivo = false; };
  }, [leadId]);
  return qtd;
}

export function AbasHistorico({ aba, onChange }: { aba: "conversa" | "historico"; onChange: (a: "conversa" | "historico") => void }) {
  const base = "h-8 px-3 rounded-full text-[13px] font-medium transition-colors";
  return (
    <div className="mx-2 sm:mx-3 mt-2 inline-flex self-start gap-1 rounded-full bg-surface-sunken p-1">
      <button type="button" className={`${base} ${aba === "conversa" ? "bg-card shadow-xs text-foreground" : "text-muted-foreground"}`} onClick={() => onChange("conversa")}>Conversa</button>
      <button type="button" className={`${base} inline-flex items-center gap-1.5 ${aba === "historico" ? "bg-card shadow-xs text-foreground" : "text-muted-foreground"}`} onClick={() => onChange("historico")}>
        <History size={14} /> Histórico anterior
      </button>
    </div>
  );
}

/** Mensagens trocadas antes com outro usuário (SDR, CRC…), só leitura. */
export function ListaHistoricoAnterior({ leadId }: { leadId: string }) {
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  useEffect(() => {
    let vivo = true;
    setMsgs(null);
    supabase.from("messages").select("*").eq("lead_id", leadId)
      .not("historico_de_lead_id" as any, "is", null)
      .order("created_at", { ascending: true }).limit(2000)
      .then(({ data }) => { if (vivo) setMsgs((data as unknown as Msg[]) ?? []); });
    return () => { vivo = false; };
  }, [leadId]);

  return (
    <div className="flex-1 overflow-y-auto m-2 sm:m-3 rounded-2xl bg-surface-sunken dark:bg-background px-3 py-4 sm:p-5 space-y-3">
      <p className="text-center text-xs text-muted-foreground">Conversa anterior com outro atendente. Só leitura.</p>
      {msgs === null ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      ) : msgs.map((m) => {
        const saida = m.direction === "outbound";
        return (
          <div key={m.id} className={`flex ${saida ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${saida ? "bg-primary-soft text-primary-soft-fg" : "bg-card text-foreground border border-border/60"}`}>
              {m.content || (m.message_type ? `[${m.message_type}]` : "")}
              <div className="mt-1 text-[11px] text-muted-foreground">
                {saida && m.sent_by_name ? `${m.sent_by_name} · ` : ""}
                {new Date(m.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
