import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import crclinLogo from "@/assets/crclin-logo-full.png";

export const CRCLIN_DEFAULT_LOGO = crclinLogo;

interface TenantBranding {
  id: string | null;
  slug: string | null;
  name: string;
  logo_url: string | null;
  primary_color: string | null;
}

const DEFAULT_TENANT: TenantBranding = {
  id: null,
  slug: null,
  name: "CRClin",
  logo_url: crclinLogo,
  primary_color: null,
};
const TENANT_CACHE_TTL = 60 * 60_000;
const TENANT_CACHE_KEY = "crm:tenant_cache_v1";

const TenantContext = createContext<{ tenant: TenantBranding; loading: boolean }>({
  tenant: DEFAULT_TENANT,
  loading: true,
});

interface ProviderProps {
  children: ReactNode;
  slugOverride?: string | null;
}

/** Convert "#rrggbb" or "rgb()" to "h s% l%" string for Tailwind hsl(var(--x)) usage. */
function hexToHslTriplet(input: string): string | null {
  if (!input) return null;
  let r = 0, g = 0, b = 0;
  const hex = input.trim().replace("#", "");
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
  } else if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    r = parseInt(hex[0] + hex[0], 16);
    g = parseInt(hex[1] + hex[1], 16);
    b = parseInt(hex[2] + hex[2], 16);
  } else {
    return null;
  }
  const rN = r / 255, gN = g / 255, bN = b / 255;
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

function applyPrimaryColor(hex: string | null) {
  const root = document.documentElement;
  if (!hex) {
    root.style.removeProperty("--primary");
    root.style.removeProperty("--accent");
    root.style.removeProperty("--ring");
    root.style.removeProperty("--gradient-orange");
    root.style.removeProperty("--shadow-orange");
    root.style.removeProperty("--tenant-primary");
    return;
  }
  const triplet = hexToHslTriplet(hex);
  if (!triplet) return;
  root.style.setProperty("--primary", triplet);
  root.style.setProperty("--accent", triplet);
  root.style.setProperty("--ring", triplet);
  root.style.setProperty(
    "--gradient-orange",
    `linear-gradient(135deg, hsl(${triplet}) 0%, hsl(${triplet} / 0.85) 100%)`
  );
  // shadow uses the same hue with reduced alpha
  const [h, s] = triplet.split(" ");
  const sNum = s.replace("%", "");
  root.style.setProperty(
    "--shadow-orange",
    `0 4px 20px -4px hsla(${h}, ${sNum}%, 50%, 0.3)`
  );
  root.style.setProperty("--tenant-primary", hex);
}

function readTenantCache(slug: string | null) {
  if (!slug) return null;
  try {
    const raw = localStorage.getItem(`${TENANT_CACHE_KEY}:${slug}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.ts > TENANT_CACHE_TTL) return null;
    return parsed.data as TenantBranding;
  } catch {
    return null;
  }
}

function writeTenantCache(slug: string, data: TenantBranding) {
  try {
    localStorage.setItem(`${TENANT_CACHE_KEY}:${slug}`, JSON.stringify({ data, ts: Date.now() }));
  } catch {}
}

export const TenantProvider = ({ children, slugOverride = null }: ProviderProps) => {
  const [tenant, setTenant] = useState<TenantBranding>(() => readTenantCache(slugOverride) || DEFAULT_TENANT);
  const [loading, setLoading] = useState(() => !readTenantCache(slugOverride) && !!slugOverride);

  useEffect(() => {
    if (!slugOverride) {
      applyPrimaryColor(null);
      setLoading(false);
      return;
    }
    const cached = readTenantCache(slugOverride);
    if (cached) {
      setTenant(cached);
      applyPrimaryColor(cached.primary_color || null);
      document.title = cached.name;
      setLoading(false);
    }
    (async () => {
      const { data: rows } = await (supabase as any).rpc("get_tenant_by_slug", { _slug: slugOverride });
      const data = Array.isArray(rows) ? rows[0] : rows;
      if (data) {
        const nextTenant = {
          id: data.id,
          slug: data.slug,
          name: data.name,
          logo_url: data.logo_url || crclinLogo,
          primary_color: data.primary_color,
        };
        setTenant(nextTenant);
        writeTenantCache(slugOverride, nextTenant);
        applyPrimaryColor(data.primary_color || null);
        document.title = data.name;
      } else {
        const fallbackTenant = { ...DEFAULT_TENANT, slug: slugOverride, logo_url: crclinLogo };
        setTenant(fallbackTenant);
        writeTenantCache(slugOverride, fallbackTenant);
        applyPrimaryColor(null);
      }
      setLoading(false);
    })();
  }, [slugOverride]);

  return <TenantContext.Provider value={{ tenant, loading }}>{children}</TenantContext.Provider>;
};

export const useTenant = () => useContext(TenantContext);
