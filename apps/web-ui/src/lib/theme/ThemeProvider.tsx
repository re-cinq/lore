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

function systemScheme(): ResolvedScheme {
  const dark =
    typeof window !== "undefined" && window.matchMedia(DARK_QUERY).matches;

  return dark ? "dark" : "light";
}

function applyToDom(family: ThemeFamily, resolved: ResolvedScheme): void {
  const el = document.documentElement;

  el.setAttribute("data-theme-family", family);
  el.setAttribute("data-color-scheme", resolved);
  window.__loreFamily = family;
}

/** A setter that also writes the choice to localStorage, so the inline seed script can restore it on the next load before React runs. */
function usePersisted<T extends string>(
  setState: React.Dispatch<React.SetStateAction<T>>,
  key: string,
): (next: T) => void {
  return useCallback(
    (next: T) => {
      setState(next);
      localStorage.setItem(key, next);
    },
    [setState, key],
  );
}

/** Keeps the document in step with the choice. The second effect exists only for `auto`: the OS can change scheme while the page is open, and nothing re-renders when it does, so the media query has to push the change to the DOM itself. */
function useThemeDom(family: ThemeFamily, scheme: ColorSchemePref): void {
  useEffect(() => {
    applyToDom(family, resolveColorScheme(scheme, systemScheme()));
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
}

/** Seeded from the inline script to avoid flash/hydration mismatch. */
function seedFamily(): ThemeFamily {
  return typeof window !== "undefined"
    ? (window.__loreFamily ??
        parseFamily(document.documentElement.getAttribute("data-theme-family")))
    : DEFAULT_FAMILY;
}

/** Seeded from localStorage, the same key the inline script reads. */
function seedScheme(): ColorSchemePref {
  return typeof window !== "undefined"
    ? parseSchemePref(window.localStorage.getItem(SCHEME_KEY))
    : DEFAULT_SCHEME;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [family, setFamilyState] = useState<ThemeFamily>(seedFamily);
  const [scheme, setSchemeState] = useState<ColorSchemePref>(seedScheme);

  const setFamily = usePersisted(setFamilyState, FAMILY_KEY);
  const setScheme = usePersisted(setSchemeState, SCHEME_KEY);

  useThemeDom(family, scheme);
  const resolvedScheme = resolveColorScheme(scheme, systemScheme());

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
