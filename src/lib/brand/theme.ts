// Tema da marca (sistema + cliente) para claro e escuro.
//
// Módulo PURO: nada aqui depende de React. O BrandContext busca a marca na RPC
// get_public_branding, resolve a marca efetiva com resolverMarcaEfetiva e aplica
// com aplicarTemaDaMarca. O admin usa buildBrandCss com `escopo` para a prévia.
//
// Regra de ouro: a marca só pinta tokens de DESTAQUE (primary, ring, accent,
// sidebar-primary, escala brand-*, gradiente, sombra, raio e fonte). Os tokens
// neutros do shadcn (--secondary, --muted, --card, --input, --popover,
// --border) nunca são escritos: pintá-los com a cor da marca deixava caixas de
// texto coloridas.
//
// EXCEÇÃO CONTROLADA (redesign do CRM, gerador v2 — VERSAO_GERADOR_TEMA):
// a marca pode pintar SÓ duas coisas além dos destaques:
//   1. a família --sidebar-* (sidebar sempre escura, "grafite quase preto"
//      derivado da marca, nos dois temas);
//   2. --background e --surface-sunken, com saturação ≤ 14% nos dois temas
//      (fundo levemente tingido; nunca uma caixa colorida).
// --card, --popover, --input, --muted, --secondary e --border continuam
// neutros (matiz fixa no index.css, nunca a da marca). Os testes travam isso.
//
// Onde a exceção vale: só na casca do CRM. Esses tokens saem num bloco próprio
// `html…:root:has(.crm-shell)` do CSS SEM escopo; o /admin (admin.css), as telas
// fora da casca (login, admin/login) e a prévia do admin (buildBrandCss com
// `escopo`) recebem exatamente o CSS de antes. Ver buildBrandCss.

// ───────────────────────── Tipos ─────────────────────────

export interface SystemLegal {
  operator: string | null;
  doc: string | null;
  email: string | null;
  address: string | null;
  updated_at: string | null;
}

/** Marca do sistema (system_settings), como get_public_branding devolve. */
export interface SystemBrand {
  name: string;
  short_name: string | null;
  tagline: string | null;
  logo_url: string | null;
  logo_dark_url: string | null;
  favicon_url: string | null;
  primary_color: string | null;
  primary_color_dark: string | null;
  secondary_color: string | null;
  font_family: string | null;
  radius_px: number | null;
  primary_domain: string | null;
  support_email: string | null;
  legal: SystemLegal | null;
  version: number | null;
}

/** Marca do cliente (tenants), como get_public_branding devolve. */
export interface TenantBrand {
  id: string;
  slug: string;
  status: "active" | "paused";
  name: string;
  logo_url: string | null;
  logo_dark_url: string | null;
  favicon_url: string | null;
  primary_color: string | null;
  primary_color_dark: string | null;
  secondary_color: string | null;
  /** Cor exclusiva dos botões de ação e abas. null = usar primary_color. */
  action_color: string | null;
  font_family: string | null;
  radius_px: number | null;
  login_title: string | null;
  login_subtitle: string | null;
  login_footer: string | null;
  login_bg_url: string | null;
  hide_system_brand: boolean;
  version: number | null;
}

/** Marca que vale na tela: cliente por cima, sistema no que faltar. */
export interface EffectiveBrand {
  name: string;
  shortName: string;
  logoUrl: string | null;
  /** Logo para o modo escuro. null = usar logoUrl. */
  logoDarkUrl: string | null;
  faviconUrl: string | null;
  /** Cor principal (hex #rrggbb) do modo claro. */
  primary: string;
  /** Cor principal do modo escuro. null = derivada de `primary`. */
  primaryDark: string | null;
  /** 2º ponto do gradiente. null = primary escurecida. */
  secondary: string | null;
  /** Cor dos controles de ação; não altera menu, gráficos ou identidade geral. */
  actionColor: string;
  fontFamily: string;
  radiusPx: number;
  /** Mostrar "Powered by <sistema>". */
  poweredBy: boolean;
}

// ───────────────────────── Constantes ─────────────────────────

export const COR_PADRAO_SISTEMA = "#2563eb";
export const FONTE_PADRAO = "Inter";
export const RAIO_PADRAO_PX = 12;

/** Fontes aceitas. Qualquer outra cai em Inter. */
export const FONTES_PERMITIDAS = ["Inter", "Manrope", "Poppins", "DM Sans", "Nunito Sans"] as const;

/** Marca do sistema usada enquanto a RPC não responde e não há cache. */
export const SISTEMA_PADRAO: SystemBrand = {
  name: "CRClin",
  short_name: "CRClin",
  tagline: null,
  logo_url: null,
  logo_dark_url: null,
  favicon_url: null,
  primary_color: COR_PADRAO_SISTEMA,
  primary_color_dark: null,
  secondary_color: null,
  font_family: FONTE_PADRAO,
  radius_px: RAIO_PADRAO_PX,
  primary_domain: null,
  support_email: null,
  legal: null,
  version: null,
};

/** Chave de cache por endereço: o slug do cliente ou "__sistema__". */
export function chaveDaMarca(slug: string | null | undefined): string {
  const s = (slug ?? "").trim().toLowerCase();
  return s || "__sistema__";
}

/**
 * Versão do gerador de CSS da marca. Sobe quando o CSS gerado muda de forma
 * (tokens novos, seletores novos): entra nas chaves de cache (aqui, no
 * BrandContext e no script do index.html) e na assinatura que decide reaplicar
 * o <style id="brand-theme">, para CSS antigo em cache não prender a tela velha.
 */
export const VERSAO_GERADOR_TEMA = "2";

export const CHAVE_CSS_DA_MARCA = (slug: string | null | undefined) =>
  `crm:brand_css:v${VERSAO_GERADOR_TEMA}:${chaveDaMarca(slug)}`;
/** Cache da marca do BrandContext ('crm:brand_v2:<slug|__sistema__>'). */
export const CHAVE_CACHE_DA_MARCA = (slug: string | null | undefined) =>
  `crm:brand_v${VERSAO_GERADOR_TEMA}:${chaveDaMarca(slug)}`;
export const ID_ESTILO_DA_MARCA = "brand-theme";

/** Seletor da casca do CRM (CrmLayout/AppLayout recebem a classe crm-shell). */
export const SELETOR_CASCA_CRM = ":root:has(.crm-shell)";

// ───────────────────────── Cor: conversões ─────────────────────────

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

/** Normaliza "#rgb" / "#rrggbb" (com ou sem #) para "#rrggbb" minúsculo; inválido → null. */
export function normalizarHex(input: string | null | undefined): string | null {
  if (!input || typeof input !== "string") return null;
  const hex = input.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex.toLowerCase()}`;
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return `#${hex
      .split("")
      .map((c) => c + c)
      .join("")
      .toLowerCase()}`;
  }
  return null;
}

function hexParaRgb(input: string): { r: number; g: number; b: number } | null {
  const hex = normalizarHex(input);
  if (!hex) return null;
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

/** "#rrggbb" → {h 0-360, s 0-100, l 0-100}; inválido → null. */
export function hexParaHsl(input: string | null | undefined): Hsl | null {
  const rgb = hexParaRgb(input ?? "");
  if (!rgb) return null;
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

/** {h,s,l} → "#rrggbb". */
export function hslParaHex({ h, s, l }: Hsl): string {
  const sN = limitar(s, 0, 100) / 100;
  const lN = limitar(l, 0, 100) / 100;
  const hN = (((h % 360) + 360) % 360) / 360;
  const hueParaRgb = (p: number, q: number, t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  let r: number;
  let g: number;
  let b: number;
  if (sN === 0) {
    r = g = b = lN;
  } else {
    const q = lN < 0.5 ? lN * (1 + sN) : lN + sN - lN * sN;
    const p = 2 * lN - q;
    r = hueParaRgb(p, q, hN + 1 / 3);
    g = hueParaRgb(p, q, hN);
    b = hueParaRgb(p, q, hN - 1 / 3);
  }
  const hex2 = (v: number) =>
    Math.round(limitar(v, 0, 1) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

/** {h,s,l} → "h s% l%" (formato dos tokens do shadcn: hsl(var(--x))). */
export function hslParaTriplet({ h, s, l }: Hsl): string {
  return `${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%`;
}

/** Como hslParaTriplet, mas com a luminosidade em até 1 casa decimal (96.5%, 7.5%). */
export function hslParaTripletFino({ h, s, l }: Hsl): string {
  return `${Math.round(h)} ${Math.round(s)}% ${Math.round(l * 10) / 10}%`;
}

/** "h s% l%" → {h,s,l}; inválido → null. Aceita decimais. */
export function tripletParaHsl(triplet: string | null | undefined): Hsl | null {
  const m = (triplet ?? "").trim().match(/^(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
  if (!m) return null;
  return { h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) };
}

/** Mistura `frente` sobre `fundo` com opacidade `alfa` (0–1), em RGB. */
export function misturarHex(frente: string, fundo: string, alfa: number): string {
  const a = hexParaRgb(frente);
  const b = hexParaRgb(fundo);
  if (!a || !b) return normalizarHex(frente) ?? "#000000";
  const t = limitar(alfa, 0, 1);
  const c = (x: number, y: number) =>
    Math.round(x * t + y * (1 - t))
      .toString(16)
      .padStart(2, "0");
  return `#${c(a.r, b.r)}${c(a.g, b.g)}${c(a.b, b.b)}`;
}

function limitar(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

// ───────────────────────── Cor: contraste (WCAG) ─────────────────────────

const BRANCO = "#ffffff";
/** Mesmo tom de '222 47% 11%' (texto escuro dos tokens). */
const ESCURO = "#0f172a";
const TRIPLET_BRANCO = "0 0% 100%";
const TRIPLET_ESCURO = "222 47% 11%";

/** Luminância relativa WCAG 2.x (0 = preto, 1 = branco). */
export function luminanciaRelativa(hex: string): number {
  const rgb = hexParaRgb(hex);
  if (!rgb) return 0;
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
}

/** Razão de contraste WCAG entre duas cores (1 a 21). */
export function razaoDeContraste(a: string, b: string): number {
  const la = luminanciaRelativa(a);
  const lb = luminanciaRelativa(b);
  const [claro, escuro] = la >= lb ? [la, lb] : [lb, la];
  return (claro + 0.05) / (escuro + 0.05);
}

/** Texto normal passa no nível AA (≥ 4,5:1)? Cor inválida → false. */
export function contrasteAA(hexFrente: string, hexFundo: string): boolean {
  if (!normalizarHex(hexFrente) || !normalizarHex(hexFundo)) return false;
  return razaoDeContraste(hexFrente, hexFundo) >= 4.5;
}

/**
 * Texto legível sobre a cor: branco ('0 0% 100%') ou quase preto ('222 47% 11%').
 * Branco quando passa em AA ou quando contrasta mais que o escuro.
 */
export function foregroundPara(hex: string): string {
  const cor = normalizarHex(hex);
  if (!cor) return TRIPLET_BRANCO;
  const cBranco = razaoDeContraste(BRANCO, cor);
  const cEscuro = razaoDeContraste(ESCURO, cor);
  return cBranco >= 4.5 || cBranco >= cEscuro ? TRIPLET_BRANCO : TRIPLET_ESCURO;
}

/**
 * Versão da cor para o modo escuro: mesmo matiz, luminosidade mínima de 58% e
 * saturação máxima de 85% (cor saturada e escura some no fundo preto).
 */
export function derivarCorEscura(hex: string): string {
  const hsl = hexParaHsl(hex);
  if (!hsl) return hex;
  return hslParaHex({ h: hsl.h, s: Math.min(hsl.s, 85), l: Math.max(hsl.l, 58) });
}

/**
 * Anda a luminosidade da cor (para baixo no claro, para cima no escuro) até
 * ela passar em AA sobre o fundo. Devolve a própria cor se já passar.
 */
function ajustarParaContraste(cor: Hsl, fundoHex: string, direcao: "escurecer" | "clarear"): Hsl {
  let l = cor.l;
  for (let i = 0; i < 60; i++) {
    const tentativa = { h: cor.h, s: cor.s, l };
    if (contrasteAA(hslParaHex(tentativa), fundoHex)) return tentativa;
    l = direcao === "escurecer" ? l - 2 : l + 2;
    if (l < 0 || l > 100) break;
  }
  return { h: cor.h, s: cor.s, l: limitar(l, 0, 100) };
}

// ───────────────────────── Marca efetiva ─────────────────────────

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function numero(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function fontePermitida(v: unknown): string {
  const f = texto(v);
  return f && (FONTES_PERMITIDAS as readonly string[]).includes(f) ? f : FONTE_PADRAO;
}

/**
 * Campo a campo, vale o do cliente; o que faltar vem do sistema.
 *
 * Exceção deliberada: quando o cliente tem cor principal (ou logo) própria, as
 * variantes dependentes (cor do escuro, secundária, logo do escuro) NÃO herdam
 * as do sistema; são derivadas da do cliente. Senão um cliente vermelho sem cor
 * de escuro ficaria azul no modo escuro, ou mostraria a logo do sistema.
 */
export function resolverMarcaEfetiva(system: SystemBrand, tenant: TenantBrand | null): EffectiveBrand {
  const sys = system ?? SISTEMA_PADRAO;
  const primariaCliente = normalizarHex(tenant?.primary_color);
  const primariaSistema = normalizarHex(sys.primary_color);
  const primary = primariaCliente ?? primariaSistema ?? COR_PADRAO_SISTEMA;

  const primaryDark = primariaCliente
    ? normalizarHex(tenant?.primary_color_dark)
    : normalizarHex(tenant?.primary_color_dark) ?? (primariaSistema ? normalizarHex(sys.primary_color_dark) : null);

  const secondary = primariaCliente
    ? normalizarHex(tenant?.secondary_color)
    : normalizarHex(tenant?.secondary_color) ?? normalizarHex(sys.secondary_color);
  const actionColor = normalizarHex(tenant?.action_color) ?? primary;

  const logoCliente = texto(tenant?.logo_url);
  const logoUrl = logoCliente ?? texto(sys.logo_url);
  const logoDarkUrl = logoCliente ? texto(tenant?.logo_dark_url) : texto(tenant?.logo_dark_url) ?? texto(sys.logo_dark_url);

  const nomeSistema = texto(sys.name) ?? SISTEMA_PADRAO.name;
  const nomeCliente = texto(tenant?.name);

  const raio = numero(tenant?.radius_px) ?? numero(sys.radius_px) ?? RAIO_PADRAO_PX;

  return {
    name: nomeCliente ?? nomeSistema,
    shortName: nomeCliente ?? texto(sys.short_name) ?? nomeSistema,
    logoUrl,
    logoDarkUrl,
    faviconUrl: texto(tenant?.favicon_url) ?? texto(sys.favicon_url),
    primary,
    primaryDark,
    secondary,
    actionColor,
    fontFamily: fontePermitida(texto(tenant?.font_family) ?? texto(sys.font_family)),
    radiusPx: limitar(Math.round(raio), 0, 24),
    poweredBy: !tenant?.hide_system_brand,
  };
}

// ───────────────────────── CSS ─────────────────────────

type Modo = "claro" | "escuro";

const PASSOS_DA_ESCALA = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

/**
 * Escala brand-50…900 no mesmo matiz.
 * Claro: 50=97%, 100=94%, 200=86%, 300=76%, 400=64%, 500=base, 600…900 = base −8/−16/−24/−32.
 * Escuro: a escala espelha (50 é o tom mais escuro), para `bg-brand-50` continuar
 * sendo "fundo sutil da marca" nos dois modos: 50=12%, 100=16%, 200=22%, 300=32%,
 * 400=44%, 500=base, 600…900 = base +8/+16/+24/+32. Limites 5–98.
 */
function escalaDaMarca(base: Hsl, modo: Modo): Record<(typeof PASSOS_DA_ESCALA)[number], string> {
  const fixos: Record<Modo, Record<number, number>> = {
    claro: { 50: 97, 100: 94, 200: 86, 300: 76, 400: 64 },
    escuro: { 50: 12, 100: 16, 200: 22, 300: 32, 400: 44 },
  };
  const sinal = modo === "claro" ? -1 : 1;
  const out = {} as Record<(typeof PASSOS_DA_ESCALA)[number], string>;
  for (const passo of PASSOS_DA_ESCALA) {
    let l: number;
    if (passo < 500) l = fixos[modo][passo];
    else if (passo === 500) l = base.l;
    else l = base.l + sinal * 8 * ((passo - 500) / 100);
    out[passo] = hslParaTriplet({ h: base.h, s: base.s, l: limitar(l, 5, 98) });
  }
  return out;
}

function remDoRaio(px: number): string {
  const rem = Math.round((px / 16) * 1000) / 1000;
  return `${rem}rem`;
}

function pilhaDaFonte(fonte: string): string {
  const f = fontePermitida(fonte);
  return f === FONTE_PADRAO ? `'Inter', sans-serif` : `'${f}', 'Inter', sans-serif`;
}

/** Cor base da marca no modo (claro: primary; escuro: primaryDark ou derivarCorEscura). */
function baseDoModo(effective: EffectiveBrand, modo: Modo): { hex: string; hsl: Hsl } {
  const hex =
    modo === "claro"
      ? normalizarHex(effective.primary) ?? COR_PADRAO_SISTEMA
      : normalizarHex(effective.primaryDark) ?? derivarCorEscura(normalizarHex(effective.primary) ?? COR_PADRAO_SISTEMA);
  return { hex, hsl: hexParaHsl(hex)! };
}

/** Cor dos controles no modo atual; o escuro deriva uma versão legível. */
function baseDaAcaoDoModo(effective: EffectiveBrand, modo: Modo): { hex: string; hsl: Hsl } {
  const action = normalizarHex(effective.actionColor) ?? normalizarHex(effective.primary) ?? COR_PADRAO_SISTEMA;
  const hex = modo === "claro" ? action : derivarCorEscura(action);
  const hsl = hexParaHsl(hex);
  if (!hsl) return baseDoModo(effective, modo);
  return { hex, hsl };
}

/**
 * Como ajustarParaContraste, mas conferindo o resultado já ARREDONDADO do jeito
 * que vai para o CSS (triplet fino), para o arredondamento não custar o AA.
 */
function ajustarParaContrasteNoCss(cor: Hsl, fundo: Hsl, direcao: "escurecer" | "clarear"): Hsl {
  const fundoHex = hslParaHex(tripletParaHsl(hslParaTripletFino(fundo))!);
  let tentativa = ajustarParaContraste(cor, fundoHex, direcao);
  for (let i = 0; i < 20; i++) {
    const noCss = tripletParaHsl(hslParaTripletFino(tentativa))!;
    if (contrasteAA(hslParaHex(noCss), fundoHex)) return tentativa;
    tentativa = { ...tentativa, l: limitar(tentativa.l + (direcao === "escurecer" ? -1 : 1), 0, 100) };
  }
  return tentativa;
}

/**
 * Tokens de SEMPRE (gerador v1): exatamente os mesmos nomes e valores de antes.
 * A prévia do admin (buildBrandCss com escopo) recebe só estes, e por isso não
 * muda. Não acrescente nada aqui; token novo vai em tokensNovosDoModo ou
 * tokensDaCascaDoModo.
 */
function tokensLegadosDoModo(effective: EffectiveBrand, modo: Modo): Array<[string, string]> {
  const { hex: baseHex, hsl: base } = baseDoModo(effective, modo);
  const { hex: actionHex, hsl: action } = baseDaAcaoDoModo(effective, modo);
  const primaryTriplet = hslParaTriplet(action);
  const fg = foregroundPara(actionHex);
  const sidebarPrimaryTriplet = hslParaTriplet(base);
  const sidebarFg = foregroundPara(baseHex);

  // accent: tom sutil da marca de fundo (hover de menus/itens) + a própria cor
  // da marca como texto, ajustada até passar em AA sobre esse fundo.
  const accentFundo: Hsl = { h: base.h, s: Math.min(base.s, 90), l: modo === "claro" ? 95 : 18 };
  const accentFundoHex = hslParaHex(accentFundo);
  const accentTexto = ajustarParaContraste(base, accentFundoHex, modo === "claro" ? "escurecer" : "clarear");

  const escala = escalaDaMarca(base, modo);

  const secundariaHex = normalizarHex(effective.secondary);
  const segundoPonto = secundariaHex
    ? hslParaTriplet(hexParaHsl(secundariaHex)!)
    : hslParaTriplet({ h: base.h, s: base.s, l: limitar(base.l - 12, 5, 98) });
  const gradiente = `linear-gradient(135deg, hsl(${primaryTriplet}) 0%, hsl(${segundoPonto}) 100%)`;
  const sombra = `0 4px 20px -4px hsl(${primaryTriplet} / ${modo === "claro" ? "0.25" : "0.3"})`;

  const tokens: Array<[string, string]> = [
    ["--primary", primaryTriplet],
    ["--primary-foreground", fg],
    ["--ring", primaryTriplet],
    ["--accent", hslParaTriplet(accentFundo)],
    ["--accent-foreground", hslParaTriplet(accentTexto)],
    ["--sidebar-primary", sidebarPrimaryTriplet],
    ["--sidebar-primary-foreground", sidebarFg],
    ["--sidebar-ring", sidebarPrimaryTriplet],
  ];
  for (const passo of PASSOS_DA_ESCALA) tokens.push([`--brand-${passo}`, escala[passo]]);
  tokens.push(
    ["--brand-gradient", gradiente],
    ["--brand-shadow", sombra],
    ["--radius", remDoRaio(effective.radiusPx)],
    ["--font-sans", pilhaDaFonte(effective.fontFamily)],
  );
  return tokens;
}

/** Séries fixas dos gráficos 2..8 (a 1 é a marca). Ver design-system 1.5. */
const SERIES_FIXAS = ["#f5a524", "#4f9cf0", "#6e63d6", "#b4bfc7", "#2bb0a0", "#c04b92", "#e5484d"] as const;
/** Verde que substitui a série que colide com a marca. */
const SERIE_VERDE = "#22a06b";

/** A marca é laranja/âmbar? (a série 2, âmbar, colidiria com ela) */
export function marcaQuente(h: number): boolean {
  return h >= 10 && h <= 50;
}

/** A marca é azul? (a série 3, azul, colidiria com ela; o padrão do sistema é azul) */
export function marcaAzul(h: number): boolean {
  return h >= 190 && h <= 240;
}

/**
 * Tokens NOVOS que não mexem em neutros (valem em qualquer tela; ninguém os
 * usava antes, então não mudam nada que já existe):
 * --primary-hover, --primary-soft, --primary-soft-2, --primary-soft-fg e
 * --chart-1..8.
 *
 * --primary-soft/--primary-soft-fg usam a mesma lógica já testada de
 * --accent/--accent-foreground: fundo sutil na matiz da marca e o texto andando
 * a luminosidade até passar em AA sobre ele (ajustarParaContraste).
 */
function tokensNovosDoModo(effective: EffectiveBrand, modo: Modo): Array<[string, string]> {
  const { hsl: brandBase } = baseDoModo(effective, modo);
  const { hsl: base } = baseDaAcaoDoModo(effective, modo);
  const claro = modo === "claro";

  const hover: Hsl = { h: base.h, s: base.s, l: limitar(base.l + (claro ? -6 : 6), 0, 100) };
  const soft: Hsl = claro
    ? { h: base.h, s: Math.min(base.s, 85), l: 93 }
    : { h: base.h, s: Math.min(base.s, 38), l: 15 };
  const soft2: Hsl = claro
    ? { h: base.h, s: Math.min(base.s, 80), l: 96.5 }
    : { h: base.h, s: Math.min(base.s, 30), l: 12 };
  const inicioDoTexto: Hsl = claro
    ? { h: base.h, s: base.s, l: Math.max(base.l - 20, 24) }
    : { h: base.h, s: base.s, l: 72 };
  const softFg = ajustarParaContrasteNoCss(inicioDoTexto, soft, claro ? "escurecer" : "clarear");

  // Série 1 = marca; a 2 vira verde se a marca é laranja/âmbar; a 3 vira verde
  // se a marca é azul. No escuro, séries com L < 50 sobem 8 de luminosidade.
  const series = SERIES_FIXAS.map((hex, i) => {
    if (i === 0 && marcaQuente(brandBase.h)) return SERIE_VERDE;
    if (i === 1 && marcaAzul(brandBase.h)) return SERIE_VERDE;
    return hex;
  }).map((hex) => {
    const hsl = hexParaHsl(hex)!;
    return claro || hsl.l >= 50 ? hsl : { ...hsl, l: hsl.l + 8 };
  });

  const tokens: Array<[string, string]> = [
    ["--primary-hover", hslParaTripletFino(hover)],
    ["--primary-soft", hslParaTripletFino(soft)],
    ["--primary-soft-2", hslParaTripletFino(soft2)],
    ["--primary-soft-fg", hslParaTripletFino(softFg)],
    ["--chart-1", hslParaTriplet(brandBase)],
  ];
  series.forEach((hsl, i) => tokens.push([`--chart-${i + 2}`, hslParaTriplet(hsl)]));
  return tokens;
}

/** Teto de saturação dos neutros tingidos pela marca (--background, --surface-sunken). */
export const SATURACAO_MAX_NEUTRO_TINGIDO = 14;

/** Matiz da sidebar: marca fria (90°–260°) puxa 40% para ela; o resto fica no grafite 185. */
export function matizDaSidebar(h: number): number {
  return h >= 90 && h <= 260 ? Math.round(0.4 * h + 0.6 * 185) : 185;
}

/**
 * Cor de fundo de um badge com texto por cima: mantém o texto que
 * foregroundPara escolhe (branco ou escuro) e anda a luminosidade (escurece
 * sob branco, clareia sob escuro) até o par passar em AA, conferindo o valor já
 * arredondado do jeito que vai para o CSS (hslParaTriplet).
 */
export function badgeEmAA(cor: Hsl): Hsl {
  const hexNoCss = (c: Hsl) => hslParaHex(tripletParaHsl(hslParaTriplet(c))!);
  const sobBranco = foregroundPara(hexNoCss(cor)) === TRIPLET_BRANCO;
  let tentativa = cor;
  for (let i = 0; i < 100; i++) {
    if (razaoDeContraste(hexNoCss(tentativa), sobBranco ? BRANCO : ESCURO) >= 4.5) return tentativa;
    tentativa = { ...tentativa, l: limitar(Math.round(tentativa.l) + (sobBranco ? -1 : 1), 0, 100) };
  }
  return tentativa;
}

/**
 * Tokens da CASCA DO CRM (a exceção à regra de ouro). Saem só no bloco
 * `html…:root:has(.crm-shell)` do CSS sem escopo:
 * - --background e --surface-sunken tingidos (S ≤ 14%);
 * - a família --sidebar-* inteira (sidebar sempre escura);
 * - --brand-shadow novo (o legado continua no bloco geral, para as telas fora
 *   da casca e o /admin não mudarem).
 *
 * Marca sem croma (branco, cinza) gera grafite puro: a saturação da sidebar é
 * proporcional à da marca até 30%.
 */
function tokensDaCascaDoModo(effective: EffectiveBrand, modo: Modo): Array<[string, string]> {
  const { hex: baseHex, hsl: base } = baseDoModo(effective, modo);
  const claro = modo === "claro";
  const hs = matizDaSidebar(base.h);
  const croma = limitar(base.s / 30, 0, 1);
  const satSidebar = (s: number) => s * croma;
  const satNeutro = (s: number) => Math.min(s, SATURACAO_MAX_NEUTRO_TINGIDO, base.s);

  const fundo: Hsl = claro ? { h: base.h, s: satNeutro(14), l: 96 } : { h: hs, s: satNeutro(14), l: 6 };
  const afundado: Hsl = claro ? { h: base.h, s: satNeutro(12), l: 95 } : { h: hs, s: satNeutro(12), l: 7.5 };

  const sidebarFundo: Hsl = claro ? { h: hs, s: satSidebar(45), l: 7 } : { h: hs, s: satSidebar(30), l: 4.5 };
  const sidebarHover: Hsl = claro ? { h: hs, s: satSidebar(30), l: 12 } : { h: hs, s: satSidebar(24), l: 10 };
  const sidebarBorda: Hsl = claro ? { h: hs, s: satSidebar(25), l: 14 } : { h: hs, s: satSidebar(16), l: 11 };
  const sidebarFundoHex = hslParaHex(tripletParaHsl(hslParaTripletFino(sidebarFundo))!);

  // Item ativo: a marca por cima da sidebar com alfa α (marca escura precisa de
  // mais alfa para aparecer), calculado em RGB e escrito em HSL.
  const alfa = base.l < 28 ? 0.55 : base.l >= 50 ? 0.3 : 0.45;
  const ativoHex = misturarHex(baseHex, sidebarFundoHex, alfa);
  const ativo = hexParaHsl(ativoHex)!;

  // Badge/destaque da sidebar: a marca; marca muito escura some no fundo preto,
  // então sobe para L 45%. Depois anda a luminosidade até o contador (11px,
  // texto normal) passar em AA com o texto escolhido por foregroundPara. Token só
  // da casca: pode divergir de --primary sem mexer em derivarCorEscura.
  const sidebarPrimaria = badgeEmAA(base.l < 40 ? { h: base.h, s: base.s, l: 45 } : base);
  const sidebarPrimariaHex = hslParaHex(tripletParaHsl(hslParaTriplet(sidebarPrimaria))!);

  const primaryTriplet = hslParaTriplet(base);
  return [
    ["--background", hslParaTripletFino(fundo)],
    ["--surface-sunken", hslParaTripletFino(afundado)],
    ["--sidebar-background", hslParaTripletFino(sidebarFundo)],
    ["--sidebar-foreground", "180 8% 78%"],
    ["--sidebar-muted", "180 6% 52%"],
    ["--sidebar-accent", hslParaTripletFino(sidebarHover)],
    ["--sidebar-accent-foreground", "0 0% 100%"],
    ["--sidebar-border", hslParaTripletFino(sidebarBorda)],
    ["--sidebar-active", hslParaTriplet(ativo)],
    ["--sidebar-active-foreground", foregroundPara(ativoHex)],
    ["--sidebar-primary", hslParaTriplet(sidebarPrimaria)],
    ["--sidebar-primary-foreground", foregroundPara(sidebarPrimariaHex)],
    ["--sidebar-ring", primaryTriplet],
    ["--brand-shadow", `0 6px 16px -6px hsl(${primaryTriplet} / ${claro ? "0.45" : "0.35"})`],
  ];
}

/**
 * Tokens que a marca escreve por modo, em três grupos:
 * - legados: os de sempre (a prévia do admin só recebe estes);
 * - novos: destaques novos, sem neutros (bloco geral);
 * - casca: a exceção à regra de ouro, só sob a casca do CRM.
 */
function tokensDoModo(
  effective: EffectiveBrand,
  modo: Modo,
): { legados: Array<[string, string]>; novos: Array<[string, string]>; casca: Array<[string, string]> } {
  return {
    legados: tokensLegadosDoModo(effective, modo),
    novos: tokensNovosDoModo(effective, modo),
    casca: tokensDaCascaDoModo(effective, modo),
  };
}

function bloco(seletor: string, tokens: Array<[string, string]>): string {
  return `${seletor}{\n${tokens.map(([k, v]) => `  ${k}: ${v};`).join("\n")}\n}`;
}

/**
 * CSS da marca.
 * - Sem escopo (o app): `html:not(.dark){…}` e `html.dark{…}` com os tokens
 *   legados + os novos (vencem :root/.dark do index.css), e mais dois blocos da
 *   casca do CRM, `html:not(.dark):root:has(.crm-shell){…}` e
 *   `html.dark:root:has(.crm-shell){…}` (especificidade 0,3,1: vencem os
 *   defaults da casca no index.css, 0,2,1). Fora da casca (admin, login) esses
 *   blocos não casam e nada muda.
 * - Com escopo (prévia do admin): `${escopo}[data-mode=light]{…}` e
 *   `${escopo}[data-mode=dark]{…}` SÓ com os tokens legados, byte a byte iguais
 *   ao gerador v1 — a prévia do admin não muda (decisão 9).
 */
export function buildBrandCss(effective: EffectiveBrand, opts?: { escopo?: string }): string {
  const escopo = opts?.escopo?.trim();
  if (escopo) {
    return `${bloco(`${escopo}[data-mode=light]`, tokensLegadosDoModo(effective, "claro"))}\n${bloco(
      `${escopo}[data-mode=dark]`,
      tokensLegadosDoModo(effective, "escuro"),
    )}\n`;
  }
  const claro = tokensDoModo(effective, "claro");
  const escuro = tokensDoModo(effective, "escuro");
  return [
    bloco("html:not(.dark)", [...claro.legados, ...claro.novos]),
    bloco("html.dark", [...escuro.legados, ...escuro.novos]),
    bloco(`html:not(.dark)${SELETOR_CASCA_CRM}`, claro.casca),
    bloco(`html.dark${SELETOR_CASCA_CRM}`, escuro.casca),
    "",
  ].join("\n");
}

/**
 * Apaga do localStorage o CSS e o cache de marca de versões anteriores do
 * gerador ('crm:brand_css:<slug>' do v1, 'crm:brand_v1:<slug>'), que ficariam
 * órfãos. Roda uma vez por carga de página.
 */
let cachesAntigosLimpos = false;
export function limparCachesAntigosDaMarca(): void {
  if (cachesAntigosLimpos) return;
  cachesAntigosLimpos = true;
  try {
    const cssAtual = `crm:brand_css:v${VERSAO_GERADOR_TEMA}:`;
    const cacheAtual = `crm:brand_v${VERSAO_GERADOR_TEMA}:`;
    const velhas: string[] = [];
    const total = typeof localStorage.length === "number" ? localStorage.length : 0;
    for (let i = 0; i < total; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      const cssVelho = k.startsWith("crm:brand_css:") && !k.startsWith(cssAtual);
      const cacheVelho = /^crm:brand_v\d+:/.test(k) && !k.startsWith(cacheAtual);
      if (cssVelho || cacheVelho) velhas.push(k);
    }
    for (const k of velhas) localStorage.removeItem(k);
  } catch {
    /* armazenamento bloqueado: nada a limpar */
  }
}

/** Só para testes: permite rodar a limpeza de novo. */
export function __reiniciarLimpezaDeCachesParaTeste(): void {
  cachesAntigosLimpos = false;
}

/**
 * Injeta (ou atualiza) <style id="brand-theme"> no <head> e guarda o CSS em
 * localStorage 'crm:brand_css:v2:<slug|__sistema__>' para o index.html aplicar
 * antes do React na próxima visita (sem piscar a cor padrão). Na 1ª aplicação
 * da página, apaga as chaves das versões antigas do gerador.
 */
export function aplicarTemaDaMarca(effective: EffectiveBrand, slug?: string | null): string {
  const css = buildBrandCss(effective);
  if (typeof document !== "undefined") {
    let el = document.getElementById(ID_ESTILO_DA_MARCA) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = ID_ESTILO_DA_MARCA;
      document.head.appendChild(el);
    }
    if (el.textContent !== css) el.textContent = css;
  }
  limparCachesAntigosDaMarca();
  try {
    localStorage.setItem(CHAVE_CSS_DA_MARCA(slug), css);
  } catch {
    /* armazenamento bloqueado (janela anônima, cota): segue só com o <style>. */
  }
  return css;
}

/** Apaga o CSS guardado (cliente que deixou de existir). */
export function esquecerCssDaMarca(slug?: string | null): void {
  try {
    localStorage.removeItem(CHAVE_CSS_DA_MARCA(slug));
  } catch {
    /* ignora */
  }
}
