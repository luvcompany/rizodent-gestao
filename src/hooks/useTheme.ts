import { useCallback, useEffect, useState } from "react";

/** Tema efetivo aplicado na tela. */
export type Theme = "light" | "dark";
/** O que a pessoa escolheu. "system" segue o sistema operacional. */
export type ThemePreference = Theme | "system";

const CHAVE = "app-theme";
const EVENTO = "app-theme-change";
const PADRAO: ThemePreference = "dark";

function lerPreferencia(): ThemePreference {
  try {
    const v = localStorage.getItem(CHAVE);
    return v === "light" || v === "dark" || v === "system" ? v : PADRAO;
  } catch {
    return PADRAO;
  }
}

function sistemaEscuro(): boolean {
  try {
    return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

function resolver(pref: ThemePreference): Theme {
  if (pref === "system") return sistemaEscuro() ? "dark" : "light";
  return pref;
}

/** Aplica a classe no <html> (mesma regra do script do index.html). */
function aplicarClasse(tema: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", tema === "dark");
  root.classList.toggle("light", tema === "light");
}

/** Grava a preferência, aplica e avisa as outras instâncias do hook. */
export function definirPreferenciaDeTema(pref: ThemePreference) {
  try {
    localStorage.setItem(CHAVE, pref);
  } catch {
    /* armazenamento bloqueado: vale só nesta aba até recarregar */
  }
  aplicarClasse(resolver(pref));
  window.dispatchEvent(new CustomEvent<ThemePreference>(EVENTO, { detail: pref }));
}

/**
 * Tema claro/escuro do app. Todas as instâncias ficam sincronizadas pelo evento
 * 'app-theme-change' (e entre abas pelo evento 'storage').
 *
 * Retorno: theme (efetivo), themePreference (escolha), setTheme, toggleTheme.
 */
export function useTheme() {
  const [themePreference, setPref] = useState<ThemePreference>(lerPreferencia);
  const [theme, setThemeEfetivo] = useState<Theme>(() => resolver(lerPreferencia()));

  // Sincroniza com as outras instâncias e com outras abas.
  useEffect(() => {
    const aoMudar = (e: Event) => {
      const pref = (e as CustomEvent<ThemePreference>).detail ?? lerPreferencia();
      setPref(pref);
      setThemeEfetivo(resolver(pref));
    };
    const aoMudarStorage = (e: StorageEvent) => {
      if (e.key !== CHAVE) return;
      const pref = lerPreferencia();
      aplicarClasse(resolver(pref));
      setPref(pref);
      setThemeEfetivo(resolver(pref));
    };
    window.addEventListener(EVENTO, aoMudar);
    window.addEventListener("storage", aoMudarStorage);
    return () => {
      window.removeEventListener(EVENTO, aoMudar);
      window.removeEventListener("storage", aoMudarStorage);
    };
  }, []);

  // Em "system", acompanha a troca de tema do sistema operacional.
  useEffect(() => {
    if (themePreference !== "system") return;
    let mql: MediaQueryList | null = null;
    try {
      mql = window.matchMedia("(prefers-color-scheme: dark)");
    } catch {
      return;
    }
    if (!mql) return;
    const aoMudar = () => {
      const t = resolver("system");
      aplicarClasse(t);
      setThemeEfetivo(t);
    };
    mql.addEventListener?.("change", aoMudar);
    return () => mql?.removeEventListener?.("change", aoMudar);
  }, [themePreference]);

  // Garante a classe certa no <html> (o index.html já aplica antes do React).
  useEffect(() => {
    aplicarClasse(theme);
  }, [theme]);

  const setTheme = useCallback((pref: ThemePreference) => definirPreferenciaDeTema(pref), []);
  const toggleTheme = useCallback(
    () => definirPreferenciaDeTema(resolver(lerPreferencia()) === "dark" ? "light" : "dark"),
    [],
  );

  return { theme, themePreference, toggleTheme, setTheme };
}
