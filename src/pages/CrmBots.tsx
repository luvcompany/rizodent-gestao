import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Search, Bot, MoreHorizontal, Pencil, Copy, Archive, Trash2, Users } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Bot as BotType, BotStatus } from "@/types/bot";
import ShareRoleDialog, { OwnerRoleBadge, type OwnerRole } from "@/components/crm/ShareRoleDialog";
import { useAuth } from "@/contexts/AuthContext";

export default function CrmBots() {
  const navigate = useNavigate();
  const { userRole } = useAuth();
  const canShare = userRole === "admin" || userRole === "gerente" || userRole === "superadmin";
  const [bots, setBots] = useState<BotType[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [shareTarget, setShareTarget] = useState<BotType | null>(null);

  const fetchBots = async () => {
    const { data, error } = await supabase
      .from("bots")
      .select("*")
      .order("updated_at", { ascending: false });
    if (!error && data) setBots(data as any);
    setLoading(false);
  };

  useEffect(() => { fetchBots(); }, []);

  const handleCreate = async () => {
    const { data, error } = await supabase.from("bots").insert({
      name: "Novo Bot",
      status: "draft",
      flow_json: {
        nodes: [{ id: "start-1", type: "start", position: { x: 400, y: 50 }, data: {} }],
        edges: [],
      },
    }).select().single();
    if (error) { toast.error("Erro ao criar bot"); return; }
    navigate(`/crm/bots/${data.id}`);
  };

  const handleDuplicate = async (bot: BotType) => {
    const { error } = await supabase.from("bots").insert({
      name: `${bot.name} (cópia)`,
      description: bot.description,
      status: "draft",
      flow_json: bot.flow_json,
    });
    if (error) { toast.error("Erro ao duplicar"); return; }
    toast.success("Bot duplicado");
    fetchBots();
  };

  const handleArchive = async (id: string) => {
    await supabase.from("bots").update({ status: "archived" }).eq("id", id);
    toast.success("Bot arquivado");
    fetchBots();
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    await supabase.from("bots").delete().eq("id", deleteId);
    setDeleteId(null);
    toast.success("Bot excluído");
    fetchBots();
  };

  const filtered = bots.filter((b) =>
    b.name.toLowerCase().includes(search.toLowerCase()) && b.status !== "archived"
  );

  const statusBadge = (s: BotStatus) => {
    const map = {
      draft: { label: "Rascunho", variant: "secondary" as const },
      published: { label: "Publicado", variant: "default" as const },
      archived: { label: "Arquivado", variant: "outline" as const },
    };
    const { label, variant } = map[s] || map.draft;
    return <Badge variant={variant}>{label}</Badge>;
  };

  return (
    <div className="space-y-6 -m-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Construtor de Bots</h1>
          <p className="text-sm text-muted-foreground">Crie fluxos de automação de conversas</p>
        </div>
        <Button onClick={handleCreate} className="gap-2">
          <Plus size={16} /> Novo Bot
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar bots..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {loading ? (
        <div className="text-muted-foreground text-center py-12">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <Bot size={48} className="mx-auto text-muted-foreground/40 mb-4" />
          <p className="text-muted-foreground">Nenhum bot encontrado</p>
          <Button variant="outline" onClick={handleCreate} className="mt-4 gap-2">
            <Plus size={16} /> Criar primeiro bot
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((bot) => (
            <div
              key={bot.id}
              className="group border border-border rounded-xl bg-card p-5 hover:border-primary/30 transition-colors cursor-pointer"
              onClick={() => navigate(`/crm/bots/${bot.id}`)}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Bot size={20} className="text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">{bot.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      {bot.description || "Sem descrição"}
                    </p>
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100">
                      <MoreHorizontal size={16} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenuItem onClick={() => navigate(`/crm/bots/${bot.id}`)}>
                      <Pencil size={14} className="mr-2" /> Editar
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleDuplicate(bot)}>
                      <Copy size={14} className="mr-2" /> Duplicar
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleArchive(bot.id)}>
                      <Archive size={14} className="mr-2" /> Arquivar
                    </DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive" onClick={() => setDeleteId(bot.id)}>
                      <Trash2 size={14} className="mr-2" /> Excluir
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="flex items-center justify-between">
                {statusBadge(bot.status)}
                <span className="text-xs text-muted-foreground">
                  {new Date(bot.updated_at).toLocaleDateString("pt-BR")}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir bot?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. O bot e todas as suas execuções serão removidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
