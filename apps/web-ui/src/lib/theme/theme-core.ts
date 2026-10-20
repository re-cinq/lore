import type { ColorSchemePref, ResolvedScheme, ThemeFamily } from "./types";

export const FAMILY_KEY = "lore-theme-family";
export const SCHEME_KEY = "lore-color-scheme";

export const DEFAULT_FAMILY: ThemeFamily = "lore";
export const DEFAULT_SCHEME: ColorSchemePref = "auto";

export function resolveColorScheme(
  pref: ColorSchemePref,
  systemScheme: ResolvedScheme,
): ResolvedScheme {
  if (pref === "auto") {
    return systemScheme;
  }

  return pref;
}

const FAMILIES: readonly string[] = ["lore", "elegant", "retro", "chicago"];

export function parseFamily(raw: string | null): ThemeFamily {
  return raw !== null && FAMILIES.includes(raw)
    ? (raw as ThemeFamily)
    : DEFAULT_FAMILY;
}

export function parseSchemePref(raw: string | null): ColorSchemePref {
  return raw === "light" || raw === "dark" || raw === "auto"
    ? raw
    : DEFAULT_SCHEME;
}
