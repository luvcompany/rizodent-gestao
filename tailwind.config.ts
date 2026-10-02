import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        // --font-sans vem da marca (index.css / <style id="brand-theme">).
        sans: ["var(--font-sans)", "Inter", "sans-serif"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          hover: "hsl(var(--primary-hover))",
          soft: "hsl(var(--primary-soft))",
          "soft-2": "hsl(var(--primary-soft-2))",
          "soft-fg": "hsl(var(--primary-soft-fg))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
          soft: "hsl(var(--destructive-soft))",
          "soft-foreground": "hsl(var(--destructive-soft-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Escala da marca (sistema/cliente), claro e escuro. Ver src/lib/brand/theme.ts.
        brand: {
          50: "hsl(var(--brand-50))",
          100: "hsl(var(--brand-100))",
          200: "hsl(var(--brand-200))",
          300: "hsl(var(--brand-300))",
          400: "hsl(var(--brand-400))",
          500: "hsl(var(--brand-500))",
          600: "hsl(var(--brand-600))",
          700: "hsl(var(--brand-700))",
          800: "hsl(var(--brand-800))",
          900: "hsl(var(--brand-900))",
        },
        // Superfície afundada e texto terciário (só metadado de 11–12px).
        surface: {
          sunken: "hsl(var(--surface-sunken))",
        },
        tertiary: "hsl(var(--text-tertiary))",
        // Estados: fixos, não mudam com a marca. -soft = fundo suave;
        // -soft-foreground = texto sobre o suave (AA nos dois temas).
        internal: {
          DEFAULT: "hsl(var(--internal))",
          foreground: "hsl(var(--internal-foreground))",
          border: "hsl(var(--internal-border))",
          accent: "hsl(var(--internal-accent))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
          soft: "hsl(var(--warning-soft))",
          "soft-foreground": "hsl(var(--warning-soft-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
          soft: "hsl(var(--success-soft))",
          "soft-foreground": "hsl(var(--success-soft-foreground))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
          soft: "hsl(var(--info-soft))",
          "soft-foreground": "hsl(var(--info-soft-foreground))",
        },
        // Famílias novas. orange/purple/pink/teal/slate ESTENDEM a paleta do
        // Tailwind (as classes orange-500, purple-500/15… continuam existindo).
        orange: {
          DEFAULT: "hsl(var(--orange))",
          soft: "hsl(var(--orange-soft))",
          "soft-foreground": "hsl(var(--orange-soft-foreground))",
        },
        purple: {
          DEFAULT: "hsl(var(--purple))",
          soft: "hsl(var(--purple-soft))",
          "soft-foreground": "hsl(var(--purple-soft-foreground))",
        },
        pink: {
          DEFAULT: "hsl(var(--pink))",
          soft: "hsl(var(--pink-soft))",
          "soft-foreground": "hsl(var(--pink-soft-foreground))",
        },
        teal: {
          DEFAULT: "hsl(var(--teal))",
          soft: "hsl(var(--teal-soft))",
          "soft-foreground": "hsl(var(--teal-soft-foreground))",
        },
        slate: {
          DEFAULT: "hsl(var(--slate))",
          soft: "hsl(var(--slate-soft))",
          "soft-foreground": "hsl(var(--slate-soft-foreground))",
        },
        rescheduled: {
          DEFAULT: "hsl(var(--rescheduled))",
          soft: "hsl(var(--rescheduled-soft))",
          "soft-foreground": "hsl(var(--rescheduled-soft-foreground))",
        },
        // Séries de gráfico (1 = marca). Ver theme.ts.
        chart: {
          1: "hsl(var(--chart-1))",
          2: "hsl(var(--chart-2))",
          3: "hsl(var(--chart-3))",
          4: "hsl(var(--chart-4))",
          5: "hsl(var(--chart-5))",
          6: "hsl(var(--chart-6))",
          7: "hsl(var(--chart-7))",
          8: "hsl(var(--chart-8))",
        },
        // Eventos do calendário: bg-event-<cor>-bg, border-event-<cor>-bar, text-event-<cor>-fg.
        event: {
          purple: { bg: "hsl(var(--event-purple-bg))", bar: "hsl(var(--event-purple-bar))", fg: "hsl(var(--event-purple-fg))" },
          green: { bg: "hsl(var(--event-green-bg))", bar: "hsl(var(--event-green-bar))", fg: "hsl(var(--event-green-fg))" },
          pink: { bg: "hsl(var(--event-pink-bg))", bar: "hsl(var(--event-pink-bar))", fg: "hsl(var(--event-pink-fg))" },
          orange: { bg: "hsl(var(--event-orange-bg))", bar: "hsl(var(--event-orange-bar))", fg: "hsl(var(--event-orange-fg))" },
          blue: { bg: "hsl(var(--event-blue-bg))", bar: "hsl(var(--event-blue-bar))", fg: "hsl(var(--event-blue-fg))" },
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
          muted: "hsl(var(--sidebar-muted))",
          active: "hsl(var(--sidebar-active))",
          "active-foreground": "hsl(var(--sidebar-active-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        // Raios do kit no CRM (index.css, bloco crm-shell). Fora da casca, as
        // variáveis não existem e o fallback é o raio de hoje (= lg e md),
        // avaliado no próprio elemento.
        card: "var(--crm-radius-card, var(--radius))",
        control: "var(--crm-radius-control, calc(var(--radius) - 2px))",
        // Superfície flutuante do kit (Popover, menus, Select, Tooltip): 16px
        // na casca; fora dela = rounded-md de hoje.
        float: "var(--crm-radius-card, calc(var(--radius) - 2px))",
      },
      // shadow-card e shadow-brand já são utilitários do index.css (não
      // duplicar aqui). Novas: shadow-xs e shadow-float.
      // shadow-crm-*: sombras do kit (F2). Viram --tw-shadow, então compõem
      // com ring-* como as de hoje. Fora da casca do CRM reproduzem exatamente
      // shadow-sm (card), shadow-md (float) e shadow-lg (float-lg) do Tailwind.
      boxShadow: {
        xs: "var(--shadow-xs)",
        float: "var(--shadow-float)",
        "crm-card": "var(--crm-card-shadow, 0 1px 2px 0 rgb(0 0 0 / 0.05))",
        "crm-float": "var(--crm-float-shadow, 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1))",
        "crm-float-lg": "var(--crm-float-shadow, 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1))",
        // Sombra da marca como sombra de TEMA (vira --tw-shadow e compõe com os
        // ring-*). O utilitário .shadow-brand do index.css troca o box-shadow
        // inteiro e apaga o anel de foco; use este quando o elemento tem foco.
        "crm-brand": "var(--brand-shadow)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in": {
          from: { opacity: "0", transform: "translateX(-10px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.4s ease-out",
        "slide-in": "slide-in 0.3s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
