import { describe, expect, it } from "vitest";
import { mermaidThemeOf } from "./mermaid-theme";

const DARK_TOKENS: Record<string, string> = {
  "--bg": "#000000",
  "--bg-surface": "#1d1d1f",
  "--bg-hover": "#2a2a2c",
  "--border": "#38383a",
  "--text": "#f5f5f7",
  "--text-muted": "#86868b",
  "--accent": "#0a84ff",
  "--font-sans": "Inter, sans-serif",
};

describe("mermaidThemeOf", () => {
  it("draws nodes on the dark surface #1d1d1f with text #f5f5f7 and edges #86868b", () => {
    const theme = mermaidThemeOf((token) => DARK_TOKENS[token] ?? "", "dark");

    expect(theme).toMatchObject({
      theme: "base",
      themeVariables: {
        darkMode: true,
        background: "#000000",
        primaryColor: "#1d1d1f",
        primaryTextColor: "#f5f5f7",
        primaryBorderColor: "#38383a",
        lineColor: "#86868b",
        secondaryColor: "#2a2a2c",
        tertiaryColor: "#000000",
        fontFamily: "Inter, sans-serif",
      },
    });
  });

  it("leaves out a token the page does not define", () => {
    const theme = mermaidThemeOf(() => "", "light");

    expect(theme.themeVariables).toEqual({ darkMode: false });
  });
});
