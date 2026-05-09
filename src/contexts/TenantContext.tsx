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

const TenantContext = createContext<{ tenant: TenantBranding; loading: boolean }>({
  tenant: DEFAULT_TENANT,
  loading: true,
});

interface ProviderProps {
  children: ReactNode;
  /** Slug resolvido pelo main.tsx (path ou subdomínio). null = modo público. */
  slugOverride?: string | null;
}

export const TenantProvider = ({ children, slugOverride = null }: ProviderProps) => {
  const [tenant, setTenant] = useState<TenantBranding>(DEFAULT_TENANT);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slugOverride) {
      setLoading(false);
      return;
    }
    (async () => {
      const { data: rows } = await (supabase as any).rpc("get_tenant_by_slug", { _slug: slugOverride });
      const data = Array.isArray(rows) ? rows[0] : rows;
      if (data) {
        setTenant({
          id: data.id,
          slug: data.slug,
          name: data.name,
          logo_url: data.logo_url || crclinLogo,
          primary_color: data.primary_color,
        });
        if (data.primary_color) {
          document.documentElement.style.setProperty("--tenant-primary", data.primary_color);
        }
        document.title = data.name;
      } else {
        setTenant({ ...DEFAULT_TENANT, slug: slugOverride });
      }
      setLoading(false);
    })();
  }, [slugOverride]);

  return <TenantContext.Provider value={{ tenant, loading }}>{children}</TenantContext.Provider>;
};

export const useTenant = () => useContext(TenantContext);
