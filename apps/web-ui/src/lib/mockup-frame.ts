// Render mockups in sandboxed frames: prevents inline SVG <style> from restyle, isolates sanitization (no-script, no-origin boundary).

import type { GapMockup } from "./feature-types";

/** Default height for undeclared mockups; ceiling for absurd values; frame can't measure itself (no same-origin). */
export const DEFAULT_MOCKUP_HEIGHT = 420;
const MAX_MOCKUP_HEIGHT = 2000;

// Neutral system default, not dashboard theme tokens; wireframe when repo has no styles.
const RESET = `*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
/* An explicit ground and text colour, NOT transparent-and-inherit. A stylesheet
   that references the repo's tokens without defining them leaves every var()
   invalid inside this isolated frame, so the background falls back to transparent
   and the text to black — invisible over a dark dashboard. A mockup is a picture
   of another app; a white ground reads as a screenshot and can never vanish. */
body { background: #ffffff; color: #111111;
  font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
svg, img, table { max-width: 100%; }`;

/** Frame document: markup + stylesheet (repo rules over reset); escape </style> to prevent early block termination. */
export function mockupFrameSrcdoc(markup: string, stylesheet?: string): string {
  // LLM stylesheet is verbatim; escape </style> to prevent parsing as HTML and bypassing sanitizer.
  const safe = stylesheet?.replace(/<\/style>/gi, "<\\/style>") ?? "";
  const css = safe.trim() ? `${RESET}\n${safe}` : RESET;

  return `<style>${css}</style>${markup}`;
}

/** The pixel height to give a mockup's frame. */
export function mockupHeight(mockup: GapMockup): number {
  const declared = mockup.height;

  if (typeof declared !== "number" || !(declared > 0)) {
    return DEFAULT_MOCKUP_HEIGHT;
  }

  return Math.min(declared, MAX_MOCKUP_HEIGHT);
}

// Sanitizer configs: untrusted LLM markup + defense in depth; mermaid SVGs bypass (DOMPurify strips foreignObject, loses labels).
export const MOCKUP_SVG_CONFIG = {
  USE_PROFILES: { svg: true, svgFilters: true },
  FORBID_TAGS: ["script", "foreignObject"],
  FORBID_ATTR: ["onload", "onclick", "onmouseover", "onmouseenter", "onfocus"],
};
export const MOCKUP_HTML_CONFIG = {
  USE_PROFILES: { html: true, svg: true },
  FORBID_TAGS: ["script", "iframe", "object", "embed", "link", "base"],
  FORBID_ATTR: ["onload", "onclick", "onmouseover", "onmouseenter", "onfocus"],
};

/** Frame height needed by rendered mermaid SVG (from viewBox); frame can't self-measure (no same-origin); clamped with padding. */
export function mermaidFrameHeight(svg: string): number | null {
  const viewBox = /viewBox="[-\d.]+ [-\d.]+ [-\d.]+ ([\d.]+)"/.exec(svg);
  const height = viewBox ? Number(viewBox[1]) : NaN;

  if (!(height > 0)) {
    return null;
  }

  return Math.min(Math.ceil(height) + 16, MAX_MOCKUP_HEIGHT);
}

/** A purifier that may or may not have been handed a window yet. */
interface MaybePurifier {
  sanitize?: unknown;
}

/** Sanitize LLM markup; DOMPurify INSTANCE in browser, FACTORY in Node; return empty on server, filled by client after mount. */
export function sanitizeMockupMarkup(
  purifier: MaybePurifier,
  raw: string,
  config: object,
): string {
  return typeof purifier.sanitize === "function"
    ? (purifier.sanitize as (raw: string, config: object) => string)(
        raw,
        config,
      )
    : "";
}
