/** Response headers every page and route of the UI carries (FR-9.23). */
export const SECURITY_HEADERS = [
  // Internal tool: keep every page, including the sign-in page, out of search indexes.
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // No page of the UI is meant to be framed. Not a CSP frame-ancestors: a plan sketch's srcdoc frame inherits the page's CSP.
  { key: "X-Frame-Options", value: "DENY" },
  // Only directives no script or style of the UI depends on; a script-src needs per-request nonces for Next's inline scripts.
  {
    key: "Content-Security-Policy",
    value: "base-uri 'self'; object-src 'none'",
  },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  // Browsers ignore it over plain http, so a local UI is unaffected; no includeSubDomains, the host's siblings are not the UI's to decide.
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
];
