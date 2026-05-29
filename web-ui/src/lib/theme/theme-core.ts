import type { ColorSchemePref, ResolvedScheme, ThemeFamily } from './types';

export const FAMILY_KEY = 'lore-theme-family';
export const SCHEME_KEY = 'lore-color-scheme';

export const DEFAULT_FAMILY: ThemeFamily = 'elegant';
export const DEFAULT_SCHEME: ColorSchemePref = 'auto';

export function resolveColorScheme(
  pref: ColorSchemePref,
  systemPrefersDark: boolean,
): ResolvedScheme {
  if (pref === 'auto') return systemPrefersDark ? 'dark' : 'light';
  return pref;
}

export function parseFamily(raw: string | null): ThemeFamily {
  return raw === 'elegant' || raw === 'retro' ? raw : DEFAULT_FAMILY;
}

export function parseSchemePref(raw: string | null): ColorSchemePref {
  return raw === 'light' || raw === 'dark' || raw === 'auto'
    ? raw
    : DEFAULT_SCHEME;
}
