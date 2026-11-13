// A mermaid diagram drawn in the page's own colours: the base theme, its variables read from the design tokens.

export type ReadToken = (token: string) => string;

const VARIABLE_TOKENS: Record<string, string> = {
  background: "--bg",
  primaryColor: "--bg-surface",
  primaryTextColor: "--text",
  primaryBorderColor: "--border",
  lineColor: "--text-muted",
  secondaryColor: "--bg-hover",
  tertiaryColor: "--bg",
  noteBkgColor: "--bg-hover",
  noteTextColor: "--text",
  clusterBkg: "--bg-hover",
  clusterBorder: "--border",
  edgeLabelBackground: "--bg-surface",
  actorBkg: "--bg-surface",
  actorBorder: "--border",
  actorTextColor: "--text",
  signalColor: "--text",
  signalTextColor: "--text",
  labelTextColor: "--text",
  textColor: "--text",
  fontFamily: "--font-sans",
};

export interface MermaidTheme {
  theme: "base";
  themeVariables: Record<string, string | boolean>;
}

export function mermaidThemeOf(
  read: ReadToken,
  scheme: "light" | "dark",
): MermaidTheme {
  const defined = Object.entries(VARIABLE_TOKENS)
    .map(([variable, token]) => [variable, read(token).trim()] as const)
    .filter(([, value]) => value !== "");

  return {
    theme: "base",
    themeVariables: {
      darkMode: scheme === "dark",
      ...Object.fromEntries(defined),
    },
  };
}

/** The tokens as the document resolves them now, after the theme switcher set its attributes. */
export function documentTokens(): ReadToken {
  const style = getComputedStyle(document.documentElement);

  return (token) => style.getPropertyValue(token);
}
