import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Brain, Database, Loader2, ThumbsUp, ThumbsDown, Pencil } from "lucide-react";

type Row = {
  id: string;
  lead_id: string;
  suggested_text: string;
  final_text: string | null;
  was_edited: boolean;
  status: string;
  created_at: string;
};

type LearningStats = {
  total: number;
  embedded: number;
  pending: number;
  corrections: number;
};

export default function AiLearningReport() {
  const [rows, setRows] = useState<Row[]>([]);
  const [stats, setStats] = useState<LearningStats>({ total: 0, embedded: 0, pending: 0, corrections: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [{ data }, { count: total }, { count: embedded }, { count: corrections }] = await Promise.all([
        supabase
        .from("ai_reply_suggestions" as any)
        .select("id, lead_id, suggested_text, final_text, was_edited, status, created_at")
        .in("status", ["sent", "discarded"])
        .order("created_at", { ascending: false })
          .limit(200),
        supabase.from("ai_good_examples" as any).select("id", { count: "exact", head: true }),
        supabase.from("ai_good_examples" as any).select("id", { count: "exact", head: true }).not("embedding", "is", null),
        supabase.from("ai_good_examples" as any).select("id", { count: "exact", head: true }).not("rejected_reply", "is", null),
      ]);
      setRows((data as any) || []);
      setStats({
        total: total || 0,
        embedded: embedded || 0,
        pending: Math.max((total || 0) - (embedded || 0), 0),
        corrections: corrections || 0,
      });
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 size={14} className="animate-spin" />Carregando...</div>;

  const discarded = rows.filter((r) => r.status === "discarded" && !r.was_edited);
  const edited = rows.filter((r) => r.was_edited);
  const approved = rows.filter((r) => r.status === "sent" && !r.was_edited);

  const Block = ({ title, items, color, icon }: { title: string; items: Row[]; color: string; icon: any }) => (
    <Card>
      <CardHeader>
        <CardTitle className={`text-base flex items-center gap-2 ${color}`}>{icon}{title} ({items.length})</CardTitle>
        <CardDescription>Últimas 200 sugestões.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 max-h-[420px] overflow-y-auto">
        {items.length === 0 && <p className="text-xs text-muted-foreground">Nada por aqui ainda.</p>}
        {items.map((r) => (
          <div key={r.id} className="p-2 rounded border border-border bg-secondary/30 text-xs space-y-1">
            <div className="flex items-center justify-between">
              <Badge variant="outline" className="text-[10px]">{new Date(r.created_at).toLocaleString("pt-BR")}</Badge>
              {r.was_edited && <Badge variant="secondary" className="text-[10px]">editada</Badge>}
            </div>
            <div><span className="text-muted-foreground">Sugerida:</span> {r.suggested_text}</div>
            {r.final_text && r.final_text !== r.suggested_text && (
              <div><span className="text-muted-foreground">Enviada:</span> {r.final_text}</div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-4 gap-3">
        <Card><CardContent className="p-3 flex items-center gap-3"><Brain size={18} className="text-primary" /><div><p className="text-xs text-muted-foreground">Exemplos salvos</p><p className="font-semibold">{stats.total}</p></div></CardContent></Card>
        <Card><CardContent className="p-3 flex items-center gap-3"><Database size={18} className="text-emerald-600" /><div><p className="text-xs text-muted-foreground">Prontos para busca</p><p className="font-semibold">{stats.embedded}</p></div></CardContent></Card>
        <Card><CardContent className="p-3 flex items-center gap-3"><Loader2 size={18} className="text-amber-600" /><div><p className="text-xs text-muted-foreground">Sem vetor</p><p className="font-semibold">{stats.pending}</p></div></CardContent></Card>
        <Card><CardContent className="p-3 flex items-center gap-3"><Pencil size={18} className="text-amber-600" /><div><p className="text-xs text-muted-foreground">Correções aprendidas</p><p className="font-semibold">{stats.corrections}</p></div></CardContent></Card>
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <Block title="Aprovadas sem edição" items={approved} color="text-emerald-600" icon={<ThumbsUp size={16} />} />
        <Block title="Corrigidas pela equipe" items={edited} color="text-amber-600" icon={<Pencil size={16} />} />
        <Block title="Descartadas" items={discarded} color="text-destructive" icon={<ThumbsDown size={16} />} />
      </div>
    </div>
  );
}
