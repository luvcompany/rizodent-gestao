import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Instagram, CheckCircle, Power, Trash2, Facebook, Plus, Loader2 } from "lucide-react";

const IG_PURPLE = "#833AB4";
const FB_BLUE = "#1877F2";

interface InstagramAccount {
  id: string;
  name: string;
  instagram_account_id: string;
  page_id: string | null;
  page_access_token: string | null;
  long_lived_token_expires_at: string | null;
  is_active: boolean;
  created_at?: string;
}

function maskId(id: string) {
  if (!id) return "—";
  if (id.length <= 6) return `••••${id}`;
  return `••••${id.slice(-6)}`;
}

function formatExpiry(iso: string | null) {
  if (!iso) return "Token sem data de expiração";
  try {
    return `Token válido até ${new Date(iso).toLocaleDateString("pt-BR")}`;
  } catch {
    return "Token sem data de expiração";
  }
}

export default function InstagramAccountsSection() {
  const [accounts, setAccounts] = useState<InstagramAccount[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [globalEnabled, setGlobalEnabled] = useState(true);
  const [togglingGlobal, setTogglingGlobal] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data, error }, { data: globalRow }] = await Promise.all([
      supabase.from("instagram_accounts").select("*").order("created_at", { ascending: true }),
      supabase.from("integrations").select("status").eq("key", "instagram_global").maybeSingle(),
    ]);
    if (error) {
      toast.error("Erro ao carregar contas do Instagram");
    } else {
      setAccounts((data ?? []) as InstagramAccount[]);
    }
    setGlobalEnabled(globalRow?.status !== "disabled");
    setLoading(false);
  };

  const handleToggleGlobal = async (enabled: boolean) => {
    setTogglingGlobal(true);
    const newStatus = enabled ? "connected" : "disabled";
    const { data: existing } = await supabase
      .from("integrations")
      .select("id")
      .eq("key", "instagram_global")
      .maybeSingle();
    const { error } = existing
      ? await supabase.from("integrations").update({ status: newStatus }).eq("id", existing.id)
      : await supabase.from("integrations").insert({ key: "instagram_global", status: newStatus, config: {} });
    if (error) {
      toast.error("Erro ao alterar integração do Instagram");
    } else {
      setGlobalEnabled(enabled);
      toast.success(
        enabled
          ? "Integração do Instagram ativada"
          : "Integração do Instagram desativada — DMs e comentários não serão mais recebidos",
      );
    }
    setTogglingGlobal(false);
  };

  useEffect(() => {
    load();

    const params = new URLSearchParams(window.location.search);
    const igStatus = params.get("instagram");
    if (igStatus === "connected") {
      const count = params.get("count");
      toast.success(`Instagram conectado! ${count ?? 0} conta(s) vinculada(s).`);
      window.history.replaceState({}, "", window.location.pathname);
    } else if (igStatus === "error") {
      toast.error("Falha ao conectar com o Instagram. Tente novamente.");
      window.history.replaceState({}, "", window.location.pathname);
    }

    const onMessage = (ev: MessageEvent) => {
      const d = ev.data;
      if (!d || typeof d !== "object" || d.type !== "oauth_result") return;
      if (d.channel !== "instagram") return;
      if (d.status === "connected") {
        toast.success(`Instagram conectado! ${d.count ?? 0} conta(s) vinculada(s).`);
        load();
      } else {
        toast.error("Falha ao conectar com o Instagram. Tente novamente.");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      // Get app config from edge function (avoids exposing secrets in frontend env)
      const { data, error } = await supabase.functions.invoke("get-instagram-app-id");
      if (error) throw error;
      const appId: string = data?.app_id ?? "";
      const redirectUri: string = data?.redirect_uri ?? "";
      if (!appId || !redirectUri) {
        toast.error("Configuração do Meta App ausente. Configure os secrets META_APP_ID e INSTAGRAM_REDIRECT_URI.");
        setConnecting(false);
        return;
      }

      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) {
        toast.error("Usuário não autenticado.");
        setConnecting(false);
        return;
      }

      // Descobre o tenant do usuário
      const { data: profileData, error: profileErr } = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("id", userId)
        .maybeSingle();
      const tenantId = profileData?.tenant_id;
      if (profileErr || !tenantId) {
        toast.error("Tenant não encontrado para o usuário.");
        setConnecting(false);
        return;
      }

      // Cria um state OAuth atrelado a usuário+tenant (expira em 15 min via default)
      const { data: stateRow, error: stateErr } = await supabase
        .from("instagram_oauth_states")
        .insert({ user_id: userId, tenant_id: tenantId })
        .select("state")
        .single();
      if (stateErr || !stateRow?.state) {
        toast.error("Falha ao iniciar fluxo OAuth. Tente novamente.");
        setConnecting(false);
        return;
      }
      const state = stateRow.state as string;

      const oauthUrl = new URL("https://www.facebook.com/v25.0/dialog/oauth");
      oauthUrl.searchParams.set("client_id", appId);
      oauthUrl.searchParams.set("redirect_uri", redirectUri);
      oauthUrl.searchParams.set(
        "scope",
        [
          "business_management",
          "instagram_basic",
          "instagram_manage_comments",
          "instagram_manage_messages",
          "pages_manage_engagement",
          "pages_manage_metadata",
          "pages_read_engagement",
          "pages_show_list",
        ].join(","),
      );
      oauthUrl.searchParams.set("response_type", "code");
      oauthUrl.searchParams.set("auth_type", "rerequest");
      oauthUrl.searchParams.set("state", state);

      // Open in popup
      const width = 600;
      const height = 700;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      const popup = window.open(
        oauthUrl.toString(),
        "facebook-oauth",
        `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes`,
      );

      if (!popup) {
        toast.error("Popup bloqueado pelo navegador. Permita popups e tente novamente.");
        setConnecting(false);
        return;
      }

      const checkPopup = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkPopup);
          setConnecting(false);
          load();
        }
      }, 500);
    } catch (e: any) {
      console.error("[InstagramAccountsSection] connect error:", e);
      toast.error(e?.message ?? "Erro ao iniciar conexão");
      setConnecting(false);
    }
  };

  const handleToggle = async (acc: InstagramAccount) => {
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
    if (!confirm(`Remover a conta "${acc.name}"? Esta ação pode ser desfeita reconectando.`)) return;
    const { error } = await supabase.from("instagram_accounts").delete().eq("id", acc.id);
    if (error) {
      toast.error("Erro ao remover");
      return;
    }
    toast.success("Conta removida");
    load();
  };

  const hasAccounts = accounts.length > 0;

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-foreground flex items-center gap-2">
          <Instagram size={20} style={{ color: IG_PURPLE }} /> Instagram
        </h2>
        {hasAccounts && (
          <Button
            size="sm"
            onClick={handleConnect}
            disabled={connecting}
            style={{ backgroundColor: FB_BLUE, color: "white" }}
            className="hover:opacity-90"
          >
            {connecting ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Plus size={14} className="mr-1" />}
            Adicionar outra conta
          </Button>
        )}
      </div>

      {hasAccounts && (
        <Card className="mb-4 border-l-4" style={{ borderLeftColor: globalEnabled ? IG_PURPLE : "hsl(var(--muted-foreground))" }}>
          <CardContent className="p-4 flex items-center justify-between gap-4">
            <div>
              <h3 className="font-medium text-foreground text-sm">
                Receber DMs e comentários do Instagram
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                {globalEnabled
                  ? "Ativo. O CRM está recebendo todas as mensagens e comentários do Instagram."
                  : "Desativado. Nenhum DM ou comentário do Instagram entrará no CRM (as contas continuam conectadas)."}
              </p>
            </div>
            <Switch
              checked={globalEnabled}
              disabled={togglingGlobal}
              onCheckedChange={handleToggleGlobal}
            />
          </CardContent>
        </Card>
      )}

      {!hasAccounts && !loading && (
        <Card>
          <CardContent className="p-6 flex flex-col items-center text-center gap-4">
            <div className="p-4 rounded-full" style={{ backgroundColor: `${IG_PURPLE}1A` }}>
              <Instagram size={40} style={{ color: IG_PURPLE }} />
            </div>
            <div>
              <h3 className="font-semibold text-foreground mb-1">Conecte suas contas do Instagram</h3>
              <p className="text-sm text-muted-foreground max-w-md">
                Conecte suas contas do Instagram para receber e responder DMs e comentários direto pelo CRM.
              </p>
            </div>
            <Button
              onClick={handleConnect}
              disabled={connecting}
              style={{ backgroundColor: FB_BLUE, color: "white" }}
              className="hover:opacity-90"
            >
              {connecting ? (
                <Loader2 size={16} className="mr-2 animate-spin" />
              ) : (
                <Facebook size={16} className="mr-2" />
              )}
              Conectar com Facebook
            </Button>
          </CardContent>
        </Card>
      )}

      {hasAccounts && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {accounts.map((acc) => (
            <Card key={acc.id}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="p-2 rounded-lg" style={{ backgroundColor: `${IG_PURPLE}1A` }}>
                    <Instagram size={28} style={{ color: IG_PURPLE }} />
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={acc.is_active} onCheckedChange={() => handleToggle(acc)} />
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
                <p className="text-xs text-muted-foreground font-mono truncate">
                  ID: {maskId(acc.instagram_account_id)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">{formatExpiry(acc.long_lived_token_expires_at)}</p>
                <div className="flex gap-2 mt-3">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto h-8 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(acc)}
                  >
                    <Trash2 size={12} className="mr-1" /> Remover
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
