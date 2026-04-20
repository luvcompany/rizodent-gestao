import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Instagram, Plus, Eye, EyeOff, CheckCircle, Power, Trash2, Settings,
} from "lucide-react";

const IG_PURPLE = "#833AB4";

interface InstagramAccount {
  id?: string;
  name: string;
  instagram_account_id: string;
  page_access_token: string | null;
  is_active: boolean;
  created_at?: string;
}

const emptyAccount: InstagramAccount = {
  name: "",
  instagram_account_id: "",
  page_access_token: "",
  is_active: true,
};

function maskToken(token: string | null) {
  if (!token) return "—";
  if (token.length <= 6) return "••••••";
  return `••••••${token.slice(-6)}`;
}

export default function InstagramAccountsSection() {
  const [accounts, setAccounts] = useState<InstagramAccount[]>([]);
  const [editAccount, setEditAccount] = useState<InstagramAccount | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const { data, error } = await supabase
      .from("instagram_accounts")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) {
      toast.error("Erro ao carregar contas do Instagram");
      return;
    }
    setAccounts((data ?? []) as InstagramAccount[]);
  };

  useEffect(() => {
    load();
  }, []);

  const handleNew = () => {
    setShowToken(false);
    setEditAccount({ ...emptyAccount });
  };

  const handleEdit = (acc: InstagramAccount) => {
    setShowToken(false);
    setEditAccount({ ...acc });
  };

  const handleSave = async () => {
    if (!editAccount) return;
    const name = editAccount.name.trim();
    const igId = editAccount.instagram_account_id.trim();
    if (!name || !igId) {
      toast.error("Nome e Instagram Account ID são obrigatórios");
      return;
    }
    if (name.length > 100) {
      toast.error("Nome deve ter até 100 caracteres");
      return;
    }
    if (!/^\d+$/.test(igId)) {
      toast.error("Instagram Account ID deve conter apenas números");
      return;
    }

    setSaving(true);
    try {
      if (editAccount.id) {
        const payload: Partial<InstagramAccount> = {
          name,
          instagram_account_id: igId,
          is_active: editAccount.is_active,
        };
        // Only update token if user typed something different from masked placeholder
        if (editAccount.page_access_token && !editAccount.page_access_token.startsWith("••••")) {
          payload.page_access_token = editAccount.page_access_token;
        }
        const { error } = await supabase.from("instagram_accounts").update(payload).eq("id", editAccount.id);
        if (error) throw error;
        toast.success("Conta atualizada");
      } else {
        const { error } = await supabase.from("instagram_accounts").insert({
          name,
          instagram_account_id: igId,
          page_access_token: editAccount.page_access_token || null,
          is_active: editAccount.is_active,
        });
        if (error) throw error;
        toast.success("Conta cadastrada");
      }
      setEditAccount(null);
      load();
    } catch (e: any) {
      console.error("[InstagramAccountsSection] save error", e);
      toast.error(e?.message ?? "Erro ao salvar conta");
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (acc: InstagramAccount, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!acc.id) return;
    const { error } = await supabase
      .from("instagram_accounts")
      .update({ is_active: !acc.is_active })
      .eq("id", acc.id);
    if (error) {
      toast.error("Erro ao alterar status");
      return;
    }
    toast.success(!acc.is_active ? "Conta ativada" : "Conta desativada");
    load();
  };

  const handleDelete = async (acc: InstagramAccount) => {
    if (!acc.id) return;
    if (!confirm(`Excluir a conta "${acc.name}"?`)) return;
    const { error } = await supabase.from("instagram_accounts").delete().eq("id", acc.id);
    if (error) {
      toast.error("Erro ao excluir");
      return;
    }
    toast.success("Conta excluída");
    load();
  };

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-foreground flex items-center gap-2">
          <Instagram size={20} style={{ color: IG_PURPLE }} /> Instagram
        </h2>
        <Button size="sm" onClick={handleNew} style={{ backgroundColor: IG_PURPLE, color: "white" }} className="hover:opacity-90">
          <Plus size={14} className="mr-1" /> Nova Conta
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {accounts.length === 0 && (
          <Card className="col-span-full">
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              Nenhuma conta do Instagram cadastrada.
            </CardContent>
          </Card>
        )}

        {accounts.map((acc) => (
          <Card
            key={acc.id}
            className="cursor-pointer hover:border-primary/30 transition-all"
            onClick={() => handleEdit(acc)}
          >
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div
                  className="p-2 rounded-lg"
                  style={{ backgroundColor: `${IG_PURPLE}1A` }}
                >
                  <Instagram size={28} style={{ color: IG_PURPLE }} />
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={acc.is_active}
                    onCheckedChange={() => {}}
                    onClick={(e) => handleToggle(acc, e)}
                  />
                  {acc.is_active ? (
                    <Badge className="bg-green-900/30 text-green-400 border-0">
                      <CheckCircle size={12} className="mr-1" /> Ativa
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-muted-foreground">
                      <Power size={12} className="mr-1" /> Inativa
                    </Badge>
                  )}
                </div>
              </div>
              <h3 className="font-semibold text-foreground text-sm mb-1 truncate">{acc.name}</h3>
              <p className="text-xs text-muted-foreground font-mono truncate">ID: {acc.instagram_account_id}</p>
              <p className="text-xs text-muted-foreground font-mono mt-1">Token: {maskToken(acc.page_access_token)}</p>
              <div className="flex gap-2 mt-3">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 h-8 text-xs"
                  onClick={(e) => { e.stopPropagation(); handleEdit(acc); }}
                >
                  <Settings size={12} className="mr-1" /> Configurar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-destructive hover:text-destructive"
                  onClick={(e) => { e.stopPropagation(); handleDelete(acc); }}
                >
                  <Trash2 size={12} />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!editAccount} onOpenChange={(open) => !open && setEditAccount(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Instagram size={18} style={{ color: IG_PURPLE }} />
              {editAccount?.id ? "Editar Conta Instagram" : "Nova Conta Instagram"}
            </DialogTitle>
          </DialogHeader>
          {editAccount && (
            <div className="space-y-4 mt-2">
              <div>
                <Label>Nome da conta</Label>
                <Input
                  value={editAccount.name}
                  onChange={(e) => setEditAccount({ ...editAccount, name: e.target.value })}
                  placeholder="Ex: Rizodent Principal"
                  maxLength={100}
                />
              </div>
              <div>
                <Label>Instagram Account ID</Label>
                <Input
                  value={editAccount.instagram_account_id}
                  onChange={(e) => setEditAccount({ ...editAccount, instagram_account_id: e.target.value })}
                  placeholder="17841400000000000"
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground mt-1">ID numérico da conta no Instagram</p>
              </div>
              <div>
                <Label>Page Access Token</Label>
                <div className="flex gap-2">
                  <Input
                    type={showToken ? "text" : "password"}
                    value={editAccount.page_access_token ?? ""}
                    onChange={(e) => setEditAccount({ ...editAccount, page_access_token: e.target.value })}
                    placeholder={editAccount.id ? "Deixe em branco para manter o atual" : "EAAB..."}
                    className="font-mono"
                  />
                  <Button type="button" variant="outline" size="icon" onClick={() => setShowToken((v) => !v)}>
                    {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
                  </Button>
                </div>
                {editAccount.id && editAccount.page_access_token && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Atual: {maskToken(editAccount.page_access_token)}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={editAccount.is_active}
                  onCheckedChange={(v) => setEditAccount({ ...editAccount, is_active: v })}
                />
                <Label className="cursor-pointer" onClick={() => setEditAccount({ ...editAccount, is_active: !editAccount.is_active })}>
                  Conta ativa
                </Label>
              </div>
              <Button onClick={handleSave} disabled={saving} className="w-full" style={{ backgroundColor: IG_PURPLE, color: "white" }}>
                {saving ? "Salvando..." : "Salvar"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
