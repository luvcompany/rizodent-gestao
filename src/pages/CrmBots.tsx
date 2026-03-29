import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Cpu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface Bot {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  created_at: string;
  stage_count?: number;
}

const CrmBots = () => {
  const navigate = useNavigate();
  const [bots, setBots] = useState<Bot[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchBots = async () => {
    setLoading(true);
    const { data: botsData } = await supabase.from("bots").select("*").order("created_at", { ascending: false });
    const { data: configs } = await supabase.from("stage_bot_config").select("bot_id");

    const countMap: Record<string, number> = {};
    configs?.forEach((c: any) => { if (c.bot_id) countMap[c.bot_id] = (countMap[c.bot_id] || 0) + 1; });

    setBots((botsData || []).map((b: any) => ({ ...b, stage_count: countMap[b.id] || 0 })));
    setLoading(false);
  };

  useEffect(() => { fetchBots(); }, []);

  const createBot = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    const { data, error } = await supabase.from("bots").insert({ name: newName.trim(), description: newDesc.trim() || null }).select().single();
    if (error) { toast.error("Erro ao criar bot"); setCreating(false); return; }
    toast.success("Bot criado!");
    setShowNew(false);
    setNewName("");
    setNewDesc("");
    setCreating(false);
    navigate(`/crm/bots/${data.id}`);
  };

  const toggleActive = async (bot: Bot) => {
    await supabase.from("bots").update({ active: !bot.active }).eq("id", bot.id);
    setBots(prev => prev.map(b => b.id === bot.id ? { ...b, active: !b.active } : b));
  };

  const deleteBot = async (id: string) => {
    if (!confirm("Excluir este bot?")) return;
    await supabase.from("bots").delete().eq("id", id);
    setBots(prev => prev.filter(b => b.id !== id));
    toast.success("Bot excluído");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Bots de Automação</h1>
          <p className="text-sm text-muted-foreground">Crie e gerencie fluxos automatizados para seus leads</p>
        </div>
        <Button onClick={() => setShowNew(true)} className="gap-2">
          <Plus size={16} /> Novo Bot
        </Button>
      </div>

      {loading ? (
        <div className="text-center text-muted-foreground py-12">Carregando...</div>
      ) : bots.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
            <Cpu size={48} className="text-muted-foreground/50" />
            <p className="text-muted-foreground">Nenhum bot criado ainda</p>
            <Button variant="outline" onClick={() => setShowNew(true)}>Criar primeiro bot</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {bots.map(bot => (
            <Card key={bot.id} className="relative">
              <CardHeader className="flex flex-row items-start justify-between pb-2">
                <div className="flex-1 min-w-0">
                  <CardTitle className="text-base truncate">{bot.name}</CardTitle>
                  {bot.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{bot.description}</p>}
                </div>
                <Switch checked={bot.active} onCheckedChange={() => toggleActive(bot)} />
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-xs text-muted-foreground mb-3">
                  Vinculado a {bot.stage_count} etapa{bot.stage_count !== 1 ? "s" : ""}
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={() => navigate(`/crm/bots/${bot.id}`)}>
                    <Pencil size={14} /> Editar
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => deleteBot(bot.id)}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent>
          <DialogHeader><DialogTitle>Novo Bot</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nome</Label>
              <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Ex: Follow-up Agendamento" />
            </div>
            <div>
              <Label>Descrição (opcional)</Label>
              <Textarea value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Descreva o objetivo deste bot" rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNew(false)}>Cancelar</Button>
            <Button onClick={createBot} disabled={creating || !newName.trim()}>Criar e Editar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CrmBots;
