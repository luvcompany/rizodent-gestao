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
    const axisColor = "hsl(var(--muted-foreground))";
    const gridColor = "hsl(var(--border))";
    const labelColor = "hsl(var(--foreground))";

    const tooltipStyle = {
      background: "hsl(var(--popover))",
      border: "1px solid hsl(var(--border))",
      borderRadius: "10px",
      color: "hsl(var(--popover-foreground))",
      padding: "10px 14px",
      boxShadow: isDark ? "0 8px 24px rgba(0,0,0,0.5)" : "0 8px 24px rgba(0,0,0,0.1)",
    };

    const tooltipLabelStyle = {
      color: "hsl(var(--muted-foreground))",
      fontSize: 12,
      marginBottom: 4,
    };

    const tooltipItemStyle = { color: "hsl(var(--primary))" };

    return {
      axisColor,
      gridColor,
      labelColor,
      tooltipStyle,
      tooltipLabelStyle,
      tooltipItemStyle,
      isDark,
    };
  }, [isDark]);
}
