import { createRoot } from "react-dom/client";
import { PublicApp, TenantApp } from "./App.tsx";
import { RESERVED_PATHS } from "./lib/rotasReservadas";
import { recarregarUmaVez } from "./lib/recarregarAposPublicacao";
import "./lib/renovarSessaoFuncoes";
import "./index.css";

// Subdomínios do próprio sistema que não são clínica (app.dominio, api.dominio…).
const SUBDOMAIN_SKIP = new Set(["www", "admin", "app", "api"]);

function getSubdomainSlug(): string | null {
  const host = window.location.hostname;
  if (
    host.includes("lovable.app") ||
    host.includes("lovable.dev") ||
    host.includes("lovableproject.com") ||
    host.includes("lovable.host") ||
    host === "localhost" ||
    host.startsWith("127.")
  ) {
    return null;
  }
  const parts = host.split(".");
  // Domínios de dois níveis (crclin.com.br) precisam de 4 partes para ter subdomínio.
  const minParts = /\.(com|net|org|co)\.[a-z]{2}$/.test(host) ? 4 : 3;
  if (parts.length >= minParts && !SUBDOMAIN_SKIP.has(parts[0])) return parts[0];
  return null;
}

const path = window.location.pathname;
const subdomainSlug = getSubdomainSlug();
const firstSegment = path.split("/")[1] || "";

let mode: "public" | "tenant";
let basename = "";
let resolvedSlug: string | null = null;

if (subdomainSlug) {
  mode = "tenant";
  resolvedSlug = subdomainSlug;
  basename = "";
} else if (firstSegment && !RESERVED_PATHS.has(firstSegment) && firstSegment !== ".lovable") {
  // ".lovable" é a tela de consentimento OAuth do app público, não um slug.
  mode = "tenant";
  resolvedSlug = firstSegment;
  basename = `/${firstSegment}`;
} else {
  mode = "public";
  basename = "";
}

// Aba aberta numa versão antiga: o pedaço de código não existe mais no servidor.
// Recarrega uma vez; se já recarregou agora, deixa o erro seguir para a barreira.
window.addEventListener("vite:preloadError", (ev) => {
  if (recarregarUmaVez()) ev.preventDefault();
});

// Chamada a função do servidor com sessão vencida/ausente (401) não é falha da
// tela: quem chamou já trata o erro; aqui só impedimos que uma promessa sem
// catch derrube a página inteira.
window.addEventListener("unhandledrejection", (ev) => {
  const r = ev.reason as { name?: string; context?: { status?: number } } | undefined;
  if (r?.name === "FunctionsHttpError" && r.context?.status === 401) {
    ev.preventDefault();
    console.warn("[auth] chamada sem sessão válida ignorada:", r);
  }
});

const root = createRoot(document.getElementById("root")!);
root.render(
  mode === "public"
    ? <PublicApp basename={basename} />
    : <TenantApp slug={resolvedSlug!} basename={basename} />
);
