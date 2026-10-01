import { useEffect, useMemo, useState } from "react";
import InstagramPerguntasDialog from "@/components/integrations/InstagramPerguntasDialog";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
  Loader2,
  ShieldCheck,
  ChevronDown,
  RefreshCw,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";

const IG_PURPLE = "#833AB4";

// O token (access_token) NÃO vem para o navegador: o SELECT dessa coluna é
// revogado de authenticated (migration 20260929001200). Testar o token é pelo
// servidor (instagram-conta, acao "testar"). Por isso a lista pede só estas
// colunas — nunca select("*").
const COLUNAS_IG_ACCOUNTS = "id, ig_user_id, username, token_expires_at, active, created_at";

interface IgAccount {
  id: string;
  ig_user_id: string;
  username: string | null;
  token_expires_at: string | null;
  active: boolean;
  created_at: string;
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

// Toda conta do v2 tem token do Login do Instagram (IGAA…): o popup e o
// cadastro manual (instagram-conta) só aceitam esse token, e o
// instagram-token-refresh renova todos. O antigo "token manual de Página
// (EAA…), sem renovação" era do CRClin — lá o navegador lia o token para
// decidir o rótulo; aqui não lê mais.

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("pt-BR");
  } catch {
    return iso;
  }
}

function descreverValidade(iso: string | null): string {
  if (!iso) return "Token sem data de expiração";
  const d = daysUntil(iso) ?? 0;
  if (d < 0) return `Token vencido em ${formatDate(iso)}`;
  return `Token válido até ${formatDate(iso)} (${d} ${d === 1 ? "dia" : "dias"})`;
}

// Dados públicos do Login do Instagram (get-instagram-app-id → ig_login).
interface IgLoginConfig {
  app_id: string;
  redirect_uri: string;
  scopes: string[];
  habilitado: boolean;
}

// Motivo que o instagram-login-callback manda para o /oauth-close.
const MENSAGEM_MOTIVO: Record<string, string> = {
  config: "O Login do Instagram não está configurado no servidor.",
  negado: "A autorização foi cancelada no Instagram.",
  state: "O link de conexão expirou ou já foi usado. Tente de novo.",
  permissao: "Seu usuário não tem permissão para conectar contas do Instagram.",
  troca: "O Instagram recusou a autorização. Tente de novo.",
  perfil: "Não foi possível ler a conta profissional do Instagram.",
  outro_tenant: "Esta conta do Instagram já está conectada em outra clínica.",
  banco: "Não foi possível salvar a conta. Tente de novo.",
  sessao: "Conclua a conexão neste navegador, logado com o mesmo usuário que clicou em Conectar Instagram.",
  erro: "Não foi possível concluir a conexão. Tente de novo.",
};

// Mensagem de erro de uma edge function (corpo JSON { error }) chamada pelo invoke.
async function erroDaFuncao(error: any, padrao: string): Promise<string> {
  try {
    const b = await error?.context?.json?.();
    if (b?.error) return String(b.error);
  } catch { /* corpo não-JSON */ }
  return padrao;
}

async function carregarIgLogin(): Promise<IgLoginConfig | null> {
  const { data, error } = await supabase.functions.invoke("get-instagram-app-id");
  if (error) throw error;
  const c = (data as any)?.ig_login;
  if (!c || typeof c !== "object") return null;
  return {
    app_id: String(c.app_id ?? ""),
    redirect_uri: String(c.redirect_uri ?? ""),
    scopes: Array.isArray(c.scopes) ? c.scopes.map(String) : [],
    habilitado: !!c.habilitado,
  };
}

export default function InstagramLiteSection() {
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<IgAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [igUserId, setIgUserId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [expiresAt, setExpiresAt] = useState(defaultExpiry());
  const [showToken, setShowToken] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  // Login do Instagram: null = ainda não sabemos (servidor não respondeu).
  const [igLogin, setIgLogin] = useState<IgLoginConfig | null>(null);
  const [connecting, setConnecting] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("ig_accounts")
      .select(COLUNAS_IG_ACCOUNTS)
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
    carregarIgLogin().then(setIgLogin).catch(() => setIgLogin(null));

    // Resposta do popup (/oauth-close → postMessage), igual ao fluxo do WhatsApp.
    const onMessage = (ev: MessageEvent) => {
      const d = ev.data;
      if (!d || typeof d !== "object" || d.type !== "oauth_result") return;
      if (d.channel !== "instagram") return;
      if (d.status === "connected") {
        if (d.reason === "webhooks") {
          toast.warning(
            "Instagram conectado, mas o Instagram não confirmou o envio de mensagens para o CRM. Reconecte a conta; se continuar, confira o webhook no app da Meta.",
          );
        } else {
          toast.success("Instagram conectado! DMs e comentários passam a entrar no CRM.");
        }
      } else {
        toast.error(MENSAGEM_MOTIVO[String(d.reason ?? "")] ?? "Falha ao conectar com o Instagram. Tente novamente.");
      }
      load();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Botão principal: Login do Instagram (Business Login) em popup. O popup abre
  // JÁ no clique (em branco) e só depois recebe a URL — abrir depois dos awaits
  // faz o navegador bloquear como popup não solicitado.
  const handleConnectInstagram = async () => {
    const width = 600;
    const height = 750;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    const popup = window.open(
      "",
      "instagram-login",
      `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes`,
    );
    if (!popup) {
      toast.error("Popup bloqueado pelo navegador. Permita popups e tente novamente.");
      return;
    }
    const abortar = (msg: string) => {
      try { popup.close(); } catch { /* já fechado */ }
      toast.error(msg);
      setConnecting(false);
    };

    setConnecting(true);
    try {
      const cfg = await carregarIgLogin();
      setIgLogin(cfg);
      if (!cfg?.habilitado || !cfg.app_id || !cfg.redirect_uri) {
        abortar(
          "Login do Instagram não configurado no servidor. Cadastre os secrets INSTAGRAM_APP_ID_V2 e INSTAGRAM_APP_SECRET_V2.",
        );
        return;
      }

      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) {
        abortar("Usuário não autenticado.");
        return;
      }
      const { data: profileData, error: profileErr } = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("id", userId)
        .maybeSingle();
      const tenantId = profileData?.tenant_id;
      if (profileErr || !tenantId) {
        abortar("Clínica não encontrada para o usuário.");
        return;
      }

      // State de uso único. O banco decide o valor e a validade (15 min, trigger
      // da migration 20260928210000) — por isso o .select("state"). A origem
      // só vale no callback se estiver em ALLOWED_ORIGINS no servidor (com
      // FRONTEND_URL definida, ela manda). Se a coluna ainda não existir
      // (migration pendente), grava sem ela.
      let { data: stateRow, error: stateErr } = await (supabase as any)
        .from("instagram_oauth_states")
        .insert({ user_id: userId, tenant_id: tenantId, origin: window.location.origin })
        .select("state")
        .single();
      if (stateErr && /origin/i.test(String(stateErr.message ?? ""))) {
        ({ data: stateRow, error: stateErr } = await supabase
          .from("instagram_oauth_states")
          .insert({ user_id: userId, tenant_id: tenantId })
          .select("state")
          .single());
      }
      if (stateErr || !stateRow?.state) {
        abortar("Falha ao iniciar a conexão. Tente novamente.");
        return;
      }

      const authUrl = new URL("https://www.instagram.com/oauth/authorize");
      authUrl.searchParams.set("client_id", cfg.app_id);
      authUrl.searchParams.set("redirect_uri", cfg.redirect_uri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", cfg.scopes.join(","));
      authUrl.searchParams.set("state", String(stateRow.state));
      // Sem isto o Instagram reaproveita a sessão já logada no navegador e o
      // "Conectar outra" (uma conta por cidade) reconecta sempre a mesma conta.
      authUrl.searchParams.set("force_reauth", "true");
      popup.location.href = authUrl.toString();

      // Fallback do postMessage: ao fechar o popup, recarrega a lista.
      const checkPopup = window.setInterval(() => {
        if (popup.closed) {
          window.clearInterval(checkPopup);
          setConnecting(false);
          load();
        }
      }, 700);
    } catch (e: any) {
      console.error("[InstagramLiteSection] connect error:", e);
      abortar(e?.message ?? "Erro ao iniciar conexão com o Instagram");
    }
  };

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
    setIgUserId("");
    setAccessToken("");
    setExpiresAt(defaultExpiry());
    setShowToken(false);
  };

  const [testingId, setTestingId] = useState<string | null>(null);
  // Conta cujo Direct (perguntas prontas + menu fixo) está sendo configurado.
  const [contaDoDirect, setContaDoDirect] = useState<IgAccount | null>(null);

  // Cadastro manual pelo servidor (instagram-conta): o navegador não grava
  // ig_user_id/token direto. O servidor confere o token na Meta (/me), pega o ID
  // e o @ de lá e grava no tenant de quem está logado.
  const handleAdd = async () => {
    const cleanId = igUserId.trim();
    const cleanToken = accessToken.trim();

    if (!cleanToken) {
      toast.error("Informe o access token");
      return;
    }
    if (!cleanToken.startsWith("IGAA")) {
      toast.error("Use um token do Login do Instagram (começa com IGAA).");
      return;
    }
    if (cleanId && !/^\d+$/.test(cleanId)) {
      toast.error("Instagram User ID deve conter apenas números");
      return;
    }

    setSaving(true);
    const { data, error } = await supabase.functions.invoke("instagram-conta", {
      body: {
        acao: "cadastrar",
        access_token: cleanToken,
        ig_user_id: cleanId || undefined,
        token_expires_at: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      },
    });
    if (error) {
      toast.error(await erroDaFuncao(error, "Erro ao salvar conta"));
    } else {
      const d = (data ?? {}) as { username?: string | null; webhooks_ok?: boolean };
      const quem = d.username ? `@${d.username}` : "Conta Instagram";
      if (d.webhooks_ok === false) {
        toast.warning(`${quem} conectada, mas o Instagram não confirmou o envio de mensagens para o CRM.`);
      } else {
        toast.success(`${quem} conectada e token validado`);
      }
      resetForm();
      load();
    }
    setSaving(false);
  };

  // Teste pelo servidor: quem chama a Meta com o token é o instagram-conta.
  const handleTestToken = async (acc: IgAccount) => {
    setTestingId(acc.id);
    const { data, error } = await supabase.functions.invoke("instagram-conta", {
      body: { acao: "testar", ig_account_id: acc.id },
    });
    setTestingId(null);
    if (error) {
      toast.error(await erroDaFuncao(error, "Não foi possível testar o token agora"));
      return;
    }
    const d = (data ?? {}) as { valido?: boolean; motivo?: string };
    if (d.valido) {
      toast.success(`Token de @${acc.username || acc.ig_user_id} está válido`);
    } else if (d.motivo === "outra_conta") {
      toast.error("O token abre outra conta do Instagram. Reconecte pelo botão Conectar Instagram.");
    } else {
      toast.error("A Meta recusou o token (inválido ou vencido). Reconecte pelo botão Conectar Instagram.");
    }
  };

  const handleDelete = async (acc: IgAccount) => {
    if (!confirm(`Desconectar a conta @${acc.username || acc.ig_user_id}?`)) return;
    // Pelo servidor: desliga os webhooks da conta na Meta antes de apagar a linha.
    const { error } = await supabase.functions.invoke("instagram-conta", {
      body: { acao: "desconectar", ig_account_id: acc.id },
    });
    if (error) {
      toast.error(await erroDaFuncao(error, "Erro ao remover"));
      return;
    }
    toast.success("Conta desconectada");
    load();
  };

  const handleToggleActive = async (acc: IgAccount) => {
    const newActive = !acc.active;
    // Sem .select() de volta: o PostgREST responde com return=minimal (não pede
    // coluna nenhuma, muito menos o token).
    const { error } = await supabase
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

  const loginIndisponivel = igLogin !== null && !igLogin.habilitado;

  const botaoConectar = (label: string, className = "") => (
    <Button
      onClick={(e) => {
        e.stopPropagation();
        handleConnectInstagram();
      }}
      disabled={connecting || loginIndisponivel}
      className={`text-white hover:opacity-90 ${className}`}
      style={{ background: `linear-gradient(135deg, ${IG_PURPLE}, #E1306C)` }}
      title={loginIndisponivel ? "Login do Instagram não configurado no servidor" : undefined}
    >
      {connecting ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Instagram size={14} className="mr-1" />}
      {connecting ? "Aguardando o Instagram..." : label}
    </Button>
  );

  return (
    <div className="mt-6">
      <h2 className="font-semibold text-foreground mb-4 flex items-center gap-2">
        <Instagram size={20} style={{ color: IG_PURPLE }} /> Instagram
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
            <h3 className="font-semibold text-foreground mb-1">Instagram (DMs e comentários)</h3>
            <p className="text-sm text-muted-foreground">
              {accounts.length === 0
                ? "Entre com a conta profissional do Instagram para receber e responder DMs e comentários pelo CRM."
                : `${accounts.length} conta${accounts.length === 1 ? "" : "s"} conectada${accounts.length === 1 ? "" : "s"}.`}
            </p>
            {expiringSoon.length > 0 && (
              <p className="text-xs text-yellow-400 mt-2 flex items-center gap-1">
                <AlertTriangle size={12} /> {expiringSoon.length} token{expiringSoon.length === 1 ? "" : "s"} expirando
              </p>
            )}
            {loginIndisponivel && (
              <p className="text-xs text-yellow-400 mt-2 flex items-center gap-1">
                <AlertTriangle size={12} /> Login do Instagram não configurado no servidor.
              </p>
            )}
            <div className="flex gap-2 mt-3">
              {botaoConectar(accounts.length === 0 ? "Conectar Instagram" : "Conectar outra", "flex-1")}
              <Button variant="outline" size="sm" className="h-10" onClick={() => setOpen(true)}>
                <Settings size={14} className="mr-1" /> Contas
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Instagram size={20} style={{ color: IG_PURPLE }} />
              Instagram
              <span className="text-xs font-normal text-muted-foreground bg-muted px-2 py-1 rounded ml-auto mr-6">
                Login do Instagram
              </span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {loginIndisponivel && (
              <Alert className="border-yellow-500/50 bg-yellow-500/10">
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
                <AlertDescription className="text-yellow-200">
                  O botão Conectar Instagram depende dos secrets INSTAGRAM_APP_ID_V2 e
                  INSTAGRAM_APP_SECRET_V2 no servidor. Enquanto isso, use o cadastro manual abaixo.
                </AlertDescription>
              </Alert>
            )}

            {/* Tokens perto de vencer */}
            {expiringSoon.map((a) => {
              const d = daysUntil(a.token_expires_at) ?? 0;
              return (
                <Alert key={a.id} className="border-yellow-500/50 bg-yellow-500/10">
                  <AlertTriangle className="h-4 w-4 text-yellow-500" />
                  <AlertDescription className="text-yellow-200">
                    Token de <strong>@{a.username || a.ig_user_id}</strong> expira em{" "}
                    {d} {d === 1 ? "dia" : "dias"}.{" "}
                    A renovação é automática; se não renovar, clique em Conectar Instagram de novo.
                  </AlertDescription>
                </Alert>
              );
            })}

            <div className="flex justify-end">{botaoConectar(accounts.length === 0 ? "Conectar Instagram" : "Conectar outra conta")}</div>

            {/* Contas conectadas */}
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
                        <CardContent className="p-4 flex flex-wrap items-center gap-3">
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
                            <p className={`text-xs mt-0.5 ${expired ? "text-red-400" : "text-muted-foreground"}`}>
                              {descreverValidade(acc.token_expires_at)}
                            </p>
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <RefreshCw size={10} /> Login do Instagram · renovação automática
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
                            className="h-8 w-8 p-0"
                            title="Testar token na Meta"
                            onClick={() => handleTestToken(acc)}
                            disabled={testingId === acc.id}
                          >
                            {testingId === acc.id ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <ShieldCheck size={14} />
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2 text-xs"
                            title="Perguntas prontas e menu fixo do Direct"
                            onClick={() => setContaDoDirect(acc)}
                          >
                            Direct
                          </Button>
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

            {/* Avançado — cadastro manual de token (Meta Developers). Fica como
                alternativa: o caminho normal é o botão Conectar Instagram. */}
            <Collapsible open={manualOpen} onOpenChange={setManualOpen}>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1 hover:text-foreground"
                >
                  <ChevronDown size={14} className={`transition-transform ${manualOpen ? "rotate-180" : ""}`} />
                  Avançado: cadastrar token manualmente
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">
                      Instagram User ID (opcional — o @ e o ID vêm da Meta pelo token)
                    </label>
                    <Input
                      placeholder="17841478577704003"
                      value={igUserId}
                      onChange={(e) => setIgUserId(e.target.value)}
                      inputMode="numeric"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">
                      Access Token *
                    </label>
                    <div className="relative">
                      <Textarea
                        placeholder="IGAA... (token do Login do Instagram, gerado no Meta Developers)"
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
                    → seu app → API do Instagram → Gerar token. Só token do Login do
                    Instagram (IGAA…) recebe mensagens neste app.
                  </p>
                </CardContent>
              </Card>
              </CollapsibleContent>
            </Collapsible>
          </div>
        </DialogContent>
      </Dialog>
      {contaDoDirect && (
        <InstagramPerguntasDialog
          contaId={contaDoDirect.id}
          usuario={contaDoDirect.username || contaDoDirect.ig_user_id}
          open={!!contaDoDirect}
          onOpenChange={(aberto) => { if (!aberto) setContaDoDirect(null); }}
        />
      )}
    </div>
  );
}
