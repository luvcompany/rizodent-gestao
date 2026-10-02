import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Plus, Trash2, Pencil, Check, X, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

type Rule = {
  id: string;
  kind: "diretriz" | "restricao";
  text: string;
  active: boolean;
};

/** Nome configurado da assistente (ai_assistant_config.assistant_display_name), passado pela tela de IA. */
export default function AiRulesManager({ nomeAssistente }: { nomeAssistente?: string } = {}) {
  const nome = nomeAssistente?.trim() || "Assistente";
  const { userRole } = useAuth();
  // Excluir orientação é restrito no banco: a regra nega o pós-venda sem
  // devolver erro, então o botão nem aparece para ele.
  // Espelha a permissão real do banco (delete_rules: crc/gerente/superadmin).
  // A lista era por negação ("todo mundo menos pós-venda") e oferecia o botão
  // a closer/recepção, para quem a exclusão sempre voltava vazia.
  const canDelete = ["crc", "gerente", "superadmin"].includes(userRole ?? "");
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
    const { data, error } = await supabase.from("ai_assistant_rules" as any).delete().eq("id", id).select("id");
    if (error) toast.error(error.message);
    else if (!data || data.length === 0) toast.error("Seu perfil não tem permissão para remover orientações.");
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
    return <div className="flex items-center justify-center gap-2 rounded-card border border-border/60 bg-card py-12 text-sm text-muted-foreground shadow-card"><Loader2 size={16} className="animate-spin text-primary" />Carregando...</div>;
  }

  const Section = ({
    title, color, items, value, setValue, kind,
  }: { title: string; color: string; items: Rule[]; value: string; setValue: (v: string) => void; kind: "diretriz" | "restricao" }) => (
    <Card className="rounded-card border-border/60 shadow-card">
      <CardHeader className="space-y-1.5 p-5 pb-4 sm:p-6 sm:pb-5">
        <CardTitle className="flex items-center gap-3 text-base font-semibold text-foreground"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${color}`}><ShieldCheck size={18} strokeWidth={1.75} /></span>{title}</CardTitle>
        <CardDescription className="text-[13px] leading-relaxed sm:pl-12">
          {kind === "diretriz"
            ? `O que ${nome} SEMPRE deve fazer. Entra no prompt antes da base de conhecimento.`
            : `O que ${nome} NUNCA pode fazer. Tem prioridade máxima sobre qualquer outra regra.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-5 pb-5 sm:px-6 sm:pb-6">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={kind === "diretriz" ? "Ex: Sempre comece com o primeiro nome do cliente" : "Ex: Nunca diga que é uma IA"}
            onKeyDown={(e) => { if (e.key === "Enter") add(kind, value, () => setValue("")); }}
            className="h-10 min-w-0 flex-1 rounded-xl"
          />
          <Button onClick={() => add(kind, value, () => setValue(""))} size="sm" className="h-10 shrink-0 gap-1.5 rounded-xl px-4">
            <Plus size={16} />Adicionar
          </Button>
        </div>
        <div className="space-y-2">
          {items.length === 0 && <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">Nenhuma {kind} cadastrada.</p>}
          {items.map((r) => (
            <div key={r.id} className={`flex min-h-12 items-center gap-3 rounded-xl border px-3.5 py-2 ${r.active ? "border-border/60 bg-card" : "border-transparent bg-surface-sunken opacity-70"}`}>
              <Switch checked={r.active} onCheckedChange={(v) => toggle(r.id, v)} />
              {editingId === r.id ? (
                <>
                  <Input value={editingText} onChange={(e) => setEditingText(e.target.value)} className="h-9 min-w-0 flex-1 rounded-lg" autoFocus />
                  <Button size="sm" variant="ghost" className="h-8 w-8 shrink-0 rounded-lg p-0 text-success hover:bg-success-soft hover:text-success" onClick={() => saveEdit(r.id)}><Check size={16} /></Button>
                  <Button size="sm" variant="ghost" className="h-8 w-8 shrink-0 rounded-lg p-0" onClick={() => setEditingId(null)}><X size={16} /></Button>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 break-words text-sm leading-snug text-foreground">{r.text}</span>
                  <Button size="sm" variant="ghost" className="h-8 w-8 shrink-0 rounded-lg p-0 text-muted-foreground hover:text-foreground" onClick={() => { setEditingId(r.id); setEditingText(r.text); }}>
                    <Pencil size={15} />
                  </Button>
                  {canDelete && (
                    <Button size="sm" variant="ghost" className="h-8 w-8 shrink-0 rounded-lg p-0 text-destructive hover:bg-destructive-soft hover:text-destructive" onClick={() => remove(r.id)}>
                      <Trash2 size={15} />
                    </Button>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-5">
      <Section title="Diretrizes (sempre faça)" color="bg-success-soft text-success" items={dirs} value={newDir} setValue={setNewDir} kind="diretriz" />
      <Section title="Restrições (nunca faça)" color="bg-destructive-soft text-destructive" items={rests} value={newRest} setValue={setNewRest} kind="restricao" />
      <p className="text-xs text-tertiary">As alterações valem para a próxima sugestão gerada por {nome}.</p>
    </div>
  );
}
