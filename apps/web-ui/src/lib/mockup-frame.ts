// The document a mockup is rendered inside.
//
// Every mockup — svg, rendered mermaid, or html — goes into its own sandboxed
// frame rather than into this page. Two reasons, and the second is the one that
// forced it: a `<style>` block inside an INLINE svg applies document-wide, so a
// mockup carrying the planned repo's CSS would restyle the wizard around it; and a
// frame with no scripting and no same-origin is a boundary that holds for all
// three formats instead of one sanitizer per format.

import type { GapMockup } from "./feature-types";

/** Height for a mockup that declared none, and the ceiling for one that declared
 *  something absurd. The frame cannot measure itself (no same-origin access), so
 *  an undeclared height is a guess by construction. */
export const DEFAULT_MOCKUP_HEIGHT = 420;
const MAX_MOCKUP_HEIGHT = 2000;

// Deliberately NOT the dashboard's theme tokens. A mockup pictures the PLANNED
// repository; when that repo has no styles to lend, a neutral system default reads
// as a wireframe instead of dressing it up as something it is not.
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

/** The frame's document for one mockup's markup, with the planned repo's
 *  stylesheet layered over the reset so the repo's own rules win. */
export function mockupFrameSrcdoc(markup: string, stylesheet?: string): string {
  // The stylesheet is LLM-authored and goes into `<style>…</style>` verbatim, so a
  // literal `</style>` inside it would end the block early and everything after it
  // would be parsed as HTML — sandboxed, but still a way to smuggle markup past the
  // mockup sanitizer, which never sees the stylesheet.
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

/** A purifier that may or may not have been handed a window yet. */
interface MaybePurifier {
  sanitize?: unknown;
}

/**
 * Sanitize mockup markup, tolerating the shape DOMPurify has where there is no DOM.
 *
 * Its default export is an INSTANCE in a browser and a FACTORY in Node. A
 * `"use client"` component still renders on the server, so calling `.sanitize`
 * during render threw "sanitize is not a function" and took the whole feature page
 * down as soon as a plan contained a mockup.
 *
 * Returning empty is the safe direction: a blank frame for one server render, filled
 * by the client after mount. Never return the RAW markup — it is LLM-authored and
 * untrusted, and the only reason it may carry the planned repo's stylesheet at all
 * is that it has been through here and into a sandboxed frame.
 */
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
