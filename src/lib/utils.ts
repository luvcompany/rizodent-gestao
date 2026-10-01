import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * twMerge que conhece os utilitários próprios do projeto (redesign do CRM).
 *
 * Sem este registro, o tailwind-merge não sabe que `rounded-card` é um raio
 * (então `cn("rounded-card", "rounded-xl")` mantinha as duas e quem vencia era
 * a ordem do CSS) e trata `shadow-card`/`shadow-brand` como COR de sombra
 * (`cn("shadow-card", "shadow-brand")` apagava uma delas).
 *
 * - raios (tailwind.config.ts): rounded-card, rounded-control, rounded-float
 *   (e os lados: rounded-t-card etc., pelo tema `borderRadius`);
 * - sombras: shadow-card e shadow-brand (utilitários do index.css), shadow-xs
 *   e shadow-float (tailwind.config.ts) e as do kit, shadow-crm-card,
 *   shadow-crm-float e shadow-crm-float-lg (variáveis com default = visual
 *   antigo fora da casca do CRM), e shadow-crm-brand (sombra da marca que
 *   compõe com o anel de foco).
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      borderRadius: ["card", "control", "float"],
    },
    classGroups: {
      shadow: [{ shadow: ["card", "brand", "xs", "float", "crm-card", "crm-float", "crm-float-lg", "crm-brand"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Retorna a data como string "YYYY-MM-DD" em HORÁRIO LOCAL (fuso do navegador).
 *
 * IMPORTANTE: NÃO use `new Date().toISOString().split("T")[0]` para representar
 * "hoje". Em fusos negativos como BRT (UTC-3), entre ~21:00 e 23:59 do dia local,
 * o `toISOString` retorna o dia seguinte em UTC, gerando bugs em datas de
 * pagamento, filtros e relatórios. Sempre use `toLocalDateISO()`.
 */
export function toLocalDateISO(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

