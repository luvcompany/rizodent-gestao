import { createRoot } from "react-dom/client";
import { PublicApp, TenantApp } from "./App.tsx";
import { RESERVED_PATHS } from "./lib/rotasReservadas";
import { recarregarUmaVez } from "./lib/recarregarAposPublicacao";
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
  if (parts.length >= 3 && !SUBDOMAIN_SKIP.has(parts[0])) return parts[0];
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

const root = createRoot(document.getElementById("root")!);
root.render(
  mode === "public"
    ? <PublicApp basename={basename} />
    : <TenantApp slug={resolvedSlug!} basename={basename} />
);
