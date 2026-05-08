import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

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
  logo_url: null,
  primary_color: null,
};

const TenantContext = createContext<{ tenant: TenantBranding; loading: boolean }>({
  tenant: DEFAULT_TENANT,
  loading: true,
});

function getSlugFromHost(): string | null {
  if (typeof window === "undefined") return null;
  const host = window.location.hostname;
  // Skip lovable preview/sandbox hosts and bare apex
  if (host.includes("lovable.app") || host.includes("lovable.dev") || host === "localhost" || host.startsWith("127.")) {
    return null;
  }
  const parts = host.split(".");
  // e.g. clinica.crclin.com.br -> ["clinica","crclin","com","br"]
  if (parts.length >= 3 && parts[0] !== "www" && parts[0] !== "admin" && parts[0] !== "crclin") {
    return parts[0];
  }
  return null;
}

export const TenantProvider = ({ children }: { children: ReactNode }) => {
  const [tenant, setTenant] = useState<TenantBranding>(DEFAULT_TENANT);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const slug = getSlugFromHost();
    // On Lovable preview/sandbox/localhost, default to Rizodent branding
    const fallbackSlug = slug || "rizodent";
    (async () => {
      const { data } = await supabase
        .from("tenants")
        .select("id, slug, name, logo_url, primary_color")
        .eq("slug", fallbackSlug)
        .maybeSingle();
      if (data) {
        setTenant({
          id: data.id,
          slug: data.slug,
          name: data.name,
          logo_url: data.logo_url,
          primary_color: data.primary_color,
        });
        if (data.primary_color) {
          document.documentElement.style.setProperty("--tenant-primary", data.primary_color);
        }
        document.title = data.name;
      }
      setLoading(false);
    })();
  }, []);

  return <TenantContext.Provider value={{ tenant, loading }}>{children}</TenantContext.Provider>;
};

export const useTenant = () => useContext(TenantContext);
