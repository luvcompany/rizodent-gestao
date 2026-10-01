// Camada fina de compatibilidade sobre o BrandProvider.
//
// A marca (tema, favicon, fonte, título) é resolvida e aplicada pelo
// BrandContext a partir da RPC get_public_branding. Este arquivo só mantém a
// API antiga (TenantProvider / useTenant / CRCLIN_DEFAULT_LOGO), usada por
// vários consumidores.
import { createContext, useContext, useMemo, type ReactNode } from "react";
import crclinLogo from "@/assets/crclin-logo-full.png";
import { BrandProvider, useBrand } from "@/contexts/BrandContext";

/** Logo padrão do sistema (asset local), usada quando nem cliente nem sistema têm logo. */
export const CRCLIN_DEFAULT_LOGO = crclinLogo;

export interface TenantBranding {
  /** null quando não há cliente (app público) ou o endereço não existe. */
  id: string | null;
  slug: string | null;
  name: string;
  logo_url: string | null;
  logo_dark_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  /** Descontinuado: sempre null. */
  tertiary_color: string | null;
  favicon_url: string | null;
  branding_version: number;
  status: "active" | "paused" | null;
  primary_color_dark: string | null;
  login_title: string | null;
  login_subtitle: string | null;
  login_footer: string | null;
  login_bg_url: string | null;
  hide_system_brand: boolean;
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
  status: null,
  primary_color_dark: null,
  login_title: null,
  login_subtitle: null,
  login_footer: null,
  login_bg_url: null,
  hide_system_brand: false,
};

const TenantContext = createContext<{ tenant: TenantBranding; loading: boolean }>({
  tenant: DEFAULT_TENANT,
  loading: true,
});

interface ProviderProps {
  children: ReactNode;
  slugOverride?: string | null;
}

function TenantBridge({ slug, children }: { slug: string | null; children: ReactNode }) {
  const { system, tenant, effective, loading } = useBrand();

  const valor = useMemo(() => {
    const branding: TenantBranding = {
      id: tenant?.id ?? null,
      slug: tenant?.slug ?? slug,
      name: tenant?.name || system.name,
      logo_url: effective.logoUrl || crclinLogo,
      logo_dark_url: effective.logoDarkUrl,
      primary_color: tenant?.primary_color ?? null,
      secondary_color: tenant?.secondary_color ?? null,
      tertiary_color: null,
      favicon_url: tenant?.favicon_url ?? null,
      branding_version: tenant?.version ?? 1,
      status: tenant?.status ?? null,
      primary_color_dark: tenant?.primary_color_dark ?? null,
      login_title: tenant?.login_title ?? null,
      login_subtitle: tenant?.login_subtitle ?? null,
      login_footer: tenant?.login_footer ?? null,
      login_bg_url: tenant?.login_bg_url ?? null,
      hide_system_brand: tenant?.hide_system_brand ?? false,
    };
    return { tenant: branding, loading };
  }, [system.name, tenant, effective.logoUrl, effective.logoDarkUrl, loading, slug]);

  return <TenantContext.Provider value={valor}>{children}</TenantContext.Provider>;
}

export const TenantProvider = ({ children, slugOverride = null }: ProviderProps) => (
  <BrandProvider slug={slugOverride}>
    <TenantBridge slug={slugOverride}>{children}</TenantBridge>
  </BrandProvider>
);

export const useTenant = () => useContext(TenantContext);
