export type ThemeFamily = "elegant" | "retro";

export type ColorSchemePref = "light" | "dark" | "auto";

export type ResolvedScheme = "light" | "dark";

export interface ThemeState {
  family: ThemeFamily;
  scheme: ColorSchemePref;
}
