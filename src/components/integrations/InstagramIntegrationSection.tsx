import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Instagram, Facebook, CheckCircle, Power, Trash2, Plus, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

type IGAccount = {
  id: string;
  name: string | null;
  instagram_account_id: string | null;
  page_id: string | null;
  long_lived_token_expires_at: string | null;
  is_active: boolean;
};

const SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_metadata",
  "pages_messaging",
  "instagram_basic",
  "instagram_manage_messages",
  "instagram_manage_comments",
].join(",");

export default function InstagramIntegrationSection() {
  const [accounts, setAccounts] = useState<IGAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("instagram_accounts")
      .select("id, name, instagram_account_id, page_id, long_lived_token_expires_at, is_active")
      .order("created_at", { ascending: true });
    setAccounts((data as IGAccount[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // Mostrar feedback do callback OAuth via querystring
    const params = new URLSearchParams(window.location.search);
    const status = params.get("instagram");
    const error = params.get("error");
    const accounts = params.get("accounts");

    if (status === "connected") {
      toast.success(`${accounts ?? 0} conta(s) conectada(s) com sucesso`);
    } else if (error) {
      const map: Record<string, string> = {
        no_pages_found: "Nenhuma página encontrada. Verifique se sua conta Facebook administra Páginas vinculadas ao Instagram",
        missing_permissions: "Permissões insuficientes. Tente conectar novamente",
        token_exchange_failed: "Erro na autenticação. Tente novamente",
        long_token_failed: "Erro ao gerar token de longa duração. Tente novamente",
        pages_fetch_failed: "Erro ao buscar páginas do Facebook",
        missing_code: "Autorização cancelada ou inválida",
        fatal_error: "Erro inesperado. Tente novamente",
      };
      toast.error(map[error] ?? `Erro: ${error}`);
    }

    if (status || error) {
      // Limpa querystring para não repetir o toast
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, "", cleanUrl);
    }
  }, []);

  const startOAuth = async () => {
    setConnecting(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const userId = userRes.user?.id;
      if (!userId) { toast.error("Faça login para conectar"); setConnecting(false); return; }

      const { data, error } = await supabase.functions.invoke("get-instagram-app-id");
      if (error || !data?.app_id || !data?.redirect_uri) {
        toast.error("Configuração do Instagram indisponível");
        setConnecting(false);
        return;
      }

      const url = new URL("https://www.facebook.com/v25.0/dialog/oauth");
      url.searchParams.set("client_id", data.app_id);
      url.searchParams.set("redirect_uri", data.redirect_uri);
      url.searchParams.set("scope", SCOPES);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("auth_type", "rerequest");
      url.searchParams.set("state", userId);
      window.location.href = url.toString();
    } catch (e) {
      toast.error("Erro ao iniciar conexão com o Facebook");
      setConnecting(false);
    }
  };

  const toggleActive = async (acc: IGAccount) => {
    const newVal = !acc.is_active;
    setAccounts((prev) => prev.map((a) => (a.id === acc.id ? { ...a, is_active: newVal } : a)));
    const { error } = await supabase
      .from("instagram_accounts")
      .update({ is_active: newVal })
      .eq("id", acc.id);
    if (error) {
      setAccounts((prev) => prev.map((a) => (a.id === acc.id ? { ...a, is_active: acc.is_active } : a)));
      toast.error("Erro ao atualizar conta");
    } else {
      toast.success(newVal ? "Conta ativada" : "Conta desativada");
    }
  };

  const removeAccount = async (acc: IGAccount) => {
    if (!confirm(`Remover a conta "${acc.name || acc.instagram_account_id}"?`)) return;
    const { error } = await supabase.from("instagram_accounts").delete().eq("id", acc.id);
    if (error) { toast.error("Erro ao remover"); return; }
    toast.success("Conta removida");
    load();
  };

  const maskId = (id: string | null | undefined) => {
    if (!id) return "—";
    return `••••${id.slice(-6)}`;
  };

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-foreground flex items-center gap-2">
          <Instagram size={20} className="text-[#E4405F]" /> Instagram
        </h2>
        {accounts.length > 0 && (
          <Button size="sm" onClick={startOAuth} disabled={connecting}>
            {connecting ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Plus size={14} className="mr-1" />}
            Adicionar outra conta
          </Button>
        )}
      </div>

      {loading ? (
        <Card><CardContent className="p-5 text-sm text-muted-foreground">Carregando...</CardContent></Card>
      ) : accounts.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-lg bg-[#E4405F]/10">
                <Instagram size={28} className="text-[#E4405F]" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground mb-1">Conecte suas contas do Instagram</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Conecte suas contas do Instagram para receber e responder DMs e comentários direto pelo CRM.
                </p>
                <Button
                  onClick={startOAuth}
                  disabled={connecting}
                  className="bg-[#1877F2] hover:bg-[#1877F2]/90 text-white"
                >
                  {connecting ? (
                    <Loader2 size={16} className="mr-2 animate-spin" />
                  ) : (
                    <Facebook size={16} className="mr-2" />
                  )}
                  Conectar com Facebook
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {accounts.map((acc) => {
            const expiresAt = acc.long_lived_token_expires_at
              ? new Date(acc.long_lived_token_expires_at)
              : null;
            const expired = expiresAt ? expiresAt.getTime() < Date.now() : false;
            return (
              <Card key={acc.id}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="p-2 rounded-lg bg-[#E4405F]/10">
                      <Instagram size={28} className="text-[#E4405F]" />
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch checked={acc.is_active} onCheckedChange={() => toggleActive(acc)} />
                      {acc.is_active ? (
                        <Badge className="bg-green-900/30 text-green-400 border-0">
                          <CheckCircle size={12} className="mr-1" /> Ativo
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-muted-foreground">
                          <Power size={12} className="mr-1" /> Desativado
                        </Badge>
                      )}
                    </div>
                  </div>
                  <h3 className={`font-semibold mb-1 ${!acc.is_active ? "text-muted-foreground" : "text-foreground"}`}>
                    {acc.name || "Conta Instagram"}
                  </h3>
                  <p className="text-sm text-muted-foreground">ID: {maskId(acc.instagram_account_id)}</p>
                  <p className={`text-xs mt-2 ${expired ? "text-destructive" : "text-muted-foreground"}`}>
                    {expiresAt
                      ? `Token válido até ${format(expiresAt, "dd/MM/yyyy", { locale: ptBR })}`
                      : "Validade do token desconhecida"}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 w-full text-destructive hover:text-destructive"
                    onClick={() => removeAccount(acc)}
                  >
                    <Trash2 size={14} className="mr-1" /> Remover
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
