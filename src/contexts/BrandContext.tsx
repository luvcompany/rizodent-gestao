// Marca do sistema + do cliente, lida da RPC pública get_public_branding.
//
// - Cache em localStorage 'crm:brand_v2:<slug|__sistema__>' (a versão segue
//   VERSAO_GERADOR_TEMA): aplica na hora e SEMPRE revalida com a RPC.
// - O tema (<style id="brand-theme">) só é reaplicado quando a versão da marca
//   (system.version / tenant.version) ou a do gerador de CSS muda.
// - "Cliente não encontrado" não vai para o cache.
// - Favicon e fonte da marca também são aplicados aqui.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  CHAVE_CACHE_DA_MARCA,
  FONTE_PADRAO,
  SISTEMA_PADRAO,
  VERSAO_GERADOR_TEMA,
  aplicarTemaDaMarca,
  chaveDaMarca,
  esquecerCssDaMarca,
  fontePermitida,
  resolverMarcaEfetiva,
  type EffectiveBrand,
  type SystemBrand,
  type SystemLegal,
  type TenantBrand,
} from "@/lib/brand/theme";

export type { EffectiveBrand, SystemBrand, TenantBrand } from "@/lib/brand/theme";

export interface BrandState {
  system: SystemBrand;
  tenant: TenantBrand | null;
  effective: EffectiveBrand;
  /** true só na 1ª carga sem cache, enquanto a RPC não responde. */
  loading: boolean;
  /** Havia slug e a RPC respondeu que não existe cliente com ele. */
  notFound: boolean;
}

const CHAVE_CACHE = (slug: string | null) => CHAVE_CACHE_DA_MARCA(slug);
const FAVICON_PADRAO = "/favicon.ico";

// ───────────────────────── Normalização ─────────────────────────

function txt(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

type Bruto = Record<string, unknown>;

/** Objeto não nulo (e não array) vindo da RPC ou do cache. */
function objeto(v: unknown): Bruto | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Bruto) : null;
}

function normalizarLegal(entrada: unknown): SystemLegal | null {
  const raw = objeto(entrada);
  if (!raw) return null;
  return {
    operator: txt(raw.operator),
    doc: txt(raw.doc),
    email: txt(raw.email),
    address: txt(raw.address),
    updated_at: txt(raw.updated_at),
  };
}

function normalizarSistema(entrada: unknown): SystemBrand {
  const raw = objeto(entrada);
  if (!raw) return SISTEMA_PADRAO;
  return {
    name: txt(raw.name) ?? SISTEMA_PADRAO.name,
    short_name: txt(raw.short_name) ?? txt(raw.name) ?? SISTEMA_PADRAO.short_name,
    tagline: txt(raw.tagline),
    logo_url: txt(raw.logo_url),
    logo_dark_url: txt(raw.logo_dark_url),
    favicon_url: txt(raw.favicon_url),
    primary_color: txt(raw.primary_color) ?? SISTEMA_PADRAO.primary_color,
    primary_color_dark: txt(raw.primary_color_dark),
    secondary_color: txt(raw.secondary_color),
    font_family: txt(raw.font_family) ?? SISTEMA_PADRAO.font_family,
    radius_px: num(raw.radius_px) ?? SISTEMA_PADRAO.radius_px,
    primary_domain: txt(raw.primary_domain),
    support_email: txt(raw.support_email),
    legal: normalizarLegal(raw.legal),
    version: num(raw.version),
  };
}

function normalizarCliente(entrada: unknown, slug: string | null): TenantBrand | null {
  const raw = objeto(entrada);
  const id = txt(raw?.id);
  if (!raw || !id) return null;
  return {
    id,
    slug: txt(raw.slug) ?? slug ?? "",
    status: raw.status === "paused" ? "paused" : "active",
    name: txt(raw.name) ?? "",
    logo_url: txt(raw.logo_url),
    logo_dark_url: txt(raw.logo_dark_url),
    favicon_url: txt(raw.favicon_url),
    primary_color: txt(raw.primary_color),
    primary_color_dark: txt(raw.primary_color_dark),
    secondary_color: txt(raw.secondary_color),
    font_family: txt(raw.font_family),
    radius_px: num(raw.radius_px),
    login_title: txt(raw.login_title),
    login_subtitle: txt(raw.login_subtitle),
    login_footer: txt(raw.login_footer),
    login_bg_url: txt(raw.login_bg_url),
    hide_system_brand: raw.hide_system_brand === true,
    version: num(raw.version),
  };
}

// ───────────────────────── Cache ─────────────────────────

interface Cache {
  system: SystemBrand;
  tenant: TenantBrand | null;
}

function lerCache(slug: string | null): Cache | null {
  try {
    const raw = localStorage.getItem(CHAVE_CACHE(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.system) return null;
    const system = normalizarSistema(parsed.system);
    const tenant = normalizarCliente(parsed.tenant, slug);
    // Com slug, cache sem cliente é inválido (não guardamos "não encontrado").
    if (slug && !tenant) return null;
    return { system, tenant };
  } catch {
    return null;
  }
}

function gravarCache(slug: string | null, dados: Cache) {
  try {
    localStorage.setItem(CHAVE_CACHE(slug), JSON.stringify({ ...dados, ts: Date.now() }));
  } catch {
    /* armazenamento bloqueado ou cheio: segue sem cache */
  }
}

function apagarCache(slug: string | null) {
  try {
    localStorage.removeItem(CHAVE_CACHE(slug));
  } catch {
    /* ignora */
  }
  esquecerCssDaMarca(slug);
}

// ───────────────────────── Efeitos no documento ─────────────────────────

function aplicarFavicon(url: string | null) {
  const href = url || FAVICON_PADRAO;
  let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  if (link.getAttribute("href") === href) return;
  link.setAttribute("href", href);
  if (href === FAVICON_PADRAO) link.type = "image/x-icon";
  else link.removeAttribute("type"); // png/webp/ico enviados: o navegador identifica.
}

const ID_FONTE = "brand-font";

function aplicarFonte(fonte: string) {
  const f = fontePermitida(fonte);
  const existente = document.getElementById(ID_FONTE) as HTMLLinkElement | null;
  if (f === FONTE_PADRAO) {
    existente?.remove(); // Inter já vem do index.css.
    return;
  }
  const href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@300;400;500;600;700;800&display=swap`;
  if (existente) {
    if (existente.href !== href) existente.href = href;
    return;
  }
  const link = document.createElement("link");
  link.id = ID_FONTE;
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

// Título da aba: nome da marca, com a página na frente quando uma tela chama
// usePageTitle. Guardado aqui para o provider e o hook não se sobrescreverem.
let paginaDoTitulo: string | undefined;
let nomeDoTitulo = "";

function renderizarTitulo() {
  if (!nomeDoTitulo) return;
  document.title = paginaDoTitulo ? `${paginaDoTitulo} · ${nomeDoTitulo}` : nomeDoTitulo;
}

/** Uso interno de usePageTitle. */
export function registrarPaginaNoTitulo(pagina: string | undefined, nome: string) {
  paginaDoTitulo = pagina;
  if (nome) nomeDoTitulo = nome;
  renderizarTitulo();
}

function assinaturaDaVersao(system: SystemBrand, tenant: TenantBrand | null, effective: EffectiveBrand): string {
  // A versão do gerador entra sempre: CSS de um gerador antigo nunca é tido
  // como "já aplicado".
  const gerador = `g${VERSAO_GERADOR_TEMA}`;
  // Sem número de versão (payload antigo), compara pela própria marca efetiva.
  if (system.version == null || (tenant && tenant.version == null)) return `${gerador}|x:${JSON.stringify(effective)}`;
  return `${gerador}|v:${system.version}|${tenant?.id ?? "-"}|${tenant?.version ?? "-"}`;
}

// ───────────────────────── Contexto ─────────────────────────

const efetivaPadrao = resolverMarcaEfetiva(SISTEMA_PADRAO, null);

const BrandContext = createContext<BrandState>({
  system: SISTEMA_PADRAO,
  tenant: null,
  effective: efetivaPadrao,
  loading: true,
  notFound: false,
});

export function BrandProvider({ slug = null, children }: { slug?: string | null; children: ReactNode }) {
  const slugNormalizado = slug ? slug.trim().toLowerCase() || null : null;

  const [estado, setEstado] = useState<{ system: SystemBrand; tenant: TenantBrand | null; loading: boolean; notFound: boolean }>(
    () => {
      const cache = lerCache(slugNormalizado);
      return cache
        ? { system: cache.system, tenant: cache.tenant, loading: false, notFound: false }
        : { system: SISTEMA_PADRAO, tenant: null, loading: true, notFound: false };
    },
  );
  const ultimaAssinatura = useRef<string | null>(null);

  // Troca de slug (não acontece hoje, mas o provider não pode ficar preso ao 1º).
  const slugAnterior = useRef(slugNormalizado);
  useEffect(() => {
    if (slugAnterior.current === slugNormalizado) return;
    slugAnterior.current = slugNormalizado;
    ultimaAssinatura.current = null;
    const cache = lerCache(slugNormalizado);
    setEstado(
      cache
        ? { system: cache.system, tenant: cache.tenant, loading: false, notFound: false }
        : { system: SISTEMA_PADRAO, tenant: null, loading: true, notFound: false },
    );
  }, [slugNormalizado]);

  // Revalida sempre com a RPC.
  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        // Sem slug o parâmetro é omitido: o default da função é NULL (marca do sistema).
        const { data, error } = await supabase.rpc(
          "get_public_branding",
          slugNormalizado ? { _slug: slugNormalizado } : {},
        );
        if (cancelado) return;
        if (error) throw error;
        const payload = objeto(Array.isArray(data) ? data[0] : data);
        const system = normalizarSistema(payload?.system);
        const tenant = normalizarCliente(payload?.tenant, slugNormalizado);
        if (slugNormalizado && !tenant) {
          apagarCache(slugNormalizado);
          setEstado({ system, tenant: null, loading: false, notFound: true });
          return;
        }
        gravarCache(slugNormalizado, { system, tenant });
        setEstado({ system, tenant, loading: false, notFound: false });
      } catch (err) {
        if (cancelado) return;
        // Falha de rede/RPC: mantém o que já estava (cache ou padrão) sem
        // afirmar que o cliente não existe.
        console.warn("[marca] não foi possível carregar a marca:", (err as { message?: string })?.message ?? err);
        setEstado((atual) => (atual.loading ? { ...atual, loading: false } : atual));
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [slugNormalizado]);

  const effective = useMemo(() => resolverMarcaEfetiva(estado.system, estado.tenant), [estado.system, estado.tenant]);

  // Tema, favicon e fonte: só quando a versão da marca muda.
  useEffect(() => {
    // Na 1ª carga sem cache, o index.html pode ter injetado o CSS salvo: não
    // sobrescrever com o azul padrão antes de a RPC responder.
    if (estado.loading) return;
    const assinatura = `${chaveDaMarca(slugNormalizado)}#${assinaturaDaVersao(estado.system, estado.tenant, effective)}`;
    if (ultimaAssinatura.current === assinatura) return;
    ultimaAssinatura.current = assinatura;
    aplicarTemaDaMarca(effective, slugNormalizado);
    aplicarFavicon(effective.faviconUrl);
    aplicarFonte(effective.fontFamily);
  }, [effective, estado.loading, estado.system, estado.tenant, slugNormalizado]);

  // Título base da aba (usePageTitle acrescenta a página).
  useEffect(() => {
    if (estado.loading) return;
    nomeDoTitulo = effective.name;
    renderizarTitulo();
  }, [effective.name, estado.loading]);

  const valor = useMemo<BrandState>(
    () => ({ system: estado.system, tenant: estado.tenant, effective, loading: estado.loading, notFound: estado.notFound }),
    [estado, effective],
  );

  return <BrandContext.Provider value={valor}>{children}</BrandContext.Provider>;
}

export function useBrand(): BrandState {
  return useContext(BrandContext);
}
