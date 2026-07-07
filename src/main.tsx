import { createRoot } from "react-dom/client";
import { PublicApp, TenantApp } from "./App.tsx";
import "./index.css";

const RESERVED_PATHS = new Set(["", "admin", "change-password", "crclin", "privacidade", "termos", "exclusao-de-dados"]);
const SUBDOMAIN_SKIP = new Set(["www", "admin", "crclin"]);

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
} else if (firstSegment && !RESERVED_PATHS.has(firstSegment)) {
  mode = "tenant";
  resolvedSlug = firstSegment;
  basename = `/${firstSegment}`;
} else {
  mode = "public";
  basename = "";
}

const root = createRoot(document.getElementById("root")!);
root.render(
  mode === "public"
    ? <PublicApp basename={basename} />
    : <TenantApp slug={resolvedSlug!} basename={basename} />
);
