import { useMemo, useState, useEffect } from "react";

// Theme-aware chart styling hook
// Returns computed values so charts adapt to light/dark mode

export function useChartTheme() {
  const [isDark, setIsDark] = useState(() =>
    document.documentElement.classList.contains("dark")
  );

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return useMemo(() => {
    const axisColor = isDark ? "hsl(0,0%,64%)" : "hsl(0,0%,40%)";
    const gridColor = isDark ? "hsl(0,0%,20%)" : "hsl(0,0%,88%)";
    const labelColor = isDark ? "hsl(0,0%,90%)" : "hsl(0,0%,30%)";

    const tooltipStyle = {
      background: isDark ? "hsl(0,0%,8%)" : "hsl(0,0%,100%)",
      border: `1px solid ${isDark ? "hsl(0,0%,18%)" : "hsl(0,0%,85%)"}`,
      borderRadius: "10px",
      color: isDark ? "#fff" : "#1a1a1a",
      padding: "10px 14px",
      boxShadow: isDark ? "0 8px 24px rgba(0,0,0,0.5)" : "0 8px 24px rgba(0,0,0,0.1)",
    };

    const tooltipLabelStyle = {
      color: isDark ? "hsl(0,0%,70%)" : "hsl(0,0%,45%)",
      fontSize: 12,
      marginBottom: 4,
    };

    // Cor da marca (sistema/cliente) no modo atual.
    const tooltipItemStyle = { color: "hsl(var(--primary))" };

    // Paleta padrão das séries: 3 tons da marca + 3 cores de estado.
    const brandSeries = [
      "hsl(var(--brand-500))",
      "hsl(var(--brand-300))",
      "hsl(var(--brand-700))",
      "hsl(var(--info))",
      "hsl(var(--success))",
      "hsl(var(--warning))",
    ];

    return {
      axisColor,
      gridColor,
      labelColor,
      tooltipStyle,
      tooltipLabelStyle,
      tooltipItemStyle,
      brandSeries,
      isDark,
    };
  }, [isDark]);
}
