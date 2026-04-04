/**
 * Redact secrets from text before storing in logs.
 */

const PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "api-key", re: /(?:sk-|ghp_|ghs_|AKIA|xoxb-|xoxp-|glpat-)[A-Za-z0-9_\-]{20,}/g },
  { name: "jwt", re: /eyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}/g },
  { name: "private-key", re: /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g },
  { name: "connection-string", re: /(?:postgres|mysql|mongodb|redis|amqp):\/\/[^\s"'`]+/g },
  { name: "bearer-token", re: /Bearer\s+[A-Za-z0-9_\-.]{20,}/g },
  { name: "github-token", re: /x-access-token:[A-Za-z0-9_\-]{20,}/g },
  { name: "base64-blob", re: /[A-Za-z0-9+\/]{100,}={0,2}/g },
];

export function redactSecrets(text: string, extraPatterns?: Array<{ name: string; re: RegExp }>): string {
  let result = text;
  const allPatterns = [...PATTERNS, ...(extraPatterns || [])];
  for (const p of allPatterns) {
    result = result.replace(p.re, `[REDACTED:${p.name}]`);
  }
  return result;
}
