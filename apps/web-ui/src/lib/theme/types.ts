export type ThemeFamily = "elegant" | "retro" | "chicago";

export type ColorSchemePref = "light" | "dark" | "auto";

export type ResolvedScheme = "light" | "dark";

export interface ThemeState {
  family: ThemeFamily;
  scheme: ColorSchemePref;
}
