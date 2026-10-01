// Login do cliente em /<slug>, com a marca efetiva (cliente → sistema).
//
// - Marca: useBrand() (BrandContext, RPC get_public_branding + cache). Logo
//   claro/escuro, título/subtítulo/rodapé do login, imagem de fundo e
//   "Powered by" opcional. Só tokens de tema: nada de cor fixa.
// - Estados: carregando (skeleton, só na 1ª visita sem cache), endereço não
//   encontrado (marca do SISTEMA) e acesso pausado (formulário desabilitado).
// - Não lê token nenhum da URL. A impersonação é pela rota /auth/impersonar.
import { useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, LogIn, PauseCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useTenant } from "@/contexts/TenantContext";
import { useBrand } from "@/contexts/BrandContext";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/hooks/useTheme";
import { usePageTitle } from "@/hooks/usePageTitle";
import { supabase } from "@/integrations/supabase/client";
import { motivoDoServidor } from "@/lib/erroDeFuncao";
import { cn } from "@/lib/utils";

// ───────────────────────── Auxiliares ─────────────────────────

/** Sigla de até 2 letras para o lockup de texto ("Clínica Sorriso" → "CS"). */
function siglaDe(nome: string): string {
  const palavras = nome
    .trim()
    .split(/\s+/)
    .map((p) => p.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  if (palavras.length === 0) return "•";
  if (palavras.length === 1) return palavras[0].slice(0, 2).toUpperCase();
  return (palavras[0][0] + palavras[palavras.length - 1][0]).toUpperCase();
}

/** Só aceita imagem de fundo por http(s) ou caminho do próprio site. */
function urlDeFundoSegura(url: string | null | undefined): string | null {
  const u = url?.trim();
  if (!u) return null;
  if (/^https?:\/\//i.test(u) || (u.startsWith("/") && !u.startsWith("//"))) return u;
  return null;
}

/** Destino depois do login, pelo papel (mesma regra de antes). */
function destinoPorPapel(papel: string | null | undefined): string {
  if (papel === "posvenda") return "/crm";
  if (papel === "recepcao") return "/crm/recepcao";
  if (papel === "closer") return "/crm/closer";
  if (papel === "sdr") return "/crm/sdr";
  return "/dashboard";
}

// ───────────────────────── Marca ─────────────────────────

function LockupDeTexto({ nome }: { nome: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden
        className="gradient-brand flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-base font-bold text-primary-foreground shadow-brand"
      >
        {siglaDe(nome)}
      </span>
      <span className="max-w-56 truncate text-xl font-bold leading-tight tracking-tight text-foreground">{nome}</span>
    </div>
  );
}

/** Logo com queda para o lockup de texto se a imagem não carregar. */
function LogoDaMarca({ url, nome }: { url: string | null; nome: string }) {
  const [falhou, setFalhou] = useState(false);
  if (!url || falhou) return <LockupDeTexto nome={nome} />;
  return (
    <img
      src={url}
      alt={nome}
      className="h-12 max-w-56 object-contain"
      onError={() => setFalhou(true)}
    />
  );
}

/** Fundo do login: imagem do cliente com véu, ou gradiente sutil da marca. */
function FundoDoLogin({ imagem, children }: { imagem: string | null; children: ReactNode }) {
  return (
    <div
      className={cn(
        "relative flex min-h-screen flex-col items-center justify-center px-4 py-10",
        // A escala brand espelha no escuro (brand-50 é o tom mais escuro), então
        // o mesmo gradiente serve aos dois modos.
        !imagem && "bg-gradient-to-b from-brand-50 to-background",
        imagem && "bg-background",
      )}
    >
      {imagem && (
        <>
          <div
            aria-hidden
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${JSON.stringify(imagem)})` }}
          />
          <div aria-hidden className="absolute inset-0 bg-background/80" />
        </>
      )}
      <div className="relative w-full max-w-md">{children}</div>
    </div>
  );
}

// ───────────────────────── Tela ─────────────────────────

const TenantLogin = () => {
  usePageTitle("Entrar");
  const navigate = useNavigate();
  const { tenant: tenantLegado } = useTenant();
  const { system, tenant, effective, loading: marcaCarregando, notFound } = useBrand();
  const { theme } = useTheme();
  const { refreshProfile } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Slug do endereço (vem do TenantProvider mesmo se a RPC da marca falhar).
  const slug = tenant?.slug || tenantLegado.slug;
  const pausado = tenant?.status === "paused";
  const nome = effective.name;
  const logo = theme === "dark" ? effective.logoDarkUrl ?? effective.logoUrl : effective.logoUrl;

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    if (enviando || pausado) return;
    if (!slug) {
      setErro("Cliente não identificado neste endereço.");
      return;
    }
    setErro(null);
    setEnviando(true);
    try {
      const { data, error } = await supabase.functions.invoke("tenant-login", {
        body: { slug, email: email.trim(), password },
      });
      const corpo = data as { error?: string; session?: { access_token?: string; refresh_token?: string } } | null;
      if (error || corpo?.error) {
        setErro(await motivoDoServidor(data, error, "Não foi possível entrar. Tente novamente."));
        setEnviando(false);
        return;
      }
      const sess = corpo?.session;
      if (!sess?.access_token || !sess?.refresh_token) {
        setErro("Resposta inválida do servidor.");
        setEnviando(false);
        return;
      }
      const { error: setErr } = await supabase.auth.setSession({
        access_token: sess.access_token,
        refresh_token: sess.refresh_token,
      });
      if (setErr) {
        setErro(setErr.message);
        setEnviando(false);
        return;
      }
      const dashboardWarmup = import("./Dashboard")
        .then(({ prefetchDashboardData }) => prefetchDashboardData())
        .catch(() => undefined);
      await refreshProfile();

      // Papel e troca de senha obrigatória decidem o destino.
      const {
        data: { user },
      } = await supabase.auth.getUser();
      let target = "/dashboard";
      let trocarSenha = false;
      if (user) {
        const [{ data: roleRow }, { data: perfil }] = await Promise.all([
          supabase.from("user_roles").select("role").eq("user_id", user.id).maybeSingle(),
          supabase.from("profiles").select("must_change_password").eq("id", user.id).maybeSingle(),
        ]);
        target = destinoPorPapel((roleRow as { role?: string } | null)?.role);
        trocarSenha = (perfil as { must_change_password?: boolean } | null)?.must_change_password === true;
      }
      if (trocarSenha) {
        // O ProtectedRoute também força essa troca; aqui só evita o desvio.
        navigate("/change-password", { replace: true });
        return;
      }
      // Veio de um fluxo que exige login (ex.: consentimento OAuth): honra ?next=.
      const nextParam = new URLSearchParams(window.location.search).get("next");
      if (nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")) {
        target = nextParam;
      }
      if (target === "/dashboard") await dashboardWarmup;
      navigate(target);
    } catch (err) {
      setErro((err as { message?: string })?.message || "Erro inesperado.");
      setEnviando(false);
    }
  };

  // ── Carregando (1ª visita, sem marca em cache) ──
  if (marcaCarregando) {
    return (
      <FundoDoLogin imagem={null}>
        <div
          className="rounded-2xl border border-border bg-card p-8 shadow-card"
          aria-busy="true"
          aria-live="polite"
        >
          <h1 className="sr-only">Acesso da equipe</h1>
          <span className="sr-only">Carregando…</span>
          <div className="mb-8 flex flex-col items-center gap-4">
            <Skeleton className="h-12 w-40" />
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-4 w-44" />
          </div>
          <div className="space-y-5">
            <div className="space-y-2">
              <Skeleton className="h-4 w-14" />
              <Skeleton className="h-10 w-full" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-10 w-full" />
            </div>
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
      </FundoDoLogin>
    );
  }

  // ── Endereço não encontrado: marca do sistema ──
  // Sem botão de "página inicial": o <a href="/"> levava o funcionário da
  // clínica ao login do ADMIN da plataforma, que não é para ele.
  if (notFound) {
    const logoSistema = theme === "dark" ? system.logo_dark_url ?? system.logo_url : system.logo_url;
    // Por caminho (/<slug>) mostra o caminho; por subdomínio, o host.
    const endereco = slug
      ? window.location.pathname.split("/")[1] === slug ? `/${slug}` : window.location.hostname
      : null;
    return (
      <FundoDoLogin imagem={null}>
        <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-card">
          <div className="mb-6 flex justify-center">
            <LogoDaMarca key={logoSistema ?? "sem-logo"} url={logoSistema} nome={system.name} />
          </div>
          <h1 className="mb-2 text-xl font-bold text-foreground">Endereço não encontrado</h1>
          <p className="text-sm text-muted-foreground">
            {endereco ? (
              <>
                O endereço <span className="font-medium text-foreground">{endereco}</span> não corresponde a
                nenhuma clínica ativa.
              </>
            ) : (
              "Este endereço não corresponde a nenhuma clínica ativa."
            )}{" "}
            Confira o link com a sua clínica.
          </p>
        </div>
      </FundoDoLogin>
    );
  }

  const titulo = tenant?.login_title ?? `Acesso da equipe — ${nome}`;
  const subtitulo = tenant?.login_subtitle ?? "Entre com seu e-mail e senha.";
  const rodape = tenant?.login_footer ?? null;
  // "Powered by" só faz sentido quando a marca na tela é a do cliente.
  const mostrarPoweredBy = !!tenant && effective.poweredBy;

  return (
    <FundoDoLogin imagem={urlDeFundoSegura(tenant?.login_bg_url)}>
      <div className="animate-fade-in">
        <div className="rounded-2xl border border-border bg-card p-8 shadow-card">
          <div className="mb-8 flex flex-col items-center gap-4">
            <LogoDaMarca key={logo ?? "sem-logo"} url={logo} nome={nome} />
            <div className="text-center">
              <h1 className="text-xl font-bold text-foreground">{titulo}</h1>
              {subtitulo && <p className="mt-1 text-sm text-muted-foreground">{subtitulo}</p>}
            </div>
          </div>

          {pausado && (
            <div
              role="alert"
              className="mb-6 flex items-start gap-3 rounded-lg border border-warning/50 bg-warning/10 p-4 text-sm text-foreground"
            >
              <PauseCircle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
              <p>O acesso desta clínica está pausado. Fale com o responsável.</p>
            </div>
          )}

          <form onSubmit={handleLogin}>
            <fieldset disabled={pausado || enviando} className="min-w-0 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="username"
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
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="bg-secondary border-border pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {erro && (
                <p role="alert" className="text-sm text-destructive">
                  {erro}
                </p>
              )}

              <Button type="submit" className="w-full font-semibold">
                {enviando ? (
                  <span className="animate-pulse">Entrando…</span>
                ) : (
                  <>
                    <LogIn size={18} aria-hidden />
                    Entrar
                  </>
                )}
              </Button>
            </fieldset>
          </form>
        </div>

        {(rodape || mostrarPoweredBy) && (
          <div className="mt-6 space-y-1 text-center text-xs text-muted-foreground">
            {rodape && <p className="whitespace-pre-line">{rodape}</p>}
            {mostrarPoweredBy && <p>Powered by {system.name}</p>}
          </div>
        )}
      </div>
    </FundoDoLogin>
  );
};

export default TenantLogin;
