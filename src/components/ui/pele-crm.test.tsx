import { readFileSync } from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import tailwindConfig from "../../../tailwind.config";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { badgeVariants } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";

// Contrato da pele do CRM no kit (F2). Os valores visuais ficam no index.css,
// sob :where(html:root:has(.crm-shell)); aqui se trava o que o JS decide.

describe("cn conhece os utilitários do projeto", () => {
  it("raio explícito substitui rounded-card/control/float", () => {
    expect(cn("rounded-card", "rounded-xl")).toBe("rounded-xl");
    expect(cn("rounded-control", "rounded-none")).toBe("rounded-none");
    expect(cn("rounded-float", "rounded-lg")).toBe("rounded-lg");
  });

  it("sombra explícita substitui as sombras do kit; cor de sombra convive", () => {
    expect(cn("shadow-crm-card", "shadow-none")).toBe("shadow-none");
    expect(cn("shadow-crm-float", "shadow-lg")).toBe("shadow-lg");
    expect(cn("shadow-sm", "shadow-card")).toBe("shadow-card");
    expect(cn("shadow-card", "shadow-brand")).toBe("shadow-brand");
    expect(cn("shadow-crm-card", "shadow-primary/20")).toBe("shadow-crm-card shadow-primary/20");
  });

  it("className vence as classes com var() do kit", () => {
    expect(cn("border-[color:var(--crm-field-border,hsl(var(--input)))]", "border-destructive")).toBe(
      "border-destructive",
    );
    expect(cn("bg-[color:var(--crm-field-bg,hsl(var(--background)))]", "bg-transparent")).toBe("bg-transparent");
    expect(cn("text-[length:var(--crm-card-title-size,1.5rem)]", "text-sm")).toBe("text-sm");
    expect(cn("h-[var(--crm-th-h,3rem)]", "h-8")).toBe("h-8");
  });
});

describe("Tabs", () => {
  it("variante padrão mantém exatamente as classes de antes", () => {
    render(
      <Tabs defaultValue="a">
        <TabsList data-testid="lista">
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    expect(screen.getByTestId("lista").className).toBe(
      "inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground",
    );
    const aba = screen.getByRole("tab", { name: "A" });
    expect(aba.className).not.toContain("crm-tab-pill");
    expect(aba.className).toContain("data-[state=active]:bg-background");
  });

  it("variant='pill' no TabsList vale para os gatilhos e continua sendo Tabs do Radix", () => {
    render(
      <Tabs defaultValue="a">
        <TabsList variant="pill">
          <TabsTrigger value="a">
            Todas <span className="tab-count">3</span>
          </TabsTrigger>
          <TabsTrigger value="b" variant="default">
            B
          </TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    expect(screen.getByRole("tablist")).toBeTruthy();
    const ativa = screen.getByRole("tab", { name: /Todas/ });
    expect(ativa.getAttribute("data-state")).toBe("active");
    expect(ativa.className).toContain("crm-tab-pill");
    expect(ativa.className).toContain("rounded-full");
    expect(ativa.className).toContain("data-[state=active]:bg-primary");
    expect(ativa.className).not.toContain("data-[state=active]:bg-background");
    // variante no próprio gatilho vence a do TabsList
    expect(screen.getByRole("tab", { name: "B" }).className).not.toContain("crm-tab-pill");
  });
});

describe("variantes", () => {
  it("Badge: as de sempre intactas e as soft-* novas usam o texto AA", () => {
    expect(badgeVariants({ variant: "default" })).toContain("bg-primary text-primary-foreground");
    expect(badgeVariants({ variant: "soft-success" })).toContain("bg-success-soft text-success-soft-foreground");
    expect(badgeVariants({ variant: "soft-primary" })).toContain("bg-primary-soft text-primary-soft-fg");
  });

  it("Button: alturas de sempre", () => {
    expect(buttonVariants({ size: "default" })).toContain("h-10");
    expect(buttonVariants({ size: "sm" })).toContain("h-9");
    expect(buttonVariants({ size: "lg" })).toContain("h-11");
    expect(buttonVariants({ size: "icon" })).toContain("h-10 w-10");
  });
});

// Gera o CSS do Tailwind do projeto só para as classes pedidas.
async function gerarCss(classes: string): Promise<string> {
  const r = await postcss([tailwindcss({ ...tailwindConfig, content: [{ raw: classes, extension: "html" }] })]).process(
    "@tailwind utilities;",
    { from: undefined },
  );
  return r.css;
}

// Especificidade (a, b, c) de um seletor simples, ignorando o que está em :where().
function especificidade(sel: string): [number, number, number] {
  let s = "";
  for (let i = 0; i < sel.length; i++) {
    if (sel.startsWith(":where(", i)) {
      let prof = 0;
      for (let j = i + 6; j < sel.length; j++) {
        if (sel[j] === "(") prof++;
        else if (sel[j] === ")" && --prof === 0) {
          i = j;
          break;
        }
      }
      continue;
    }
    s += sel[i];
  }
  const ids = (s.match(/#[\w-]+/g) || []).length;
  const classes = (s.match(/\.[\w-]+/g) || []).length + (s.match(/\[[^\]]*\]/g) || []).length;
  const pseudoClasses = (s.match(/(^|[^:]):(?!:)[\w-]+/g) || []).length;
  const pseudoEls = (s.match(/::[\w-]+/g) || []).length;
  const tipos = (s.match(/(^|[\s>+~])[a-z][\w-]*/gi) || []).length;
  return [ids, classes + pseudoClasses, tipos + pseudoEls];
}

describe("aba em pílula mantém o anel de foco do teclado", () => {
  it("a sombra da marca da aba ativa vai por --tw-shadow, que compõe com o ring", async () => {
    render(
      <Tabs defaultValue="a">
        <TabsList variant="pill">
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    const cls = screen.getByRole("tab", { name: "A" }).className.split(/\s+/);
    expect(cls).toContain("data-[state=active]:shadow-crm-brand");
    expect(cls).not.toContain("data-[state=active]:shadow-brand");
    expect(cls).toContain("focus-visible:ring-2");

    const css = await gerarCss("data-[state=active]:shadow-crm-brand focus-visible:ring-2");
    let corpo = "";
    postcss.parse(css).walkRules((r) => {
      if (r.selector.includes("shadow-crm-brand") && r.selector.includes("[data-state=")) corpo = r.toString();
    });
    expect(corpo).not.toBe("");
    expect(corpo).toMatch(/--tw-shadow:\s*var\(--brand-shadow\)/);
    // box-shadow lê os anéis: o focus-visible:ring-2 continua aparecendo
    expect(corpo).toMatch(/box-shadow:\s*var\(--tw-ring-offset-shadow[^;]*var\(--tw-ring-shadow[^;]*var\(--tw-shadow\)/);
  });
});

describe("regras da pele no index.css não furam o className da tela", () => {
  const css = readFileSync(path.resolve(__dirname, "../../index.css"), "utf8");
  const ini = css.indexOf("Pele do kit shadcn no CRM (pacote F2)");
  const fim = css.indexOf("@layer utilities", ini);
  const bloco = css.slice(css.lastIndexOf("/*", ini), fim);
  const regras: { sel: string; props: string[] }[] = [];
  postcss.parse(bloco).walkRules((r) => {
    const props: string[] = [];
    r.walkDecls((d) => {
      props.push(d.prop);
    });
    for (const sel of r.selectors) regras.push({ sel, props });
  });

  it("toda regra que define propriedade de verdade pesa no máximo 0,1,0", () => {
    const pesadas = regras
      .filter((r) => r.props.some((p) => !p.startsWith("--")))
      .filter((r) => {
        const [a, b] = especificidade(r.sel);
        return a > 0 || b > 1;
      })
      .map((r) => r.sel);
    expect(regras.length).toBeGreaterThan(10);
    expect(pesadas).toEqual([]);
  });

  it("contador da aba e placeholder do Select estão cobertos pela checagem", () => {
    const sels = regras.map((r) => r.sel);
    expect(sels).toContain(":where(.crm-tab-pill) .tab-count");
    expect(sels).toContain(':where(.crm-tab-pill[data-state="active"]) .tab-count');
    expect(sels).toContain(":where(html:root:has(.crm-shell)) .crm-field:where([data-placeholder])");
    expect(especificidade(':where(.crm-tab-pill[data-state="active"]) .tab-count')).toEqual([0, 1, 0]);
    expect(especificidade(".crm-tab-pill .tab-count")).toEqual([0, 2, 0]);
  });

  it("a sombra da marca do primário só vale com bg-primary", () => {
    const comSombra = regras.filter((r) => r.sel.includes(".crm-btn-default") && r.props.includes("--tw-shadow"));
    expect(comSombra.map((r) => r.sel)).toEqual([
      ':where(html:root:has(.crm-shell)) .crm-btn-default:where([class~="bg-primary"])',
    ]);
  });
});

describe("Button default com fundo próprio não leva a sombra da marca", () => {
  it("bg-* da tela tira o bg-primary da lista (e com ele a sombra)", () => {
    render(
      <>
        <Button>Primário</Button>
        <Button className="bg-green-600 hover:bg-green-700">Verde</Button>
        <Button className="hover:bg-primary/80">Primário com hover</Button>
      </>,
    );
    const primario = screen.getByRole("button", { name: "Primário" }).className.split(/\s+/);
    const verde = screen.getByRole("button", { name: "Verde" }).className.split(/\s+/);
    const hover = screen.getByRole("button", { name: "Primário com hover" }).className.split(/\s+/);
    expect(primario).toEqual(expect.arrayContaining(["crm-btn-default", "bg-primary"]));
    expect(verde).toContain("bg-green-600");
    expect(verde).not.toContain("bg-primary");
    expect(hover).toContain("bg-primary");
  });
});
