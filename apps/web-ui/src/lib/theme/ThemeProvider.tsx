"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { ColorSchemePref, ResolvedScheme, ThemeFamily } from "./types";
import {
  DEFAULT_FAMILY,
  DEFAULT_SCHEME,
  FAMILY_KEY,
  SCHEME_KEY,
  parseFamily,
  parseSchemePref,
  resolveColorScheme,
} from "./theme-core";

declare global {
  interface Window {
    __loreFamily?: ThemeFamily;
  }
}

interface ThemeContextValue {
  family: ThemeFamily;
  scheme: ColorSchemePref;
  resolvedScheme: ResolvedScheme;
  setFamily: (family: ThemeFamily) => void;
  setScheme: (scheme: ColorSchemePref) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const DARK_QUERY = "(prefers-color-scheme: dark)";

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia(DARK_QUERY).matches;
}

function applyToDom(family: ThemeFamily, resolved: ResolvedScheme): void {
  const el = document.documentElement;

  el.setAttribute("data-theme-family", family);
  el.setAttribute("data-color-scheme", resolved);
  window.__loreFamily = family;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Seed from what the inline script already wrote, so the first client render
  // matches the DOM (no flash, no icon swap, no hydration mismatch).
  const [family, setFamilyState] = useState<ThemeFamily>(() =>
    typeof window !== "undefined"
      ? (window.__loreFamily ??
        parseFamily(document.documentElement.getAttribute("data-theme-family")))
      : DEFAULT_FAMILY,
  );
  const [scheme, setSchemeState] = useState<ColorSchemePref>(() =>
    typeof window !== "undefined"
      ? parseSchemePref(window.localStorage.getItem(SCHEME_KEY))
      : DEFAULT_SCHEME,
  );

  const setFamily = useCallback((next: ThemeFamily) => {
    setFamilyState(next);
    localStorage.setItem(FAMILY_KEY, next);
  }, []);

  const setScheme = useCallback((next: ColorSchemePref) => {
    setSchemeState(next);
    localStorage.setItem(SCHEME_KEY, next);
  }, []);

  useEffect(() => {
    applyToDom(family, resolveColorScheme(scheme, systemPrefersDark()));
  }, [family, scheme]);

  useEffect(() => {
    if (scheme !== "auto") {
      return;
    }
    const media = window.matchMedia(DARK_QUERY);
    const onChange = () => applyToDom(family, media.matches ? "dark" : "light");

    media.addEventListener("change", onChange);

    return () => media.removeEventListener("change", onChange);
  }, [scheme, family]);

  const resolvedScheme = resolveColorScheme(scheme, systemPrefersDark());

  return (
    <ThemeContext.Provider
      value={{ family, scheme, resolvedScheme, setFamily, setScheme }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);

  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }

  return ctx;
}
