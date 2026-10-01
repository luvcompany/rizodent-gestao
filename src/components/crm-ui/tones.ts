/**
 * Tons do redesign (F3). Mapa ESTÁTICO de classes por tom: o purge do Tailwind
 * só enxerga classes escritas por extenso, nunca strings montadas
 * (`bg-${t}-soft` não funciona). Todas as cores vêm dos tokens do F1.
 *
 * Regra de contraste (index.css): texto sobre o fundo suave usa
 * `text-<cor>-soft-foreground` (AA nos dois temas), nunca `text-<cor>`.
 * O forte (`text-<cor>`) fica para ícones e traços (3:1 basta).
 *
 * Cor com significado nunca usa primary (numa marca verde, primary colidiria com
 * success): primary é só para destaque de marca, não para estado.
 */

export const TONES = [
  "primary",
  "success",
  "warning",
  "info",
  "orange",
  "purple",
  "pink",
  "teal",
  "slate",
  "destructive",
  "rescheduled",
  "muted",
] as const;

export type Tone = (typeof TONES)[number];

export interface ToneClasses {
  /** Fundo suave (pílula, chip de ícone). */
  soft: string;
  /** Fundo suave a 60% (tile do MiniStat). */
  tile: string;
  /** Texto sobre o fundo suave (AA). */
  fg: string;
  /** Cor forte para ícone/traço (não usar em texto pequeno sobre o suave). */
  icon: string;
  /** Ponto/marcador sólido. */
  dot: string;
  /** Anel de foco/seleção. */
  ring: string;
}

const MAP: Record<Tone, ToneClasses> = {
  primary: {
    soft: "bg-primary-soft",
    tile: "bg-primary-soft/60",
    fg: "text-primary-soft-fg",
    icon: "text-primary",
    dot: "bg-primary",
    ring: "ring-primary/40",
  },
  success: {
    soft: "bg-success-soft",
    tile: "bg-success-soft/60",
    fg: "text-success-soft-foreground",
    icon: "text-success",
    dot: "bg-success",
    ring: "ring-success/40",
  },
  warning: {
    soft: "bg-warning-soft",
    tile: "bg-warning-soft/60",
    fg: "text-warning-soft-foreground",
    icon: "text-warning",
    dot: "bg-warning",
    ring: "ring-warning/40",
  },
  info: {
    soft: "bg-info-soft",
    tile: "bg-info-soft/60",
    fg: "text-info-soft-foreground",
    icon: "text-info",
    dot: "bg-info",
    ring: "ring-info/40",
  },
  orange: {
    soft: "bg-orange-soft",
    tile: "bg-orange-soft/60",
    fg: "text-orange-soft-foreground",
    icon: "text-orange",
    dot: "bg-orange",
    ring: "ring-orange/40",
  },
  purple: {
    soft: "bg-purple-soft",
    tile: "bg-purple-soft/60",
    fg: "text-purple-soft-foreground",
    icon: "text-purple",
    dot: "bg-purple",
    ring: "ring-purple/40",
  },
  pink: {
    soft: "bg-pink-soft",
    tile: "bg-pink-soft/60",
    fg: "text-pink-soft-foreground",
    icon: "text-pink",
    dot: "bg-pink",
    ring: "ring-pink/40",
  },
  teal: {
    soft: "bg-teal-soft",
    tile: "bg-teal-soft/60",
    fg: "text-teal-soft-foreground",
    icon: "text-teal",
    dot: "bg-teal",
    ring: "ring-teal/40",
  },
  slate: {
    soft: "bg-slate-soft",
    tile: "bg-slate-soft/60",
    fg: "text-slate-soft-foreground",
    icon: "text-slate",
    dot: "bg-slate",
    ring: "ring-slate/40",
  },
  destructive: {
    soft: "bg-destructive-soft",
    tile: "bg-destructive-soft/60",
    fg: "text-destructive-soft-foreground",
    icon: "text-destructive",
    dot: "bg-destructive",
    ring: "ring-destructive/40",
  },
  rescheduled: {
    soft: "bg-rescheduled-soft",
    tile: "bg-rescheduled-soft/60",
    fg: "text-rescheduled-soft-foreground",
    icon: "text-rescheduled",
    dot: "bg-rescheduled",
    ring: "ring-rescheduled/40",
  },
  muted: {
    soft: "bg-muted",
    tile: "bg-muted/60",
    fg: "text-muted-foreground",
    icon: "text-muted-foreground",
    dot: "bg-muted-foreground",
    ring: "ring-muted-foreground/40",
  },
};

/** Classes do tom. Tom desconhecido cai em `muted` (nunca quebra a tela). */
export function toneClasses(tone: Tone | undefined | null): ToneClasses {
  return (tone && MAP[tone]) || MAP.muted;
}

const CSS_VAR: Record<Tone, string> = {
  primary: "--primary",
  success: "--success",
  warning: "--warning",
  info: "--info",
  orange: "--orange",
  purple: "--purple",
  pink: "--pink",
  teal: "--teal",
  slate: "--slate",
  destructive: "--destructive",
  rescheduled: "--rescheduled",
  muted: "--muted-foreground",
};

/** Cor forte do tom como valor CSS (`hsl(var(--x))`), para SVG e gráficos. */
export function toneColor(tone: Tone | undefined | null): string {
  const v = (tone && CSS_VAR[tone]) || CSS_VAR.muted;
  return `hsl(var(${v}))`;
}

export function isTone(value: unknown): value is Tone {
  return typeof value === "string" && (TONES as readonly string[]).includes(value);
}
