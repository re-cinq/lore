// A sketch is untrusted agent markup: it is sanitized, then drawn in a sandbox="" frame with no scripts and no origin.

export const DEFAULT_MOCKUP_HEIGHT = 320;
const MIN_MOCKUP_HEIGHT = 80;
const MAX_MOCKUP_HEIGHT = 2000;

// A white ground and explicit text colour, never the dashboard's tokens: they do not exist inside the isolated frame.
const RESET = `*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { background: #ffffff; color: #111111;
  font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
svg, img, table { max-width: 100%; }`;

export function mockupFrameSrcdoc(markup: string): string {
  return `<style>${RESET}</style>${markup}`;
}

export function mockupHeight(declared: number): number {
  if (!(declared > 0)) {
    return DEFAULT_MOCKUP_HEIGHT;
  }

  return Math.min(Math.max(declared, MIN_MOCKUP_HEIGHT), MAX_MOCKUP_HEIGHT);
}

const FORBID_HANDLERS = [
  "onload",
  "onerror",
  "onclick",
  "onmouseover",
  "onmouseenter",
  "onfocus",
];

export const MOCKUP_SVG_CONFIG = {
  USE_PROFILES: { svg: true, svgFilters: true },
  FORBID_TAGS: ["script", "foreignObject", "style"],
  FORBID_ATTR: FORBID_HANDLERS,
};
export const MOCKUP_HTML_CONFIG = {
  USE_PROFILES: { html: true, svg: true },
  FORBID_TAGS: ["script", "iframe", "object", "embed", "link", "base"],
  FORBID_ATTR: FORBID_HANDLERS,
};

/** The frame cannot measure itself (no same-origin), so a mermaid frame takes its height from the svg's viewBox. */
export function mermaidFrameHeight(svg: string): number | null {
  const viewBox = /viewBox="[-\d.]+ [-\d.]+ [-\d.]+ ([\d.]+)"/.exec(svg);
  const height = viewBox ? Number(viewBox[1]) : NaN;

  if (!(height > 0)) {
    return null;
  }

  return Math.min(Math.ceil(height) + 16, MAX_MOCKUP_HEIGHT);
}

interface MaybePurifier {
  sanitize?: unknown;
}

/** DOMPurify is an instance in a browser and a bare factory on the server, where nothing is drawn until the client mounts. */
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
