import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Users, Inbox } from "lucide-react";
import ChannelBadgeIcon from "@/components/chat/ChannelBadgeIcon";
import {
  TONES,
  toneClasses,
  toneColor,
  PageHeader,
  SectionCard,
  KpiCard,
  MiniStat,
  ChartCard,
  ChartTooltip,
  PillTabs,
  StatusPill,
  hexWithAlpha,
  ChannelIcon,
  normalizeChannel,
  conversationChannel,
  InitialsAvatar,
  initialsOf,
  ListRow,
  EmptyState,
  ErrorBanner,
  FilterBar,
  SearchInput,
  Sparkline,
  sparklinePoints,
  buildCrmChartTheme,
  areaGradientStops,
  useCrmChartTheme,
} from "./index";

describe("tones", () => {
  it("todo tom tem mapa estático completo, sem classes montadas", () => {
    for (const t of TONES) {
      const c = toneClasses(t);
      expect(c.soft).toMatch(/^bg-/);
      expect(c.tile).toMatch(/^bg-.+\/60$/);
      expect(c.fg).toMatch(/^text-/);
      expect(c.icon).toMatch(/^text-/);
      expect(c.dot).toMatch(/^bg-/);
      expect(c.ring).toMatch(/^ring-.+\/40$/);
    }
  });

  it("texto sobre o suave usa -soft-foreground (AA); primary e muted são exceções documentadas", () => {
    expect(toneClasses("primary")).toMatchObject({ soft: "bg-primary-soft", fg: "text-primary-soft-fg" });
    expect(toneClasses("muted")).toMatchObject({ soft: "bg-muted", fg: "text-muted-foreground" });
    for (const t of TONES.filter((x) => x !== "primary" && x !== "muted")) {
      expect(toneClasses(t).fg).toBe(`text-${t}-soft-foreground`);
      expect(toneClasses(t).soft).toBe(`bg-${t}-soft`);
    }
  });

  it("tom desconhecido cai em muted e toneColor devolve var CSS", () => {
    expect(toneClasses("xyz" as never)).toEqual(toneClasses("muted"));
    expect(toneColor("success")).toBe("hsl(var(--success))");
    expect(toneColor("muted")).toBe("hsl(var(--muted-foreground))");
  });
});

describe("PageHeader", () => {
  it("renderiza título h1, subtítulo e ações", () => {
    render(<PageHeader title="Título X" subtitle="Sub Y" actions={<button>Ação</button>} icon={Users} />);
    expect(screen.getByRole("heading", { level: 1, name: "Título X" })).toBeInTheDocument();
    expect(screen.getByText("Sub Y")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ação" })).toBeInTheDocument();
  });

  it("breadcrumb: trecho com `to` vira link, sem `to` fica texto; barra é aria-hidden", () => {
    const { container } = render(
      <MemoryRouter>
        <PageHeader title="Criar" breadcrumb={[{ label: "Lista", to: "/x" }, { label: "Grupo" }]} />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "Lista" });
    expect(link).toHaveAttribute("href", "/x");
    expect(screen.queryByRole("link", { name: "Grupo" })).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Lista/Grupo/Criar");
    container.querySelectorAll("span.text-tertiary").forEach((el) => expect(el).toHaveAttribute("aria-hidden", "true"));
  });
});

describe("SectionCard / ChartCard", () => {
  it("SectionCard sem cabeçalho quando não há título/ações; repassa ref e props", () => {
    const ref = React.createRef<HTMLElement>();
    render(
      <SectionCard ref={ref} data-testid="sc" padding="lg">
        corpo
      </SectionCard>,
    );
    const el = screen.getByTestId("sc");
    expect(ref.current).toBe(el);
    expect(el.tagName).toBe("DIV");
    expect(el.className).toContain("p-6");
    expect(el.className).toContain("rounded-card");
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("SectionCard com título, descrição, ícone de tom e `as`", () => {
    render(
      <SectionCard as="section" title="Seção" description="Desc" icon={Users} iconTone="success" data-testid="sc" />,
    );
    expect(screen.getByTestId("sc").tagName).toBe("SECTION");
    expect(screen.getByRole("heading", { level: 3, name: "Seção" })).toBeInTheDocument();
    expect(screen.getByText("Desc")).toBeInTheDocument();
    expect(screen.getByTestId("sc").querySelector(".bg-success-soft")).not.toBeNull();
  });

  it("ChartCard aplica altura ao corpo", () => {
    render(
      <ChartCard title="Gráfico" subtitle="Período" height={240}>
        <div data-testid="chart" />
      </ChartCard>,
    );
    expect(screen.getByRole("heading", { name: "Gráfico" })).toBeInTheDocument();
    expect(screen.getByTestId("chart").parentElement).toHaveStyle({ height: "240px" });
  });
});

describe("KpiCard", () => {
  it("sem delta e sem spark não renderiza nenhum dos dois", () => {
    const { container } = render(<KpiCard label="Leads" value="248" icon={Users} />);
    expect(screen.getByText("Leads")).toBeInTheDocument();
    expect(screen.getByText("248")).toBeInTheDocument();
    expect(screen.queryByTestId("kpi-delta")).toBeNull();
    expect(screen.queryByTestId("kpi-spark")).toBeNull();
    expect(container.querySelector("linearGradient")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("spark com menos de 2 pontos válidos não aparece (nunca inventa série)", () => {
    render(<KpiCard label="L" value="1" spark={[5, null, Number.NaN]} />);
    expect(screen.queryByTestId("kpi-spark")).toBeNull();
  });

  it("delta e spark aparecem quando vêm; delta positivo usa success-soft-foreground", () => {
    render(
      <KpiCard
        label="L"
        value="1"
        tone="info"
        delta={{ value: "+12%", positive: true, caption: "vs. ontem" }}
        spark={[1, 3, 2, 5]}
      />,
    );
    const delta = screen.getByTestId("kpi-delta");
    expect(delta).toHaveTextContent("+12%");
    expect(delta).toHaveTextContent("vs. ontem");
    expect(delta.querySelector(".text-success-soft-foreground")).not.toBeNull();
    expect(screen.getByTestId("kpi-spark")).toBeInTheDocument();
  });

  it("delta negativo usa destructive-soft-foreground", () => {
    render(<KpiCard label="L" value="1" delta={{ value: "-3%", positive: false }} />);
    expect(screen.getByTestId("kpi-delta").querySelector(".text-destructive-soft-foreground")).not.toBeNull();
  });

  it("com onClick vira button acessível e dispara o clique", () => {
    const onClick = vi.fn();
    render(<KpiCard label="Agendamentos" value="86" onClick={onClick} />);
    const btn = screen.getByRole("button", { name: /Agendamentos/ });
    expect(btn).toHaveAttribute("type", "button");
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("loading troca o número por esqueleto e marca aria-busy", () => {
    render(<KpiCard label="L" value="999" loading data-testid="k" />);
    expect(screen.queryByText("999")).toBeNull();
    expect(screen.getByTestId("kpi-loading")).toBeInTheDocument();
    expect(screen.getByTestId("k")).toHaveAttribute("aria-busy", "true");
  });

  it("chip do ícone usa o tom", () => {
    const { container } = render(<KpiCard label="L" value="1" icon={Users} tone="purple" />);
    expect(container.querySelector(".bg-purple-soft.text-purple")).not.toBeNull();
  });
});

describe("MiniStat", () => {
  it("renderiza rótulo, valor, hint e tile do tom", () => {
    render(<MiniStat label="Total" value="1.248" hint="h" tone="teal" data-testid="ms" />);
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.getByText("1.248")).toBeInTheDocument();
    expect(screen.getByTestId("ms").className).toContain("bg-teal-soft/60");
  });
});

describe("ChartTooltip", () => {
  it("não renderiza inativo ou sem payload", () => {
    const { container } = render(<ChartTooltip active={false} payload={[{ value: 1 }]} />);
    expect(container.firstChild).toBeNull();
    const { container: c2 } = render(<ChartTooltip active payload={[]} />);
    expect(c2.firstChild).toBeNull();
  });

  it("renderiza rótulo e valores, com formatter (valor ou [valor, nome])", () => {
    render(
      <ChartTooltip
        active
        label="28/09"
        payload={[
          { name: "a", value: 86, color: "hsl(var(--chart-1))" },
          { name: "b", value: 3 },
        ]}
        formatter={(v, n, _item, i) => (i === 0 ? `${v} un` : [`R$ ${v}`, `Nome ${n}`])}
      />,
    );
    expect(screen.getByText("28/09")).toBeInTheDocument();
    expect(screen.getByText("86 un")).toBeInTheDocument();
    expect(screen.getByText("R$ 3")).toBeInTheDocument();
    expect(screen.getByText("Nome b")).toBeInTheDocument();
  });

  it("não usa color-mix (seguro no html2canvas)", () => {
    const { container } = render(<ChartTooltip active label="x" payload={[{ name: "a", value: 1, color: "#123456" }]} />);
    expect(container.innerHTML).not.toContain("color-mix");
  });
});

describe("PillTabs", () => {
  const items = [
    { value: "kanban", label: "Kanban", count: 3 },
    { value: "lista", label: "Lista" },
    { value: "off", label: "Off", disabled: true },
  ] as const;

  it("role tablist/tab, aria-selected e onChange no clique", () => {
    const onChange = vi.fn();
    render(<PillTabs items={items} value="kanban" onChange={onChange} />);
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveAttribute("aria-selected", "false");
    expect(tabs[0]).toHaveTextContent("3");
    fireEvent.click(tabs[1]);
    expect(onChange).toHaveBeenCalledWith("lista");
    // Clicar na já ativa não dispara
    fireEvent.click(tabs[0]);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("roving tabindex e setas do teclado pulam desabilitada", () => {
    const Wrapper = () => {
      const [v, setV] = React.useState<(typeof items)[number]["value"]>("kanban");
      return <PillTabs items={items} value={v} onChange={setV} />;
    };
    render(<Wrapper />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs[0]).toHaveAttribute("tabindex", "0");
    expect(tabs[1]).toHaveAttribute("tabindex", "-1");
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: "ArrowRight" });
    expect(screen.getAllByRole("tab")[1]).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(screen.getAllByRole("tab")[1]);
    // "off" está desabilitada: da "lista" a seta direita volta para "kanban"
    fireEvent.keyDown(screen.getAllByRole("tab")[1], { key: "ArrowRight" });
    expect(screen.getAllByRole("tab")[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getAllByRole("tab")[0], { key: "End" });
    expect(screen.getAllByRole("tab")[1]).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("tab")[2]).toBeDisabled();
  });

  it("aba ativa usa bg-primary + shadow-brand; inativa não", () => {
    render(<PillTabs items={items} value="lista" onChange={() => {}} />);
    const [a, b] = screen.getAllByRole("tab");
    expect(b.className).toContain("bg-primary");
    expect(b.className).toContain("shadow-brand");
    expect(a.className).not.toContain("shadow-brand");
  });

  it("semantics='buttons' mantém papel button com aria-pressed (sem trocar o papel no inventário)", () => {
    const onChange = vi.fn();
    render(<PillTabs items={items} value="kanban" onChange={onChange} semantics="buttons" aria-label="Modo" />);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByRole("group", { name: "Modo" })).toBeInTheDocument();
    const kanban = screen.getByRole("button", { name: /Kanban/ });
    expect(kanban).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Lista" }));
    expect(onChange).toHaveBeenCalledWith("lista");
  });

  it("repassa ref ao contêiner", () => {
    const ref = React.createRef<HTMLDivElement>();
    render(<PillTabs ref={ref} items={items} value="kanban" onChange={() => {}} />);
    expect(ref.current).toBe(screen.getByRole("tablist"));
  });
});

describe("StatusPill", () => {
  it("tom: fundo suave + texto -soft-foreground; ponto opcional", () => {
    const { container } = render(
      <StatusPill tone="info" dot title="t">
        Em atendimento
      </StatusPill>,
    );
    const pill = screen.getByTitle("t");
    expect(pill.className).toContain("bg-info-soft");
    expect(pill.className).toContain("text-info-soft-foreground");
    expect(pill).toHaveTextContent("Em atendimento");
    expect(container.querySelector(".bg-current")).not.toBeNull();
  });

  it("cor do banco em hex: texto neutro, cor no ponto e fundo em hex com alfa 24 (sem color-mix)", () => {
    const { container } = render(
      <StatusPill color="#18845A" data-testid="p">
        Etapa
      </StatusPill>,
    );
    const pill = screen.getByTestId("p");
    expect(pill.getAttribute("style")).not.toContain("color-mix");
    expect(pill.style.color).toBe("");
    expect(pill.className).toContain("text-foreground");
    // jsdom normaliza #18845A24 para rgba(...)
    expect(pill.style.backgroundColor.replace(/\s/g, "")).toMatch(/^rgba\(24,132,90,0\.14/);
    expect(pill.className).not.toContain("bg-muted");
    const dot = container.querySelector("span[aria-hidden].rounded-full") as HTMLElement;
    expect(dot.style.backgroundColor).toBe("rgb(24, 132, 90)");
  });

  it("cor do banco: textColor mantém o texto pintado quando a tela precisa; dot=false tira o ponto", () => {
    const { container } = render(
      <StatusPill color="#18845A" textColor="#18845A" dot={false} data-testid="p">
        Etapa
      </StatusPill>,
    );
    const pill = screen.getByTestId("p");
    expect(pill.style.color).toBe("rgb(24, 132, 90)");
    expect(pill.className).not.toContain("text-foreground");
    expect(container.querySelector("span[aria-hidden].rounded-full")).toBeNull();
  });

  it("cor do banco fora de hex usa camada com opacidade", () => {
    const { container } = render(
      <StatusPill color="rgb(10, 20, 30)" data-testid="p">
        X
      </StatusPill>,
    );
    expect(screen.getByTestId("p").style.backgroundColor).toBe("");
    expect(container.querySelector("[aria-hidden].opacity-\\[0\\.14\\]")).not.toBeNull();
    expect(container.innerHTML).not.toContain("color-mix");
  });

  it("hexWithAlpha", () => {
    expect(hexWithAlpha("#abc")).toBe("#aabbcc24");
    expect(hexWithAlpha("#18845A")).toBe("#18845A24");
    expect(hexWithAlpha("#18845A80")).toBeNull();
    expect(hexWithAlpha("hsl(1 2% 3%)")).toBeNull();
  });
});

describe("ChannelIcon", () => {
  it("normaliza origens cruas", () => {
    expect(normalizeChannel("WhatsApp")).toBe("whatsapp");
    expect(normalizeChannel("instagram_ad")).toBe("instagram");
    expect(normalizeChannel("Facebook Ads")).toBe("facebook");
    expect(normalizeChannel("google")).toBe("google");
    expect(normalizeChannel("Indicação")).toBe("indicacao");
    expect(normalizeChannel("telefone")).toBe("phone");
    expect(normalizeChannel("site")).toBeNull();
    expect(normalizeChannel("")).toBeNull();
  });

  it("modo conversa (padrão) tem paridade com o ChannelBadgeIcon nas origens reais", () => {
    const origens: Array<string | null> = [
      "whatsapp", "facebook_ad", "instagram_ad", "google_ads", "Anúncio", "Instagram",
      "instagram", "Instagram Lite (@loja)", "indicação", "Indicação", "orgânico", "site",
      "Site", "ligação", "outro", "Outros", "Retroativo", "SEM ANÚNCIO", "comentário", "direct", "", null,
    ];
    for (const o of origens) {
      const antes = render(<ChannelBadgeIcon source={o} size={16} />);
      const altAntes = antes.container.querySelector("img")?.getAttribute("alt");
      const srcAntes = antes.container.querySelector("img")?.getAttribute("src");
      antes.unmount();
      const depois = render(<ChannelIcon channel={o} size={16} />);
      const img = depois.container.querySelector("img");
      expect(img?.getAttribute("alt"), String(o)).toBe(altAntes);
      expect(img?.getAttribute("src"), String(o)).toBe(srcAntes);
      expect(depois.container.querySelector("[aria-hidden='true']"), String(o)).toBeNull();
      expect(depois.container.firstElementChild?.getAttribute("data-channel")).toBe(conversationChannel(o));
      depois.unmount();
    }
    expect(conversationChannel("instagram_ad")).toBe("whatsapp");
    expect(conversationChannel(null)).toBe("whatsapp");
    expect(conversationChannel("Instagram Lite (@x)")).toBe("instagram");
  });

  it("modo origem: WhatsApp/Instagram reusam o ChannelBadgeIcon (img com alt)", () => {
    render(
      <>
        <ChannelIcon variant="origem" channel="whatsapp" />
        <ChannelIcon variant="origem" channel="instagram_ad" />
      </>,
    );
    expect(screen.getByRole("img", { name: "WhatsApp" }).tagName).toBe("IMG");
    expect(screen.getByRole("img", { name: "Instagram" }).tagName).toBe("IMG");
  });

  it("modo origem: Facebook/Google com nome acessível; telefone/indicação/desconhecido decorativos", () => {
    const { container } = render(
      <>
        <ChannelIcon variant="origem" channel="facebook" />
        <ChannelIcon variant="origem" channel="google" />
        <ChannelIcon variant="origem" channel="phone" />
        <ChannelIcon variant="origem" channel="indicacao" />
        <ChannelIcon variant="origem" channel="outro" />
      </>,
    );
    expect(screen.getByRole("img", { name: "Facebook" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Google" })).toBeInTheDocument();
    expect(container.querySelector('[data-channel="phone"]')).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector('[data-channel="indicacao"] .text-warning')).not.toBeNull();
    expect(container.querySelector('[data-channel="unknown"] .text-tertiary')).not.toBeNull();
  });

  it("label explícito vira nome acessível", () => {
    render(
      <>
        <ChannelIcon variant="origem" channel="phone" label="Ligação" />
        <ChannelIcon channel="whatsapp" label="Canal: WhatsApp" />
      </>,
    );
    expect(screen.getByRole("img", { name: "Ligação" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Canal: WhatsApp" })).toBeInTheDocument();
  });
});

describe("InitialsAvatar", () => {
  it("iniciais: regra das telas (duas primeiras palavras); uma palavra = 1 letra; ignora emoji", () => {
    const telas = (n: string) => n.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
    for (const n of ["Maria da Silva", "João Pedro Santos", "Amanda Ferreira Lima", "Amanda Ferreira", "Clinica", "Érica Ávila"]) {
      expect(initialsOf(n), n).toBe(telas(n));
    }
    expect(initialsOf("maria da silva")).toBe("MD");
    expect(initialsOf("  ")).toBe("");
    expect(initialsOf("😀 Ana")).toBe("A");
  });

  it("sem foto mostra iniciais em primary-soft, visíveis no nome acessível; com canal desenha o selo", () => {
    const { container } = render(
      <button type="button">
        <InitialsAvatar name="Maria da Silva" size={44} channel="instagram_ad" />
        Maria da Silva
      </button>,
    );
    const ini = screen.getByText("MD");
    expect(ini.className).toContain("bg-primary-soft");
    expect(ini).not.toHaveAttribute("aria-hidden");
    expect(container.querySelector(".h-11")).not.toBeNull();
    // Paridade com o selo atual: anúncio do Instagram é conversa de WhatsApp.
    expect(screen.getByRole("button")).toHaveAccessibleName("MD WhatsApp Maria da Silva");
  });

  it("initials da tela vence; decorative esconde; channel null desenha o selo e ausente não", () => {
    const { container, rerender } = render(<InitialsAvatar name="Ana Souza" initials="XY" decorative channel={null} />);
    expect(screen.getByText("XY")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("img", { name: "WhatsApp" })).toBeInTheDocument();
    rerender(<InitialsAvatar name="Ana Souza" />);
    expect(container.querySelector("img")).toBeNull();
    rerender(<InitialsAvatar name="Ana Souza" channel="facebook_ad" channelVariant="origem" />);
    expect(screen.getByRole("img", { name: "Facebook" })).toBeInTheDocument();
  });

  it("com foto usa <img> e volta às iniciais se a foto quebrar", () => {
    const { container } = render(<InitialsAvatar name="Ana Souza" src="https://x/y.png" alt="Ana" />);
    const img = screen.getByRole("img", { name: "Ana" });
    act(() => {
      fireEvent.error(img);
    });
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("AS")).toBeInTheDocument();
  });
});

describe("ListRow", () => {
  it("com onClick vira button, chama o clique e marca aria-current quando ativa", () => {
    const onClick = vi.fn();
    render(
      <ListRow
        title="Amanda"
        subtitle="Prévia"
        meta="21:03"
        trailing={<span>2</span>}
        leading={<span>AV</span>}
        active
        unread
        onClick={onClick}
      />,
    );
    const btn = screen.getByRole("button", { name: /Amanda/ });
    expect(btn).toHaveAttribute("type", "button");
    expect(btn).toHaveAttribute("aria-current", "true");
    expect(btn.className).toContain("bg-primary-soft-2");
    expect(screen.getByText("Amanda").className).toContain("font-semibold");
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalled();
  });

  it("sem onClick é div, sem aria-current; `as` respeitado", () => {
    render(
      <ul>
        <ListRow as="li" title="Item" data-testid="r" />
      </ul>,
    );
    const el = screen.getByTestId("r");
    expect(el.tagName).toBe("LI");
    expect(el).not.toHaveAttribute("aria-current");
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("EmptyState / ErrorBanner / FilterBar", () => {
  it("EmptyState mostra a ação só se vier", () => {
    const { rerender } = render(<EmptyState icon={Inbox} title="Nada aqui" description="Texto" />);
    expect(screen.getByText("Nada aqui")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<EmptyState icon={Inbox} title="Nada aqui" action={<button>Criar</button>} />);
    expect(screen.getByRole("button", { name: "Criar" })).toBeInTheDocument();
  });

  it("ErrorBanner é role=alert; botão só com onRetry, rótulo por prop", () => {
    const { rerender } = render(<ErrorBanner message="Falhou" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Falhou");
    expect(screen.queryByRole("button")).toBeNull();
    const onRetry = vi.fn();
    rerender(<ErrorBanner message="Falhou" onRetry={onRetry} retryLabel="De novo" />);
    fireEvent.click(screen.getByRole("button", { name: "De novo" }));
    expect(onRetry).toHaveBeenCalled();
    rerender(<ErrorBanner message="Falhou" onRetry={onRetry} retryLabel="De novo" retrying />);
    expect(screen.getByRole("button", { name: "De novo" })).toBeDisabled();
  });

  it("FilterBar sticky", () => {
    render(
      <FilterBar sticky data-testid="fb">
        <span>f</span>
      </FilterBar>,
    );
    const el = screen.getByTestId("fb");
    expect(el.className).toContain("sticky");
    expect(el.className).toContain("bg-card/90");
  });
});

describe("SearchInput", () => {
  it("repassa ref e props; mantém papel textbox (não força type=search)", () => {
    const ref = React.createRef<HTMLInputElement>();
    const onChange = vi.fn();
    render(<SearchInput ref={ref} placeholder="Buscar" aria-label="Busca" onChange={onChange} />);
    const input = screen.getByRole("textbox", { name: "Busca" });
    expect(ref.current).toBe(input);
    expect(input).toHaveAttribute("placeholder", "Buscar");
    expect(input.className).toContain("bg-surface-sunken");
    expect(input.className).toContain("pl-10");
    fireEvent.change(input, { target: { value: "ana" } });
    expect(onChange).toHaveBeenCalled();
  });
});

describe("Sparkline", () => {
  it("não renderiza com menos de 2 pontos", () => {
    const { container } = render(<Sparkline data={[3]} />);
    expect(container.firstChild).toBeNull();
  });

  it("desenha linha e área com a cor do tom; decorativo por padrão", () => {
    const { container } = render(<Sparkline data={[1, 4, 2]} tone="success" />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg.querySelectorAll("path")).toHaveLength(2);
    expect(container.innerHTML).toContain("var(--success)");
  });

  it("série constante vira linha no meio", () => {
    const pts = sparklinePoints([5, 5, 5], 100, 40);
    expect(pts.every(([, y]) => y === 20)).toBe(true);
  });
});

describe("tema de gráficos", () => {
  it("mantém a API antiga do useChartTheme e lê tokens", () => {
    const t = buildCrmChartTheme(false);
    for (const k of ["axisColor", "gridColor", "labelColor", "tooltipStyle", "tooltipLabelStyle", "tooltipItemStyle", "brandSeries", "isDark"]) {
      expect(t).toHaveProperty(k);
    }
    expect(t.axisColor).toBe("hsl(var(--text-tertiary))");
    expect(t.gridColor).toBe("hsl(var(--border))");
    expect(t.brandSeries).toHaveLength(8);
    expect(t.brandSeries[0]).toBe("hsl(var(--chart-1))");
    expect(t.brandSeries[7]).toBe("hsl(var(--chart-8))");
    expect(String(t.tooltipStyle.background)).toContain("--sidebar-background");
    expect(t.gridProps).toEqual({ vertical: false, strokeDasharray: "3 3", stroke: "hsl(var(--border))" });
    expect(t.axisProps.tick.fontSize).toBe(11);
    expect(t.barRadius).toEqual([6, 6, 0, 0]);
    expect(t.activeBar).toEqual({ fill: "hsl(var(--primary))", fillOpacity: 1 });
    expect(t.lineProps.activeDot).toMatchObject({ r: 5, stroke: "hsl(var(--card))" });
    expect(JSON.stringify(t)).not.toContain("color-mix");
  });

  it("areaGradientStops aceita tom ou cor pronta", () => {
    expect(areaGradientStops("teal")).toEqual([
      { offset: "0%", stopColor: "hsl(var(--teal))", stopOpacity: 0.18 },
      { offset: "100%", stopColor: "hsl(var(--teal))", stopOpacity: 0 },
    ]);
    expect(areaGradientStops("hsl(var(--chart-3))")[0].stopColor).toBe("hsl(var(--chart-3))");
    expect(areaGradientStops()[0].stopColor).toBe("hsl(var(--primary))");
  });

  it("useCrmChartTheme acompanha a classe dark do <html>", async () => {
    let theme: ReturnType<typeof useCrmChartTheme> | null = null;
    const Probe = () => {
      theme = useCrmChartTheme();
      return null;
    };
    document.documentElement.classList.remove("dark");
    render(<Probe />);
    expect(theme!.isDark).toBe(false);
    await act(async () => {
      document.documentElement.classList.add("dark");
      await Promise.resolve();
    });
    expect(theme!.isDark).toBe(true);
    document.documentElement.classList.remove("dark");
  });
});
