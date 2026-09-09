/** Defense-in-depth sanitizers for untrusted LLM-generated mockup markup/CSS in a GapResult, applied before persistence. */

import type { GapMockup, GapResult } from "./gap-result.js";

const SCRIPT_RE = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
const FOREIGN_OBJECT_RE = /<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject>/gi;
const EVENT_HANDLER_RE = /\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const HREF_RE = /\s+(?:xlink:)?href\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const SAFE_HREF_RE = /^(#|data:image\/)/i;

/** Defense-in-depth sanitizer for LLM-generated mockup SVG: strips `<script>`/`<foreignObject>`, inline event handlers, and unsafe href/xlink:href values before persistence. */
export function sanitizeSvg(markup: string): string {
  return markup
    .replace(SCRIPT_RE, "")
    .replace(FOREIGN_OBJECT_RE, "")
    .replace(EVENT_HANDLER_RE, "")
    .replace(HREF_RE, (match, value: string) => {
      const unquoted = value.replace(/^["']|["']$/g, "");

      return SAFE_HREF_RE.test(unquoted) ? match : "";
    });
}

const CSS_IMPORT_RE = /@import\s+[^;]*;?/gi;
const CSS_URL_RE = /url\s*\([^)]*\)/gi;

/** Strips `@import` and `url()` — the only things in agent-authored CSS that reach outside the sandboxed, network-less mockup frame. */
export function sanitizeMockupCss(css: string): string {
  return css.replace(CSS_IMPORT_RE, "").replace(CSS_URL_RE, "none");
}

/** Markup sanitisation by format — mermaid is source, not markup, so the SVG sanitizer must skip it. */
function sanitizeMarkup(mockup: GapMockup): string {
  return mockup.format === "mermaid"
    ? mockup.markup
    : sanitizeSvg(mockup.markup);
}

/** Sanitize every mockup's markup across all sections plus the shared stylesheet; returns a copy. */
export function sanitizeGapResult(gap: GapResult): GapResult {
  const sections = gap.sections.map((s) =>
    s.mockups
      ? {
          ...s,
          mockups: s.mockups.map((m) => ({ ...m, markup: sanitizeMarkup(m) })),
        }
      : s,
  );

  return gap.mockup_stylesheet
    ? {
        ...gap,
        sections,
        mockup_stylesheet: sanitizeMockupCss(gap.mockup_stylesheet),
      }
    : { ...gap, sections };
}
