import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Instagram,
  Trash2,
  Eye,
  EyeOff,
  AlertTriangle,
  Plus,
  CheckCircle,
  XCircle,
  Settings,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";

const IG_PURPLE = "#833AB4";

interface IgAccount {
  id: string;
  ig_user_id: string;
  username: string | null;
  access_token: string;
  token_expires_at: string | null;
  active: boolean;
  created_at: string;
}

function cleanUsername(raw: string) {
  return raw.replace(/^@/, "").trim().toLowerCase();
}

function defaultExpiry() {
  const d = new Date();
  d.setDate(d.getDate() + 60);
  return d.toISOString().slice(0, 10);
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export default function InstagramLiteSection() {
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<IgAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [username, setUsername] = useState("");
  const [igUserId, setIgUserId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [expiresAt, setExpiresAt] = useState(defaultExpiry());
  const [showToken, setShowToken] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("ig_accounts")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) {
      toast.error("Erro ao carregar contas Instagram");
    } else {
      setAccounts((data ?? []) as IgAccount[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const expiringSoon = useMemo(
    () =>
      accounts.filter((a) => {
        const d = daysUntil(a.token_expires_at);
        return d !== null && d >= 0 && d <= 7;
      }),
    [accounts]
  );

  const activeCount = accounts.filter((a) => {
    if (!a.active) return false;
    if (!a.token_expires_at) return true;
    return new Date(a.token_expires_at).getTime() >= Date.now();
  }).length;

  const resetForm = () => {
    setUsername("");
    setIgUserId("");
    setAccessToken("");
    setExpiresAt(defaultExpiry());
    setShowToken(false);
  };

  const handleAdd = async () => {
    const cleanUser = cleanUsername(username);
    const cleanId = igUserId.trim();
    const cleanToken = accessToken.trim();

    if (!cleanUser || !cleanId || !cleanToken) {
      toast.error("Preencha username, ID e access token");
      return;
    }
    if (!/^\d+$/.test(cleanId)) {
      toast.error("Instagram User ID deve conter apenas números");
      return;
    }

    setSaving(true);
    const { error } = await (supabase as any).from("ig_accounts").insert({
      ig_user_id: cleanId,
      username: cleanUser,
      access_token: cleanToken,
      token_expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      active: true,
    });

    if (error) {
      if (error.code === "23505") {
        toast.error("Este Instagram User ID já está cadastrado");
      } else {
        toast.error("Erro ao salvar conta: " + error.message);
      }
    } else {
      toast.success("Conta Instagram conectada");
      resetForm();
      load();
    }
    setSaving(false);
  };

  const handleDelete = async (acc: IgAccount) => {
    if (!confirm(`Desconectar a conta @${acc.username || acc.ig_user_id}?`)) return;
    const { error } = await (supabase as any).from("ig_accounts").delete().eq("id", acc.id);
    if (error) {
      toast.error("Erro ao remover");
      return;
    }
    toast.success("Conta desconectada");
    load();
  };

  const handleToggleActive = async (acc: IgAccount) => {
    const newActive = !acc.active;
    const { error } = await (supabase as any)
      .from("ig_accounts")
      .update({ active: newActive })
      .eq("id", acc.id);
    if (error) {
      toast.error("Erro ao atualizar status");
      return;
    }
    toast.success(newActive ? "Conta ativada" : "Conta desativada");
    load();
  };

  const isExpired = (a: IgAccount) => {
    if (!a.token_expires_at) return false;
    return new Date(a.token_expires_at).getTime() < Date.now();
  };

  return (
    <div className="mt-6">
      <h2 className="font-semibold text-foreground mb-4 flex items-center gap-2">
        <Instagram size={20} style={{ color: IG_PURPLE }} /> Instagram Lite
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl">
        <Card
          className="cursor-pointer hover:border-primary/30 transition-all"
          onClick={() => setOpen(true)}
        >
          <CardContent className="p-5">
            <div className="flex items-start justify-between mb-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Instagram size={28} style={{ color: IG_PURPLE }} />
              </div>
              {accounts.length === 0 ? (
                <Badge variant="secondary" className="text-muted-foreground">
                  <XCircle size={12} className="mr-1" /> Não conectado
                </Badge>
              ) : (
                <Badge className="bg-green-900/30 text-green-400 border-0">
                  <CheckCircle size={12} className="mr-1" /> {activeCount} ativa{activeCount === 1 ? "" : "s"}
                </Badge>
              )}
            </div>
            <h3 className="font-semibold text-foreground mb-1">Instagram Lite</h3>
            <p className="text-sm text-muted-foreground">
              {accounts.length === 0
                ? "Integração manual via Meta Developers."
                : `${accounts.length} conta${accounts.length === 1 ? "" : "s"} cadastrada${accounts.length === 1 ? "" : "s"}.`}
            </p>
            {expiringSoon.length > 0 && (
              <p className="text-xs text-yellow-400 mt-2 flex items-center gap-1">
                <AlertTriangle size={12} /> {expiringSoon.length} token{expiringSoon.length === 1 ? "" : "s"} expirando
              </p>
            )}
            <Button variant="outline" size="sm" className="mt-3 w-full">
              <Settings size={14} className="mr-1" /> Configurar
            </Button>
          </CardContent>
        </Card>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Instagram size={20} style={{ color: IG_PURPLE }} />
              Instagram Lite
              <span className="text-xs font-normal text-muted-foreground bg-muted px-2 py-1 rounded ml-auto mr-6">
                Integração manual via Meta Developers
              </span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Expiring tokens warning */}
            {expiringSoon.map((a) => {
              const d = daysUntil(a.token_expires_at) ?? 0;
              return (
                <Alert key={a.id} className="border-yellow-500/50 bg-yellow-500/10">
                  <AlertTriangle className="h-4 w-4 text-yellow-500" />
                  <AlertDescription className="text-yellow-200">
                    Token de <strong>@{a.username || a.ig_user_id}</strong> expira em{" "}
                    {d} {d === 1 ? "dia" : "dias"}. Atualize no Meta Developers.
                  </AlertDescription>
                </Alert>
              );
            })}

            {/* Section 1 — Connected accounts */}
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">
                Contas conectadas
              </h3>
              {loading ? (
                <p className="text-xs text-muted-foreground">Carregando...</p>
              ) : accounts.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="p-6 flex flex-col items-center text-center gap-2 text-muted-foreground">
                    <Instagram size={28} style={{ color: IG_PURPLE, opacity: 0.5 }} />
                    <p className="text-sm">Nenhuma conta conectada ainda.</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {accounts.map((acc) => {
                    const expired = isExpired(acc);
                    const initial = (acc.username || acc.ig_user_id).charAt(0).toUpperCase();
                    return (
                      <Card key={acc.id}>
                        <CardContent className="p-4 flex items-center gap-3">
                          <div
                            className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0"
                            style={{
                              background: `linear-gradient(135deg, ${IG_PURPLE}, #E1306C)`,
                            }}
                          >
                            {initial}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm text-foreground truncate">
                              @{acc.username || acc.ig_user_id}
                            </p>
                            <p className="text-xs text-muted-foreground font-mono truncate">
                              ID: {acc.ig_user_id}
                            </p>
                          </div>
                          {expired ? (
                            <Badge className="bg-red-900/30 text-red-400 border-0">
                              <XCircle size={12} className="mr-1" /> Token expirado
                            </Badge>
                          ) : acc.active ? (
                            <Badge className="bg-green-900/30 text-green-400 border-0">
                              <CheckCircle size={12} className="mr-1" /> Ativo
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-muted-foreground">
                              <XCircle size={12} className="mr-1" /> Inativo
                            </Badge>
                          )}
                          <Switch
                            checked={acc.active}
                            onCheckedChange={() => handleToggleActive(acc)}
                            disabled={expired}
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive h-8 w-8 p-0"
                            onClick={() => handleDelete(acc)}
                          >
                            <Trash2 size={14} />
                          </Button>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Section 2 — Add account */}
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">
                Adicionar nova conta
              </h3>
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">
                        Username *
                      </label>
                      <Input
                        placeholder="@rizodentipiau"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">
                        Instagram User ID *
                      </label>
                      <Input
                        placeholder="17841478577704003"
                        value={igUserId}
                        onChange={(e) => setIgUserId(e.target.value)}
                        inputMode="numeric"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">
                      Access Token *
                    </label>
                    <div className="relative">
                      <Textarea
                        placeholder="EAAB... (token longo gerado no Meta Developers)"
                        value={accessToken}
                        onChange={(e) => setAccessToken(e.target.value)}
                        className={`font-mono text-xs pr-10 ${
                          showToken ? "" : "[-webkit-text-security:disc] [text-security:disc]"
                        }`}
                        rows={3}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="absolute top-1 right-1 h-7 w-7 p-0"
                        onClick={() => setShowToken((v) => !v)}
                      >
                        {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">
                        Data de expiração do token
                      </label>
                      <Input
                        type="date"
                        value={expiresAt}
                        onChange={(e) => setExpiresAt(e.target.value)}
                      />
                    </div>
                    <Button onClick={handleAdd} disabled={saving} className="w-full">
                      <Plus size={14} className="mr-1" />
                      {saving ? "Conectando..." : "Conectar conta"}
                    </Button>
                  </div>

                  <p className="text-xs text-muted-foreground pt-1">
                    Gere o token de acesso em{" "}
                    <a
                      href="https://developers.facebook.com"
                      target="_blank"
                      rel="noreferrer"
                      className="underline hover:text-foreground"
                    >
                      developers.facebook.com
                    </a>{" "}
                    → seu app → Instagram → Gerar token.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
