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
import { Plus, Search, Bot, MoreHorizontal, Pencil, Copy, Archive, Trash2, Users, Eye } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Bot as BotType, BotStatus } from "@/types/bot";
import ShareRoleDialog, { OwnerRoleBadge, type OwnerRole } from "@/components/crm/ShareRoleDialog";
import { useAuth } from "@/contexts/AuthContext";

export default function CrmBots() {
  const navigate = useNavigate();
  const { userRole } = useAuth();
  const canShare = userRole === "crc" || userRole === "gerente" || userRole === "superadmin";
  // A SDR vive no mundo do crc: vê os bots dele, mas não escreve (policies
  // sdr_sem_insert/update/delete em `bots`). Sem esconder, todo botão de
  // escrita seria um clique que só devolve erro de permissão.
  const canWriteBots = userRole !== "sdr";
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
    if (error) { toast.error("Erro ao criar bot: " + error.message); return; }
    navigate(`/crm/bots/${data.id}`);
  };

  const handleDuplicate = async (bot: BotType) => {
    const { error } = await supabase.from("bots").insert({
      name: `${bot.name} (cópia)`,
      description: bot.description,
      status: "draft",
      flow_json: bot.flow_json,
    });
    if (error) { toast.error("Erro ao duplicar bot: " + error.message); return; }
    toast.success("Bot duplicado");
    fetchBots();
  };

  const handleArchive = async (id: string) => {
    // Bot de outro papel: a RLS devolve sucesso com 0 linhas — o .select() torna isso visível.
    const { data, error } = await supabase.from("bots").update({ status: "archived" }).eq("id", id).select("id");
    if (error) { toast.error("Erro ao arquivar bot: " + error.message); return; }
    if (!data || data.length === 0) { toast.error("Seu perfil não tem permissão para arquivar este bot."); return; }
    toast.success("Bot arquivado");
    fetchBots();
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const { data, error } = await supabase.from("bots").delete().eq("id", deleteId).select("id");
    if (error) { toast.error("Erro ao excluir bot: " + error.message); return; }
    if (!data || data.length === 0) { toast.error("Seu perfil não tem permissão para excluir este bot."); return; }
    setDeleteId(null);
    toast.success("Bot excluído");
    fetchBots();
  };

  const filtered = bots.filter((b) =>
    b.name.toLowerCase().includes(search.toLowerCase()) && b.status !== "archived"
  );

  const statusBadge = (s: BotStatus) => {
    const map = {
      draft: { label: "Rascunho", className: "border-warning/30 bg-warning-soft text-warning-soft-foreground" },
      published: { label: "Publicado", className: "border-success/30 bg-success-soft text-success-soft-foreground" },
      archived: { label: "Arquivado", className: "border-purple/30 bg-purple-soft text-purple-soft-foreground" },
    };
    const { label, className } = map[s] || map.draft;
    return <Badge variant="outline" className={`rounded-full px-2.5 py-1 ${className}`}>{label}</Badge>;
  };

  return (
    <div className="space-y-6 -m-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-control bg-primary-soft text-primary-soft-foreground"><Bot size={21} /></div>
          <div className="min-w-0">
          <h1 className="text-2xl font-bold text-foreground">Construtor de Bots</h1>
          <p className="text-sm text-muted-foreground">Crie fluxos de automação de conversas</p>
          </div>
        </div>
        {canWriteBots && (
          <Button onClick={handleCreate} className="gap-2">
            <Plus size={16} /> Novo Bot
          </Button>
        )}
      </div>

      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar bots..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-10 rounded-control bg-surface-sunken pl-9"
        />
      </div>

      {loading ? (
        <div className="text-muted-foreground text-center py-12">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <Bot size={48} className="mx-auto text-muted-foreground/40 mb-4" />
          <p className="text-muted-foreground">Nenhum bot encontrado</p>
          {canWriteBots && (
            <Button variant="outline" onClick={handleCreate} className="mt-4 gap-2">
              <Plus size={16} /> Criar primeiro bot
            </Button>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-card border border-border/60 bg-card shadow-card divide-y divide-border/60">
          {filtered.map((bot) => (
            <div
              key={bot.id}
              className="group flex cursor-pointer flex-col gap-3 p-4 transition-colors hover:bg-primary-soft/30 sm:flex-row sm:items-center sm:justify-between sm:px-5"
              onClick={() => navigate(`/crm/bots/${bot.id}`)}
            >
              <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-primary-soft">
                    <Bot size={20} className="text-primary" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="break-words font-semibold text-foreground">{bot.name}</h3>
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {bot.description || "Sem descrição"}
                    </p>
                  </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                {statusBadge(bot.status)}
                <OwnerRoleBadge ownerRole={(bot as any).owner_role as OwnerRole} />
                <span className="text-xs tabular-nums text-muted-foreground">
                  {new Date(bot.updated_at).toLocaleDateString("pt-BR")}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full opacity-70 group-hover:opacity-100">
                      <MoreHorizontal size={16} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                    {/* Para a SDR o editor é só leitura: salvar e publicar gravam
                        em `bots`, e a RESTRICTIVE sdr_sem_update_bots recusa —
                        seria de novo "botão que só devolve erro". O rótulo diz o
                        que a tela realmente faz para cada papel. */}
                    <DropdownMenuItem onClick={() => navigate(`/crm/bots/${bot.id}`)}>
                      {canWriteBots
                        ? <><Pencil size={14} className="mr-2" /> Editar</>
                        : <><Eye size={14} className="mr-2" /> Ver fluxo</>}
                    </DropdownMenuItem>
                    {canWriteBots && (
                      <>
                        <DropdownMenuItem onClick={() => handleDuplicate(bot)}>
                          <Copy size={14} className="mr-2" /> Duplicar
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleArchive(bot.id)}>
                          <Archive size={14} className="mr-2" /> Arquivar
                        </DropdownMenuItem>
                      </>
                    )}
                    {canShare && (
                      <DropdownMenuItem onClick={() => setShareTarget(bot)}>
                        <Users size={14} className="mr-2" /> Compartilhar com papel
                      </DropdownMenuItem>
                    )}
                    {canWriteBots && (
                      <DropdownMenuItem className="text-destructive" onClick={() => setDeleteId(bot.id)}>
                        <Trash2 size={14} className="mr-2" /> Excluir
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
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

      <ShareRoleDialog
        open={!!shareTarget}
        onOpenChange={(v) => !v && setShareTarget(null)}
        table="bots"
        rowId={shareTarget?.id ?? null}
        currentOwnerRole={((shareTarget as any)?.owner_role ?? null) as OwnerRole}
        currentSharedRoles={(((shareTarget as any)?.shared_roles) ?? []) as string[]}
        itemLabel="Bot"
        onSaved={fetchBots}
      />
    </div>
  );
}
