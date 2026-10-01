import { useEffect, useMemo, useState } from "react";
import { buildCrmChartTheme, type CrmChartTheme } from "./chartTheme";

/**
 * Hook do tema de gráficos do redesign. Mesma API e mesmo MutationObserver
 * (classe `dark` no <html>) do src/hooks/useChartTheme.ts, com os valores
 * vindos dos tokens.
 *
 * PENDÊNCIA: trocar o corpo de src/hooks/useChartTheme.ts por este quando a
 * outra sessão liberar src/hooks (os consumidores atuais compilam sem mudança).
 */
export function useCrmChartTheme(): CrmChartTheme {
  const [isDark, setIsDark] = useState(() =>
    typeof document !== "undefined" ? document.documentElement.classList.contains("dark") : false,
  );

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setIsDark(root.classList.contains("dark"));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return useMemo(() => buildCrmChartTheme(isDark), [isDark]);
}
