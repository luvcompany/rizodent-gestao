import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, LogIn } from "lucide-react";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import crclinIcon from "@/assets/crclin-icon.png";

const TenantLogin = () => {
  const navigate = useNavigate();
  const { tenant, loading: tenantLoading } = useTenant();
  const { refreshProfile } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenant.slug) {
      toast.error("Cliente não identificado nesta URL.");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("tenant-login", {
        body: { slug: tenant.slug, email, password },
      });
      if (error || (data as any)?.error) {
        const msg = (data as any)?.error || error?.message || "Falha no login.";
        toast.error(msg);
        setLoading(false);
        return;
      }
      const sess = (data as any)?.session;
      if (!sess?.access_token || !sess?.refresh_token) {
        toast.error("Resposta inválida do servidor.");
        setLoading(false);
        return;
      }
      const { error: setErr } = await supabase.auth.setSession({
        access_token: sess.access_token,
        refresh_token: sess.refresh_token,
      });
      if (setErr) {
        toast.error(setErr.message);
        setLoading(false);
        return;
      }
      const dashboardWarmup = import("./Dashboard")
        .then(({ prefetchDashboardData }) => prefetchDashboardData())
        .catch(() => undefined);
      await refreshProfile();
      // Check role to redirect posvenda directly to CRM
      const { data: { user } } = await supabase.auth.getUser();
      let target = "/dashboard";
      if (user) {
        const { data: roleRow } = await supabase
          .from("user_roles").select("role").eq("user_id", user.id).maybeSingle();
        if ((roleRow as any)?.role === "posvenda") target = "/crm";
      }
      // If arrived from an OAuth consent flow (or any protected page), honor ?next=.
      const nextParam = new URLSearchParams(window.location.search).get("next");
      if (nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")) {
        target = nextParam;
      }
      if (target === "/dashboard") await dashboardWarmup;
      navigate(target);
    } catch (err: any) {
      toast.error(err?.message || "Erro inesperado.");
      setLoading(false);
    }
  };

  // Handle admin impersonation tokens (must run before any conditional return)
  useEffect(() => {
    // Tokens vêm no FRAGMENTO da URL (#impersonate_at=...&impersonate_rt=...)
    // para não vazarem em logs de servidor nem no header Referer.
    // Fallback: aceita ainda na query string para não quebrar links antigos abertos em cache.
    const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
    const hashParams = new URLSearchParams(hash);
    const queryParams = new URLSearchParams(window.location.search);
    const at = hashParams.get("impersonate_at") || queryParams.get("impersonate_at");
    const rt = hashParams.get("impersonate_rt") || queryParams.get("impersonate_rt");
    if (at && rt) {
      (async () => {
        const { error } = await supabase.auth.setSession({ access_token: at, refresh_token: rt });
        if (error) {
          toast.error("Erro ao estabelecer sessão: " + error.message);
        } else {
          const url = new URL(window.location.href);
          url.searchParams.delete("impersonate_at");
          url.searchParams.delete("impersonate_rt");
          url.hash = "";
          window.history.replaceState({}, "", url.toString());
          const dashboardWarmup = import("./Dashboard")
            .then(({ prefetchDashboardData }) => prefetchDashboardData())
            .catch(() => undefined);
          await refreshProfile();
          const { data: { user } } = await supabase.auth.getUser();
          let target = "/dashboard";
          if (user) {
            const { data: roleRow } = await supabase
              .from("user_roles").select("role").eq("user_id", user.id).maybeSingle();
            if ((roleRow as any)?.role === "posvenda") target = "/crm";
          }
          if (target === "/dashboard") await dashboardWarmup;
          navigate(target);
        }
      })();
    }
  }, []);

  if (tenantLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 text-muted-foreground">
        <h1 className="sr-only">Acesso da equipe</h1>
        <span>Carregando...</span>
      </div>
    );
  }

  if (!tenant.id) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold mb-2">Cliente não encontrado</h1>
          <p className="text-muted-foreground mb-4">
            O endereço <code className="px-2 py-1 rounded bg-muted">/{tenant.slug}</code> não corresponde a nenhum cliente ativo.
          </p>
          <a href="/" className="text-primary underline">Voltar à página inicial</a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md animate-fade-in">
        <div className="gradient-card rounded-2xl border border-border p-8 shadow-card">
          <div className="mb-8 flex flex-col items-center gap-4">
            {tenant.logo_url && tenant.logo_url.includes("tenant-logos") ? (
              // Logo PRÓPRIA do cliente (upload no bucket tenant-logos)
              <img src={tenant.logo_url} alt={tenant.name} className="h-12 max-w-56 object-contain" />
            ) : (
              // Sem logo própria → ícone limpo do CRClin (o balão colorido fica bom no fundo claro;
              // as logos com wordmark têm o "CR" em branco e somem no card branco).
              <img src={crclinIcon} alt="CRClin" className="h-14 w-14 object-contain" />
            )}
            <div className="text-center">
              <h1 className="text-xl font-bold">Acesso da equipe — {tenant.name}</h1>
              <p className="text-sm text-muted-foreground">Entre com seu e-mail e senha</p>
            </div>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="bg-secondary border-border"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="bg-secondary border-border pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full font-semibold"
              style={tenant.primary_color ? { backgroundColor: tenant.primary_color, color: "#fff" } : undefined}
            >
              {loading ? (
                <span className="animate-pulse">Entrando...</span>
              ) : (
                <>
                  <LogIn size={18} className="mr-2" />
                  Entrar
                </>
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default TenantLogin;
