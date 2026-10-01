import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  CHAVE_CACHE_DA_MARCA,
  CHAVE_CSS_DA_MARCA,
  SATURACAO_MAX_NEUTRO_TINGIDO,
  SISTEMA_PADRAO,
  VERSAO_GERADOR_TEMA,
  __reiniciarLimpezaDeCachesParaTeste,
  aplicarTemaDaMarca,
  buildBrandCss,
  contrasteAA,
  derivarCorEscura,
  foregroundPara,
  hexParaHsl,
  hslParaHex,
  razaoDeContraste,
  resolverMarcaEfetiva,
  tripletParaHsl,
  type SystemBrand,
  type TenantBrand,
} from "./theme";

const sistema: SystemBrand = {
  ...SISTEMA_PADRAO,
  name: "CRClin",
  short_name: "CRClin",
  logo_url: "https://exemplo/sistema.png",
  logo_dark_url: "https://exemplo/sistema-escuro.png",
  favicon_url: "https://exemplo/sistema.ico",
  primary_color: "#2563eb",
  font_family: "Inter",
  radius_px: 12,
  version: 3,
};

function cliente(parcial: Partial<TenantBrand> = {}): TenantBrand {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    slug: "clinica",
    status: "active",
    name: "Clínica Exemplo",
    logo_url: null,
    logo_dark_url: null,
    favicon_url: null,
    primary_color: null,
    primary_color_dark: null,
    secondary_color: null,
    font_family: null,
    radius_px: null,
    login_title: null,
    login_subtitle: null,
    login_footer: null,
    login_bg_url: null,
    hide_system_brand: false,
    version: 1,
    ...parcial,
  };
}

/** Extrai o valor de um token dentro do bloco do seletor. */
function tokenNoBloco(css: string, seletor: string, token: string): string | null {
  const inicio = css.indexOf(`${seletor}{`);
  if (inicio < 0) return null;
  const fim = css.indexOf("}", inicio);
  const bloco = css.slice(inicio, fim);
  const m = bloco.match(new RegExp(`${token}:\\s*([^;]+);`));
  return m ? m[1].trim() : null;
}

describe("buildBrandCss", () => {
  const efetiva = resolverMarcaEfetiva({ ...sistema, primary_color: "#1d4ed8" }, null);
  const css = buildBrandCss(efetiva);

  it("gera os blocos de claro e escuro", () => {
    expect(css).toContain("html:not(.dark)");
    expect(css).toContain("html.dark");
  });

  it("usa texto branco sobre azul forte", () => {
    expect(tokenNoBloco(css, "html:not(.dark)", "--primary-foreground")).toBe("0 0% 100%");
  });

  it("clareia a cor no escuro (L ≥ 58)", () => {
    const primaria = tokenNoBloco(css, "html.dark", "--primary");
    expect(primaria).not.toBeNull();
    const l = Number(primaria!.split(" ")[2].replace("%", ""));
    expect(l).toBeGreaterThanOrEqual(58);
  });

  it("nunca escreve tokens neutros (--background e --surface-sunken só tingidos, S ≤ 14%)", () => {
    for (const linha of css.split("\n")) {
      expect(linha).not.toMatch(/--secondary:|--muted:|--card:|--input:|--popover:|--border:/);
      const m = linha.match(/^\s*--(background|surface-sunken):\s*([^;]+);/);
      if (m) expect(tripletParaHsl(m[2])!.s).toBeLessThanOrEqual(14);
    }
  });

  it("escreve a escala brand, gradiente, sombra, raio e fonte", () => {
    for (const passo of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]) {
      expect(css).toContain(`--brand-${passo}:`);
    }
    expect(css).toContain("--brand-gradient: linear-gradient(135deg");
    expect(css).toContain("--brand-shadow:");
    expect(tokenNoBloco(css, "html:not(.dark)", "--radius")).toBe("0.75rem");
    expect(tokenNoBloco(css, "html:not(.dark)", "--font-sans")).toBe("'Inter', sans-serif");
  });

  it("cor clara gera texto escuro", () => {
    const amarelo = buildBrandCss(resolverMarcaEfetiva({ ...sistema, primary_color: "#fde047" }, null));
    expect(tokenNoBloco(amarelo, "html:not(.dark)", "--primary-foreground")).toBe("222 47% 11%");
    expect(foregroundPara("#fde047")).toBe("222 47% 11%");
  });

  it("o texto do accent passa em AA sobre o fundo do accent", () => {
    for (const cor of ["#1d4ed8", "#fde047", "#16a34a", "#f97316"]) {
      const c = buildBrandCss(resolverMarcaEfetiva({ ...sistema, primary_color: cor }, null));
      for (const seletor of ["html:not(.dark)", "html.dark"]) {
        const fundo = tokenNoBloco(c, seletor, "--accent")!;
        const texto = tokenNoBloco(c, seletor, "--accent-foreground")!;
        const paraHex = (t: string) => {
          const [h, s, l] = t.split(" ").map((x) => Number(x.replace("%", "")));
          return hslParaHex({ h, s, l });
        };
        // Arredondamento do triplet pode custar alguns centésimos de contraste.
        expect(contrasteAA(paraHex(texto), paraHex(fundo))).toBe(true);
      }
    }
  });

  it("com escopo gera seletores por data-mode (prévia do admin)", () => {
    const escopado = buildBrandCss(efetiva, { escopo: "[data-brand-scope]" });
    expect(escopado).toContain("[data-brand-scope][data-mode=light]{");
    expect(escopado).toContain("[data-brand-scope][data-mode=dark]{");
    expect(escopado).not.toContain("html");
  });
});

describe("helpers de cor", () => {
  it("derivarCorEscura mantém o matiz e limita S e L", () => {
    const original = hexParaHsl("#1e3a8a")!;
    const escura = hexParaHsl(derivarCorEscura("#1e3a8a"))!;
    expect(Math.abs(escura.h - original.h)).toBeLessThan(2);
    expect(escura.l).toBeGreaterThanOrEqual(57.5);
    expect(escura.s).toBeLessThanOrEqual(85.5);
  });

  it("contrasteAA", () => {
    expect(contrasteAA("#ffffff", "#1d4ed8")).toBe(true);
    expect(contrasteAA("#ffffff", "#fde047")).toBe(false);
    expect(contrasteAA("nada", "#000000")).toBe(false);
  });
});

describe("resolverMarcaEfetiva", () => {
  it("sem cliente usa o sistema", () => {
    const e = resolverMarcaEfetiva(sistema, null);
    expect(e.name).toBe("CRClin");
    expect(e.primary).toBe("#2563eb");
    expect(e.logoUrl).toBe("https://exemplo/sistema.png");
    expect(e.poweredBy).toBe(true);
  });

  it("o cliente sobrepõe; o que falta cai no sistema", () => {
    const e = resolverMarcaEfetiva(
      sistema,
      cliente({ primary_color: "#DC2626", font_family: "Poppins", logo_url: "https://exemplo/cliente.png" }),
    );
    expect(e.name).toBe("Clínica Exemplo");
    expect(e.primary).toBe("#dc2626");
    expect(e.fontFamily).toBe("Poppins");
    expect(e.logoUrl).toBe("https://exemplo/cliente.png");
    // Faltas caem no sistema.
    expect(e.radiusPx).toBe(12);
    expect(e.faviconUrl).toBe("https://exemplo/sistema.ico");
    // Variantes dependentes não herdam as do sistema quando o cliente tem a sua base.
    expect(e.logoDarkUrl).toBeNull();
    expect(e.primaryDark).toBeNull();
  });

  it("cliente sem cor nem logo herda cor e logos do sistema", () => {
    const e = resolverMarcaEfetiva(sistema, cliente());
    expect(e.primary).toBe("#2563eb");
    expect(e.logoUrl).toBe("https://exemplo/sistema.png");
    expect(e.logoDarkUrl).toBe("https://exemplo/sistema-escuro.png");
  });

  it("hide_system_brand desliga o powered by; fonte fora da lista cai em Inter", () => {
    const e = resolverMarcaEfetiva(sistema, cliente({ hide_system_brand: true, font_family: "Comic Sans MS" }));
    expect(e.poweredBy).toBe(false);
    expect(e.fontFamily).toBe("Inter");
  });

  it("cor inválida do cliente é ignorada", () => {
    const e = resolverMarcaEfetiva(sistema, cliente({ primary_color: "vermelho" }));
    expect(e.primary).toBe("#2563eb");
  });
});

describe("aplicarTemaDaMarca", () => {
  it("injeta um único <style id='brand-theme'> e guarda o CSS", () => {
    const mem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    });
    const e = resolverMarcaEfetiva(sistema, null);
    aplicarTemaDaMarca(e, null);
    aplicarTemaDaMarca(e, null);
    expect(document.querySelectorAll("style#brand-theme").length).toBe(1);
    expect(localStorage.getItem("crm:brand_css:v2:__sistema__")).toContain("html.dark");
    expect(document.documentElement.getAttribute("style")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("segue funcionando sem localStorage (janela anônima/bloqueado)", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: () => {
        throw new Error("bloqueado");
      },
      removeItem: () => {
        throw new Error("bloqueado");
      },
    });
    expect(() => aplicarTemaDaMarca(resolverMarcaEfetiva(sistema, cliente()), "clinica")).not.toThrow();
    vi.unstubAllGlobals();
  });
});

// ───────────────────── Gerador v2: casca do CRM, cache e tokens do index.css ─────────────────────

/** Marcas de teste (decisão 19) + casos-limite. */
const MARCAS_DE_TESTE = {
  "CRClin padrão (azul, sem cor própria)": null,
  "verde #18845A": "#18845A",
  "laranja #FC6C2A": "#FC6C2A",
  "amarela #fde047": "#fde047",
  "quase preta #1e293b": "#1e293b",
  "branca #ffffff": "#ffffff",
} as const;

const CASCA_CLARO = "html:not(.dark):root:has(.crm-shell)";
const CASCA_ESCURO = "html.dark:root:has(.crm-shell)";

function cssDaMarca(cor: string | null): string {
  const tenant = cor ? cliente({ primary_color: cor }) : null;
  return buildBrandCss(resolverMarcaEfetiva(sistema, tenant));
}

function hexDoToken(css: string, seletor: string, token: string): string {
  const valor = tokenNoBloco(css, seletor, token);
  expect(valor, `${seletor} ${token}`).not.toBeNull();
  return hslParaHex(tripletParaHsl(valor)!);
}

describe("gerador v2: casca do CRM (exceção à regra de ouro)", () => {
  const NEUTROS_PROIBIDOS = /--(card|card-foreground|popover|popover-foreground|input|muted|muted-foreground|secondary|secondary-foreground|border|foreground|text-tertiary):/;

  for (const [nome, cor] of Object.entries(MARCAS_DE_TESTE)) {
    describe(nome, () => {
      const css = cssDaMarca(cor);

      it("não escreve neutros; --background/--surface-sunken só na casca e com S ≤ 14% nos dois temas", () => {
        for (const linha of css.split("\n")) expect(linha).not.toMatch(NEUTROS_PROIBIDOS);
        for (const seletor of ["html:not(.dark)", "html.dark"]) {
          expect(tokenNoBloco(css, seletor, "--background")).toBeNull();
          expect(tokenNoBloco(css, seletor, "--surface-sunken")).toBeNull();
        }
        for (const seletor of [CASCA_CLARO, CASCA_ESCURO]) {
          for (const token of ["--background", "--surface-sunken"]) {
            const hsl = tripletParaHsl(tokenNoBloco(css, seletor, token))!;
            expect(hsl.s, `${seletor} ${token}`).toBeLessThanOrEqual(SATURACAO_MAX_NEUTRO_TINGIDO);
          }
        }
      });

      it("sidebar sempre escura, com texto, rótulo e item ativo em AA nos dois temas", () => {
        for (const seletor of [CASCA_CLARO, CASCA_ESCURO]) {
          const fundo = tripletParaHsl(tokenNoBloco(css, seletor, "--sidebar-background"))!;
          expect(fundo.l).toBeLessThanOrEqual(8);
          const fundoHex = hexDoToken(css, seletor, "--sidebar-background");
          expect(contrasteAA(hexDoToken(css, seletor, "--sidebar-foreground"), fundoHex)).toBe(true);
          expect(contrasteAA(hexDoToken(css, seletor, "--sidebar-muted"), fundoHex)).toBe(true);
          expect(
            contrasteAA(hexDoToken(css, seletor, "--sidebar-active-foreground"), hexDoToken(css, seletor, "--sidebar-active")),
          ).toBe(true);
          // O badge (--sidebar-primary) segue a regra de sempre do texto sobre a
          // marca (foregroundPara, igual ao --primary-foreground): o melhor dos dois.
          const badge = hexDoToken(css, seletor, "--sidebar-primary");
          expect(tokenNoBloco(css, seletor, "--sidebar-primary-foreground")).toBe(foregroundPara(badge));
          // O contador tem 11px semibold (texto normal): o par precisa de AA.
          expect(razaoDeContraste(hexDoToken(css, seletor, "--sidebar-primary-foreground"), badge), seletor).toBeGreaterThanOrEqual(4.5);
        }
      });

      it("--primary-soft-fg passa em AA sobre --primary-soft nos dois temas", () => {
        for (const seletor of ["html:not(.dark)", "html.dark"]) {
          const texto = hexDoToken(css, seletor, "--primary-soft-fg");
          const fundo = hexDoToken(css, seletor, "--primary-soft");
          expect(razaoDeContraste(texto, fundo), seletor).toBeGreaterThanOrEqual(4.5);
          expect(tokenNoBloco(css, seletor, "--primary-soft-2")).not.toBeNull();
          expect(tokenNoBloco(css, seletor, "--primary-hover")).not.toBeNull();
        }
      });

      it("série 1 do gráfico é a marca e há 8 séries", () => {
        for (const seletor of ["html:not(.dark)", "html.dark"]) {
          expect(tokenNoBloco(css, seletor, "--chart-1")).toBe(tokenNoBloco(css, seletor, "--primary"));
          for (let n = 1; n <= 8; n++) expect(tokenNoBloco(css, seletor, `--chart-${n}`)).not.toBeNull();
        }
      });
    });
  }

  it("badge da sidebar em AA também com primary_color_dark escura (laranja + #7a2e0e)", () => {
    const css = buildBrandCss(resolverMarcaEfetiva(sistema, cliente({ primary_color: "#FC6C2A", primary_color_dark: "#7a2e0e" })));
    for (const seletor of [CASCA_CLARO, CASCA_ESCURO]) {
      const badge = hexDoToken(css, seletor, "--sidebar-primary");
      const texto = tokenNoBloco(css, seletor, "--sidebar-primary-foreground");
      expect(texto).toBe(foregroundPara(badge));
      expect(razaoDeContraste(hexDoToken(css, seletor, "--sidebar-primary-foreground"), badge), seletor).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("badge da sidebar só muda onde reprovava: o --primary da marca continua o mesmo", () => {
    const css = cssDaMarca(null);
    expect(tokenNoBloco(css, "html.dark", "--primary")).toBe("221 83% 58%");
    expect(tokenNoBloco(css, CASCA_ESCURO, "--sidebar-primary")).toBe("221 83% 56%");
    expect(tokenNoBloco(css, CASCA_CLARO, "--sidebar-primary")).toBe("221 83% 53%");
  });

  it("série 2 vira verde quando a matiz da marca está entre 10 e 50; senão é âmbar", () => {
    const matiz = (css: string) => tripletParaHsl(tokenNoBloco(css, "html:not(.dark)", "--chart-2"))!.h;
    for (const quente of ["#FC6C2A", "#f59e0b", "#ea580c"]) {
      expect(matiz(cssDaMarca(quente))).toBeGreaterThan(140); // verde #22A06B (h ≈ 155)
    }
    for (const outra of ["#18845A", "#2563eb", "#dc2626", "#7c3aed"]) {
      expect(matiz(cssDaMarca(outra))).toBeLessThan(50); // âmbar #F5A524 (h ≈ 37)
    }
  });

  it("série 3 (azul) vira verde quando a marca é azul, para não colidir com o padrão", () => {
    const h3 = (cor: string | null) => tripletParaHsl(tokenNoBloco(cssDaMarca(cor), "html:not(.dark)", "--chart-3"))!.h;
    expect(h3(null)).toBeGreaterThan(140);
    expect(h3(null)).toBeLessThan(170);
    expect(h3("#18845A")).toBeGreaterThan(200);
  });

  it("sidebar: matiz fria puxa para a marca (verde #18845A ≈ 174); marca quente fica no grafite 185", () => {
    const hs = (cor: string | null) => tripletParaHsl(tokenNoBloco(cssDaMarca(cor), CASCA_CLARO, "--sidebar-background"))!.h;
    expect(hs("#18845A")).toBe(174);
    expect(hs("#FC6C2A")).toBe(185);
    expect(hs(null)).toBe(199);
    // Marca sem croma dá grafite puro.
    expect(tripletParaHsl(tokenNoBloco(cssDaMarca("#ffffff"), CASCA_CLARO, "--sidebar-background"))!.s).toBe(0);
  });

  it("--brand-shadow novo só na casca; o bloco geral mantém o de antes", () => {
    const css = cssDaMarca(null);
    expect(tokenNoBloco(css, "html:not(.dark)", "--brand-shadow")).toBe("0 4px 20px -4px hsl(221 83% 53% / 0.25)");
    expect(tokenNoBloco(css, CASCA_CLARO, "--brand-shadow")).toBe("0 6px 16px -6px hsl(221 83% 53% / 0.45)");
  });

  it("a primária do escuro continua vindo de derivarCorEscura (ou de primary_color_dark)", () => {
    const css = cssDaMarca("#18845A");
    expect(tokenNoBloco(css, "html.dark", "--primary")).toBe(
      tokenNoBloco(buildBrandCss(resolverMarcaEfetiva({ ...sistema, primary_color: derivarCorEscura("#18845a") }, null)), "html:not(.dark)", "--primary"),
    );
    const comEscura = buildBrandCss(resolverMarcaEfetiva(sistema, cliente({ primary_color: "#18845A", primary_color_dark: "#34d399" })));
    expect(tokenNoBloco(comEscura, "html.dark", "--primary")).toBe("158 64% 52%");
  });
});

describe("gerador v2: a prévia do admin (buildBrandCss com escopo) não muda", () => {
  // Hash djb2 do CSS com escopo gerado pelo gerador v1 (commit 4d4c92b) para as
  // mesmas marcas. Se mudar, a prévia do /admin/sistema/marca mudou (decisão 9).
  function djb2(texto: string): string {
    let h = 5381;
    for (let i = 0; i < texto.length; i++) h = ((h * 33) ^ texto.charCodeAt(i)) >>> 0;
    return h.toString(16);
  }
  const ESCOPO = '[data-brand-scope="previa-r1"]';
  const CASOS: Array<[Partial<SystemBrand>, string]> = [
    [{ primary_color: "#2563eb" }, "4ba1b91a"],
    [{ primary_color: "#18845A" }, "89f5be18"],
    [{ primary_color: "#FC6C2A" }, "1ad952ff"],
    [{ primary_color: "#fde047" }, "2c6ae56"],
    [
      { primary_color: "#18845A", primary_color_dark: "#34d399", secondary_color: "#0f766e", radius_px: 16, font_family: "Poppins" },
      "14b566f6",
    ],
  ];

  it.each(CASOS)("%o gera o mesmo CSS do v1", (parcial, hashV1) => {
    const css = buildBrandCss(resolverMarcaEfetiva({ ...SISTEMA_PADRAO, ...parcial }, null), { escopo: ESCOPO });
    expect(djb2(css)).toBe(hashV1);
    expect(css).not.toMatch(/--(background|surface-sunken|sidebar-background|sidebar-active|sidebar-muted|primary-soft|chart-\d):/);
    expect(css).not.toContain("crm-shell");
  });

  it("sem escopo, o bloco geral mantém todos os tokens de antes com os mesmos valores", () => {
    const e = resolverMarcaEfetiva({ ...SISTEMA_PADRAO, primary_color: "#18845A" }, null);
    const escopado = buildBrandCss(e, { escopo: ESCOPO });
    const geral = buildBrandCss(e);
    for (const [seletorEscopo, seletorGeral] of [
      [`${ESCOPO}[data-mode=light]`, "html:not(.dark)"],
      [`${ESCOPO}[data-mode=dark]`, "html.dark"],
    ]) {
      const inicio = escopado.indexOf(`${seletorEscopo}{`);
      const blocoEscopo = escopado.slice(inicio, escopado.indexOf("}", inicio));
      const tokens = [...blocoEscopo.matchAll(/(--[\w-]+):\s*([^;]+);/g)];
      expect(tokens.length).toBe(22);
      for (const [, token, valor] of tokens) expect(tokenNoBloco(geral, seletorGeral, token)).toBe(valor.trim());
    }
  });
});

describe("gerador v2: cache", () => {
  it("chaves com a versão do gerador (CSS, cache da marca e index.html)", () => {
    expect(VERSAO_GERADOR_TEMA).toBe("2");
    expect(CHAVE_CSS_DA_MARCA("Clinica")).toBe("crm:brand_css:v2:clinica");
    expect(CHAVE_CSS_DA_MARCA(null)).toBe("crm:brand_css:v2:__sistema__");
    expect(CHAVE_CACHE_DA_MARCA("clinica")).toBe("crm:brand_v2:clinica");
    const indexHtml = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
    expect(indexHtml).toContain(`"crm:brand_css:v${VERSAO_GERADOR_TEMA}:"`);
    expect(indexHtml).not.toMatch(/"crm:brand_css:"\s*\+/);
  });

  it("aplicarTemaDaMarca apaga as chaves antigas e mantém as da versão atual", () => {
    const mem = new Map<string, string>([
      ["crm:brand_css:clinica", "css v1"],
      ["crm:brand_css:__sistema__", "css v1"],
      ["crm:brand_css:v2", "slug 'v2' no v1"],
      ["crm:brand_v1:clinica", "{}"],
      ["crm:brand_v1:__sistema__", "{}"],
      ["crm:brand_css:v2:outra", "css v2"],
      ["crm:brand_v2:outra", "{}"],
      ["app-theme", "dark"],
    ]);
    vi.stubGlobal("localStorage", {
      get length() {
        return mem.size;
      },
      key: (i: number) => [...mem.keys()][i] ?? null,
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    });
    __reiniciarLimpezaDeCachesParaTeste();
    aplicarTemaDaMarca(resolverMarcaEfetiva(sistema, cliente()), "clinica");
    expect([...mem.keys()].sort()).toEqual(
      ["app-theme", "crm:brand_css:v2:clinica", "crm:brand_css:v2:outra", "crm:brand_v2:outra"].sort(),
    );
    expect(mem.get("crm:brand_css:v2:clinica")).toContain(":root:has(.crm-shell)");
    vi.unstubAllGlobals();
  });
});

// ───────────────────── index.css ─────────────────────

const INDEX_CSS = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Tokens de um bloco do index.css pelo seletor exato. */
function blocoDoIndex(seletor: string): Map<string, string> {
  const re = new RegExp(`(?:^|\\n)\\s*${seletor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^{}]*)\\}`);
  const m = INDEX_CSS.match(re);
  expect(m, `bloco ${seletor} no index.css`).not.toBeNull();
  return new Map([...m![1].matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()]));
}

const ROOT = blocoDoIndex(":root");
const DARK = blocoDoIndex(".dark");
const CRM_CLARO = blocoDoIndex("html:root:has(.crm-shell)");
const CRM_ESCURO = blocoDoIndex("html.dark:has(.crm-shell)");
/** Valor efetivo no tema: o bloco de cima vence o de baixo. */
const temaClaro = (k: string) => CRM_CLARO.get(k) ?? ROOT.get(k);
const temaEscuro = (k: string) => CRM_ESCURO.get(k) ?? DARK.get(k) ?? CRM_CLARO.get(k) ?? ROOT.get(k);

const hexDe = (triplet: string | undefined) => hslParaHex(tripletParaHsl(triplet)!);

describe("index.css: semânticas suaves e eventos", () => {
  const FAMILIAS = ["success", "warning", "info", "destructive", "orange", "purple", "pink", "teal", "slate", "rescheduled"];

  for (const [tema, valor] of [
    ["claro", temaClaro],
    ["escuro", temaEscuro],
  ] as const) {
    it.each(FAMILIAS)(`--%s-soft-foreground passa em AA sobre --%s-soft (${tema})`, (cor) => {
      const texto = valor(`--${cor}-soft-foreground`);
      const fundo = valor(`--${cor}-soft`);
      expect(texto && fundo, cor).toBeTruthy();
      expect(razaoDeContraste(hexDe(texto), hexDe(fundo))).toBeGreaterThanOrEqual(4.5);
      expect(valor(`--${cor}`)).toBeTruthy();
    });

    it(`eventos: texto em AA sobre o fundo (${tema})`, () => {
      for (const cor of ["purple", "green", "pink", "orange", "blue"]) {
        expect(valor(`--event-${cor}-bar`)).toBeTruthy();
        expect(razaoDeContraste(hexDe(valor(`--event-${cor}-fg`)), hexDe(valor(`--event-${cor}-bg`))), cor).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`--primary-soft-fg padrão em AA sobre --primary-soft (${tema})`, () => {
      expect(razaoDeContraste(hexDe(valor("--primary-soft-fg")), hexDe(valor("--primary-soft")))).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("os fortes de sempre não mudaram", () => {
    expect(ROOT.get("--success")).toBe("152 58% 38%");
    expect(ROOT.get("--warning")).toBe("32 95% 36%");
    expect(ROOT.get("--info")).toBe("212 90% 48%");
    expect(ROOT.get("--destructive")).toBe("0 84% 60%");
    expect(DARK.get("--success")).toBe("152 55% 48%");
    expect(DARK.get("--warning")).toBe("38 92% 55%");
    expect(DARK.get("--info")).toBe("212 90% 62%");
    expect(DARK.get("--destructive")).toBe("0 84% 60%");
  });
});

describe("index.css: neutros com matiz fixa (não dependem da marca)", () => {
  const NEUTROS = ["--background", "--surface-sunken", "--card", "--popover", "--secondary", "--muted", "--border", "--input"];
  const TEXTOS = ["--foreground", "--muted-foreground", "--text-tertiary", "--card-foreground", "--popover-foreground", "--secondary-foreground"];

  it.each([
    ["claro", temaClaro],
    ["escuro", temaEscuro],
  ] as const)("casca do CRM (%s): matiz neutra fixa 195–210 e fundos com S ≤ 14%%", (_tema, valorNoTema) => {
    for (const token of [...NEUTROS, ...TEXTOS]) {
      const valor = valorNoTema(token);
      expect(valor, token).toBeTruthy();
      expect(valor, token).not.toMatch(/var\(/); // nada de --brand-*/--primary
      const hsl = tripletParaHsl(valor)!;
      if (hsl.s > 0) {
        expect(hsl.h, token).toBeGreaterThanOrEqual(195);
        expect(hsl.h, token).toBeLessThanOrEqual(210);
      }
      if (NEUTROS.includes(token)) expect(hsl.s, token).toBeLessThanOrEqual(SATURACAO_MAX_NEUTRO_TINGIDO);
    }
  });

  it("a matiz dos neutros é a mesma para qualquer marca (a marca só troca --background/--surface-sunken na casca)", () => {
    // O index.css não conhece a marca; e o CSS da marca nunca escreve os outros
    // neutros, para nenhuma cor. Logo a matiz deles não depende da marca.
    for (const cor of ["#2563eb", "#18845A", "#FC6C2A", "#fde047"]) {
      const css = cssDaMarca(cor);
      for (const token of [...NEUTROS.slice(2), ...TEXTOS]) expect(css).not.toContain(`${token}:`);
    }
    const hues = new Set(
      [...NEUTROS, ...TEXTOS]
        .flatMap((t) => [temaClaro(t), temaEscuro(t)])
        .map((v) => tripletParaHsl(v)!)
        .filter((h) => h.s > 0)
        .map((h) => h.h),
    );
    expect([...hues].every((h) => h >= 195 && h <= 210)).toBe(true);
    expect(hues.has(221)).toBe(false); // matiz do azul padrão
  });

  it.each([
    ["claro", temaClaro, CASCA_CLARO],
    ["escuro", temaEscuro, CASCA_ESCURO],
  ] as const)("--text-tertiary passa em AA sobre card, fundo e superfície afundada (%s), para qualquer marca", (_tema, valorNoTema, casca) => {
    const texto = hexDe(valorNoTema("--text-tertiary"));
    const fundos = ["--card", "--popover", "--background", "--surface-sunken"].map((t) => valorNoTema(t)!);
    for (const cor of Object.values(MARCAS_DE_TESTE)) {
      const css = cssDaMarca(cor);
      fundos.push(tokenNoBloco(css, casca, "--background")!, tokenNoBloco(css, casca, "--surface-sunken")!);
    }
    for (const fundo of fundos) expect(razaoDeContraste(texto, hexDe(fundo)), fundo).toBeGreaterThanOrEqual(4.5);
  });

  it("novos tokens neutros do :root/.dark também têm matiz fixa", () => {
    for (const bloco of [ROOT, DARK]) {
      for (const token of ["--surface-sunken", "--text-tertiary"]) {
        const hsl = tripletParaHsl(bloco.get(token))!;
        expect(hsl.h).toBeGreaterThanOrEqual(195);
        expect(hsl.h).toBeLessThanOrEqual(210);
      }
    }
  });

  it("os valores antigos de :root e .dark não mudaram (admin, login e prévia do admin iguais)", () => {
    expect(ROOT.get("--background")).toBe("0 0% 98%");
    expect(ROOT.get("--card")).toBe("0 0% 100%");
    expect(ROOT.get("--muted")).toBe("0 0% 92%");
    expect(ROOT.get("--border")).toBe("0 0% 88%");
    expect(ROOT.get("--sidebar-background")).toBe("0 0% 96%");
    expect(ROOT.get("--shadow-card")).toBe("0 4px 24px -4px hsla(0, 0%, 0%, 0.08)");
    expect(ROOT.get("--gradient-bg")).toContain("linear-gradient");
    expect(DARK.get("--background")).toBe("0 0% 8%");
    expect(DARK.get("--card")).toBe("0 0% 11%");
    expect(DARK.get("--sidebar-background")).toBe("0 0% 6%");
    // Variáveis de forma do kit: fora da casca reproduzem o visual atual.
    expect(ROOT.get("--crm-card-shadow")).toBe("0 1px 2px 0 rgb(0 0 0 / 0.05)");
    expect(ROOT.get("--crm-btn-shadow")).toBe("none");
  });
});

describe("index.css: fallbacks batem com o CSS da marca padrão", () => {
  const css = cssDaMarca(null);
  const DESTAQUES = ["--primary-hover", "--primary-soft", "--primary-soft-2", "--primary-soft-fg", ...Array.from({ length: 8 }, (_, i) => `--chart-${i + 1}`)];

  it("destaques novos de :root/.dark = gerados para o azul padrão", () => {
    for (const token of DESTAQUES) {
      expect(ROOT.get(token), token).toBe(tokenNoBloco(css, "html:not(.dark)", token));
      expect(DARK.get(token), token).toBe(tokenNoBloco(css, "html.dark", token));
    }
  });

  it("todo token da casca que a marca também escreve sai na casca da marca (0,3,1), então a marca vence", () => {
    const daMarca = new Set([...css.matchAll(/(--[\w-]+):/g)].map((m) => m[1]));
    for (const [bloco, seletor] of [
      [CRM_CLARO, CASCA_CLARO],
      [CRM_ESCURO, CASCA_ESCURO],
    ] as const) {
      for (const token of bloco.keys()) {
        if (token === "--background" || token === "--surface-sunken" || daMarca.has(token)) {
          expect(tokenNoBloco(css, seletor, token), `${seletor} ${token}`).not.toBeNull();
        }
      }
    }
  });

  it("sidebar de fallback = sidebar gerada para o azul padrão", () => {
    for (const [bloco, seletor] of [
      [CRM_CLARO, CASCA_CLARO],
      [CRM_ESCURO, CASCA_ESCURO],
    ] as const) {
      for (const token of [...bloco.keys()].filter((t) => t.startsWith("--sidebar-") || t === "--brand-shadow")) {
        expect(bloco.get(token), token).toBe(tokenNoBloco(css, seletor, token));
      }
    }
  });
});
