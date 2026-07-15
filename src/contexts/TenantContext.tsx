import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import crclinLogo from "@/assets/crclin-logo-full.png";

export const CRCLIN_DEFAULT_LOGO = crclinLogo;

interface TenantBranding {
  id: string | null;
  slug: string | null;
  name: string;
  logo_url: string | null;
  logo_dark_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  tertiary_color: string | null;
  favicon_url: string | null;
  branding_version: number;
}

const DEFAULT_TENANT: TenantBranding = {
  id: null,
  slug: null,
  name: "CRClin",
  logo_url: crclinLogo,
  logo_dark_url: null,
  primary_color: null,
  secondary_color: null,
  tertiary_color: null,
  favicon_url: null,
  branding_version: 1,
};
const TENANT_CACHE_TTL = 60 * 60_000;
// v2: cache schema now carries secondary/tertiary colors, favicon, dark logo and branding_version.
// Bumping the key drops any v1 payload that lacks the new fields.
const TENANT_CACHE_KEY = "crm:tenant_cache_v2";

const TenantContext = createContext<{ tenant: TenantBranding; loading: boolean }>({
  tenant: DEFAULT_TENANT,
  loading: true,
});

interface ProviderProps {
  children: ReactNode;
  slugOverride?: string | null;
}

/** Convert "#rrggbb" / "#rgb" to {r,g,b} (0-255), or null when invalid. */
function hexToRgb(input: string): { r: number; g: number; b: number } | null {
  if (!input) return null;
  const hex = input.trim().replace("#", "");
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
    };
  }
  return null;
}

/** Convert "#rrggbb" or "#rgb" to "h s% l%" string for Tailwind hsl(var(--x)) usage. */
function hexToHslTriplet(input: string): string | null {
  const rgb = hexToRgb(input);
  if (!rgb) return null;
  const rN = rgb.r / 255, gN = rgb.g / 255, bN = rgb.b / 255;
  const max = Math.max(rN, gN, bN), min = Math.min(rN, gN, bN);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rN: h = (gN - bN) / d + (gN < bN ? 6 : 0); break;
      case gN: h = (bN - rN) / d + 2; break;
      case bN: h = (rN - gN) / d + 4; break;
    }
    h /= 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/**
 * Pick a readable foreground ("h s% l%" triplet) for a given background hex,
 * using WCAG relative luminance. Light backgrounds get near-black text,
 * dark backgrounds get white text.
 */
function foregroundTripletFor(hex: string | null): string | null {
  const rgb = hexToRgb(hex || "");
  if (!rgb) return null;
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const luminance = 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
  // Threshold ~0.4 gives good contrast for typical brand colors.
  return luminance > 0.4 ? "0 0% 10%" : "0 0% 100%";
}

/**
 * Apply the full tenant theme to CSS custom properties: primary (+ derived
 * gradient/shadow/accent/ring), secondary, tertiary and their luminance-based
 * foregrounds. Passing null clears every property back to the stylesheet default.
 */
function applyTenantTheme(branding: {
  primary_color?: string | null;
  secondary_color?: string | null;
} | null) {
  const root = document.documentElement;
  const primary = branding?.primary_color || null;
  const secondary = branding?.secondary_color || null;

  // IMPORTANTE: NÃO sobrescrever os tokens neutros do shadcn (--secondary,
  // --secondary-foreground, --tertiary). Eles são usados como fundo de inputs e
  // botões secundários; pintá-los com a cor da marca deixava as caixas de texto
  // laranja. A marca é aplicada só via --primary (+ derivados) e no gradiente.
  root.style.removeProperty("--secondary");
  root.style.removeProperty("--secondary-foreground");
  root.style.removeProperty("--tertiary");
  root.style.removeProperty("--tertiary-foreground");

  if (!primary) {
    ["--primary", "--primary-foreground", "--accent", "--ring", "--gradient-orange", "--shadow-orange", "--tenant-primary", "--tenant-secondary"].forEach((p) => root.style.removeProperty(p));
    return;
  }

  const triplet = hexToHslTriplet(primary);
  if (!triplet) return;

  root.style.setProperty("--primary", triplet);
  root.style.setProperty("--accent", triplet);
  root.style.setProperty("--ring", triplet);
  root.style.setProperty("--tenant-primary", primary);
  const fg = foregroundTripletFor(primary);
  if (fg) root.style.setProperty("--primary-foreground", fg);
  else root.style.removeProperty("--primary-foreground");

  const [h, s] = triplet.split(" ");
  const sNum = s.replace("%", "");
  root.style.setProperty("--shadow-orange", `0 4px 20px -4px hsla(${h}, ${sNum}%, 50%, 0.3)`);

  // A cor SECUNDÁRIA da marca é usada como 2º ponto do gradiente (botões/realces),
  // sem tocar no token neutro --secondary.
  const secTriplet = secondary ? hexToHslTriplet(secondary) : null;
  if (secTriplet) {
    root.style.setProperty("--gradient-orange", `linear-gradient(135deg, hsl(${triplet}) 0%, hsl(${secTriplet}) 100%)`);
    root.style.setProperty("--tenant-secondary", secondary);
  } else {
    root.style.setProperty("--gradient-orange", `linear-gradient(135deg, hsl(${triplet}) 0%, hsl(${triplet} / 0.85) 100%)`);
    root.style.removeProperty("--tenant-secondary");
  }
}

/** Normalize an RPC/cached row into a full TenantBranding (defensive about missing new fields). */
function normalizeTenant(data: any, slug: string): TenantBranding {
  return {
    id: data.id ?? null,
    slug: data.slug ?? slug,
    name: data.name ?? "CRClin",
    logo_url: data.logo_url || crclinLogo,
    logo_dark_url: data.logo_dark_url ?? null,
    primary_color: data.primary_color ?? null,
    secondary_color: data.secondary_color ?? null,
    tertiary_color: data.tertiary_color ?? null,
    favicon_url: data.favicon_url ?? null,
    branding_version:
      typeof data.branding_version === "number" ? data.branding_version : 1,
  };
}

function readTenantCache(slug: string | null): TenantBranding | null {
  if (!slug) return null;
  try {
    const raw = localStorage.getItem(`${TENANT_CACHE_KEY}:${slug}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.ts > TENANT_CACHE_TTL) return null;
    const data = parsed.data as TenantBranding;
    // Validate that the payload carries the current branding schema; a payload
    // without branding_version predates the new fields and must be ignored.
    if (!data || typeof data.branding_version !== "number") return null;
    return data;
  } catch {
    return null;
  }
}

function writeTenantCache(slug: string, data: TenantBranding) {
  try {
    localStorage.setItem(
      `${TENANT_CACHE_KEY}:${slug}`,
      // Persist branding_version alongside the payload so a later change bumped
      // by the admin (higher version) overwrites the entry and re-applies theme.
      JSON.stringify({ data, ts: Date.now(), branding_version: data.branding_version })
    );
  } catch {}
}

function applyBranding(tenant: TenantBranding) {
  applyTenantTheme(tenant);
  // Favicon: mantemos SEMPRE o padrão do CRClin (definido no index.html). A logo
  // do cliente como favicon ficava ruim (ícone pequeno/ilegível na aba).
  document.title = tenant.name;
}

export const TenantProvider = ({ children, slugOverride = null }: ProviderProps) => {
  const [tenant, setTenant] = useState<TenantBranding>(() => readTenantCache(slugOverride) || DEFAULT_TENANT);
  const [loading, setLoading] = useState(() => !readTenantCache(slugOverride) && !!slugOverride);

  useEffect(() => {
    if (!slugOverride) {
      applyTenantTheme(null);
      setLoading(false);
      return;
    }
    const cached = readTenantCache(slugOverride);
    if (cached) {
      setTenant(cached);
      applyBranding(cached);
      setLoading(false);
    }
    (async () => {
      const { data: rows } = await (supabase as any).rpc("get_tenant_by_slug", { _slug: slugOverride });
      const data = Array.isArray(rows) ? rows[0] : rows;
      if (data) {
        const nextTenant = normalizeTenant(data, slugOverride);
        setTenant(nextTenant);
        writeTenantCache(slugOverride, nextTenant);
        applyBranding(nextTenant);
      } else {
        const fallbackTenant: TenantBranding = { ...DEFAULT_TENANT, slug: slugOverride, logo_url: crclinLogo };
        setTenant(fallbackTenant);
        writeTenantCache(slugOverride, fallbackTenant);
        applyTenantTheme(null);
        document.title = fallbackTenant.name;
      }
      setLoading(false);
    })();
  }, [slugOverride]);

  return <TenantContext.Provider value={{ tenant, loading }}>{children}</TenantContext.Provider>;
};

export const useTenant = () => useContext(TenantContext);
