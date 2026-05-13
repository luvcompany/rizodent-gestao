import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Instagram, CheckCircle, Power, ExternalLink, Plus, Trash2 } from "lucide-react";

const IG_PURPLE = "#833AB4";

interface LiteAccount {
  id: string;
  display_name: string;
  username: string;
  is_active: boolean;
  created_at?: string;
}

function cleanUsername(raw: string) {
  return raw.replace(/^@/, "").trim().toLowerCase();
}

export default function InstagramLiteSection() {
  const [accounts, setAccounts] = useState<LiteAccount[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("integrations")
      .select("id, config, status")
      .like("key", "instagram_lite_%")
      .order("created_at", { ascending: true });

    if (error) {
      toast.error("Erro ao carregar contas Instagram Lite");
    } else {
      const mapped = (data ?? []).map((row: any) => ({
        id: row.id,
        display_name: row.config?.display_name || "",
        username: row.config?.username || "",
        is_active: row.status !== "disabled",
        created_at: row.created_at,
      }));
      setAccounts(mapped);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handleAdd = async () => {
    const clean = cleanUsername(username);
    if (!displayName.trim() || !clean) {
      toast.error("Preencha o nome e o @username");
      return;
    }
    setSaving(true);

    // Check duplicate username
    const existing = accounts.find((a) => a.username === clean);
    if (existing) {
      toast.error("Este @username já está cadastrado");
      setSaving(false);
      return;
    }

    const idx = accounts.length + 1;
    const { error } = await supabase.from("integrations").insert({
      key: `instagram_lite_${idx}_${Date.now()}`,
      status: "connected",
      config: {
        display_name: displayName.trim(),
        username: clean,
      },
    });

    if (error) {
      toast.error("Erro ao salvar conta");
    } else {
      toast.success("Conta Instagram Lite adicionada");
      setDisplayName("");
      setUsername("");
      load();
    }
    setSaving(false);
  };

  const handleToggle = async (acc: LiteAccount) => {
    const newStatus = acc.is_active ? "disabled" : "connected";
    const { error } = await supabase
      .from("integrations")
      .update({ status: newStatus })
      .eq("id", acc.id);
    if (error) {
      toast.error("Erro ao alterar status");
      return;
    }
    toast.success(acc.is_active ? "Conta desativada" : "Conta ativada");
    load();
  };

  const handleDelete = async (acc: LiteAccount) => {
    if (!confirm(`Remover a conta "${acc.display_name}"?`)) return;
    const { error } = await supabase.from("integrations").delete().eq("id", acc.id);
    if (error) {
      toast.error("Erro ao remover");
      return;
    }
    toast.success("Conta removida");
    load();
  };

  const openDm = (username: string) => {
    window.open(`https://ig.me/m/${username}`, "_blank");
  };

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-foreground flex items-center gap-2">
          <Instagram size={20} style={{ color: IG_PURPLE }} /> Instagram Lite
        </h2>
        <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
          Integração manual — sem API do Meta
        </span>
      </div>

      {/* Add account form */}
      <Card className="mb-4">
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Nome da conta</label>
              <Input
                placeholder="Ex: Rizodent Principal"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">@username do Instagram</label>
              <Input
                placeholder="Ex: @rizodent"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button onClick={handleAdd} disabled={saving} className="w-full">
                <Plus size={14} className="mr-1" />
                {saving ? "Salvando..." : "Adicionar Conta"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Accounts list */}
      {accounts.length === 0 && !loading && (
        <Card className="border-dashed">
          <CardContent className="p-6 flex flex-col items-center text-center gap-3 text-muted-foreground">
            <Instagram size={32} style={{ color: IG_PURPLE, opacity: 0.5 }} />
            <p className="text-sm">Nenhuma conta Instagram Lite cadastrada.</p>
            <p className="text-xs max-w-sm">
              Adicione o @username das contas do Instagram para poder abrir o DM diretamente pelo CRM.
            </p>
          </CardContent>
        </Card>
      )}

      {accounts.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {accounts.map((acc) => (
            <Card key={acc.id}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="p-2 rounded-lg" style={{ backgroundColor: `${IG_PURPLE}1A` }}>
                    <Instagram size={28} style={{ color: IG_PURPLE }} />
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={acc.is_active}
                      onCheckedChange={() => handleToggle(acc)}
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
                <h3 className="font-semibold text-foreground text-sm mb-1 truncate">
                  {acc.display_name}
                </h3>
                <p className="text-xs text-muted-foreground font-mono truncate">
                  @{acc.username}
                </p>
                <div className="flex gap-2 mt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 h-8"
                    onClick={() => openDm(acc.username)}
                  >
                    <ExternalLink size={12} className="mr-1" /> Abrir DM
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(acc)}
                  >
                    <Trash2 size={12} />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
