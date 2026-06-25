import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Plus, Trash2, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";

type Rule = {
  id: string;
  kind: "diretriz" | "restricao";
  text: string;
  active: boolean;
};

export default function AiRulesManager() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [newDir, setNewDir] = useState("");
  const [newRest, setNewRest] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("ai_assistant_rules" as any)
      .select("*")
      .order("created_at", { ascending: true });
    if (error) toast.error("Erro ao carregar orientações");
    else setRules((data as any) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const add = async (kind: "diretriz" | "restricao", text: string, reset: () => void) => {
    const t = text.trim();
    if (!t) return;
    const { error } = await supabase.from("ai_assistant_rules" as any).insert({ kind, text: t, active: true });
    if (error) toast.error("Erro ao adicionar: " + error.message);
    else { reset(); load(); toast.success("Adicionada"); }
  };

  const toggle = async (id: string, active: boolean) => {
    const { error } = await supabase.from("ai_assistant_rules" as any).update({ active }).eq("id", id);
    if (error) toast.error(error.message);
    else load();
  };

  const remove = async (id: string) => {
    if (!confirm("Remover esta orientação?")) return;
    const { error } = await supabase.from("ai_assistant_rules" as any).delete().eq("id", id);
    if (error) toast.error(error.message);
    else load();
  };

  const saveEdit = async (id: string) => {
    const t = editingText.trim();
    if (!t) return;
    const { error } = await supabase.from("ai_assistant_rules" as any).update({ text: t }).eq("id", id);
    if (error) toast.error(error.message);
    else { setEditingId(null); load(); }
  };

  const dirs = rules.filter((r) => r.kind === "diretriz");
  const rests = rules.filter((r) => r.kind === "restricao");

  if (loading) {
    return <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 size={14} className="animate-spin" />Carregando...</div>;
  }

  const Section = ({
    title, color, items, value, setValue, kind,
  }: { title: string; color: string; items: Rule[]; value: string; setValue: (v: string) => void; kind: "diretriz" | "restricao" }) => (
    <Card>
      <CardHeader>
        <CardTitle className={`text-base ${color}`}>{title}</CardTitle>
        <CardDescription>
          {kind === "diretriz"
            ? "Coisas que a Bia SEMPRE deve fazer. Injetadas no prompt antes da base de conhecimento."
            : "Coisas que a Bia NUNCA pode fazer. Têm prioridade máxima sobre qualquer outra regra."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={kind === "diretriz" ? "Ex: Sempre comece com o primeiro nome do cliente" : "Ex: Nunca diga que é uma IA"}
            onKeyDown={(e) => { if (e.key === "Enter") add(kind, value, () => setValue("")); }}
          />
          <Button onClick={() => add(kind, value, () => setValue(""))} size="sm" className="gap-1">
            <Plus size={14} />Adicionar
          </Button>
        </div>
        <div className="space-y-2">
          {items.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma {kind} cadastrada.</p>}
          {items.map((r) => (
            <div key={r.id} className={`flex items-center gap-2 p-2 rounded-lg border ${r.active ? "bg-secondary/30" : "bg-muted/30 opacity-60"}`}>
              <Switch checked={r.active} onCheckedChange={(v) => toggle(r.id, v)} />
              {editingId === r.id ? (
                <>
                  <Input value={editingText} onChange={(e) => setEditingText(e.target.value)} className="flex-1 h-8" autoFocus />
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => saveEdit(r.id)}><Check size={14} /></Button>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditingId(null)}><X size={14} /></Button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm">{r.text}</span>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setEditingId(r.id); setEditingText(r.text); }}>
                    <Pencil size={14} />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => remove(r.id)}>
                    <Trash2 size={14} />
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      <Section title="Diretrizes (sempre faça)" color="text-primary" items={dirs} value={newDir} setValue={setNewDir} kind="diretriz" />
      <Section title="Restrições (nunca faça)" color="text-destructive" items={rests} value={newRest} setValue={setNewRest} kind="restricao" />
      <p className="text-[11px] text-muted-foreground">As alterações valem para a próxima sugestão gerada pela Bia.</p>
    </div>
  );
}
