/** Secret redaction — canonical implementation; strips API keys/JWTs/private keys/connection strings/tokens/base64 blobs before storage in logs or org-wide memory. Kept in sync with agent/src/lib/redact.ts. */

const PATTERNS: Array<{ name: string; re: RegExp }> = [
  // Before base64-blob, which would otherwise take only the payload and leave the signature.
  { name: "run-credential", re: /v1\.[A-Za-z0-9_-]{20,}\.[0-9a-f]{64}/g },
  {
    name: "api-key",
    re: /(?:sk-|AKIA|xoxb-|xoxp-|gl(?:pat|dt|rt|cbt|ptt|ft|soat)-|GR1348941)[A-Za-z0-9_-]{20,}|gh[psour]_[A-Za-z0-9_.-]{20,}|github_pat_[A-Za-z0-9_]{20,}/g,
  },
  { name: "aws-access-key-id", re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  {
    name: "jwt",
    re: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,
  },
  {
    name: "private-key",
    re: /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g,
  },
  {
    name: "connection-string",
    re: /(?:postgres|mysql|mongodb|redis|amqp):\/\/[^\s"'`]+/g,
  },
  { name: "bearer-token", re: /Bearer\s+[A-Za-z0-9_\-.]{20,}/g },
  { name: "github-token", re: /x-access-token:[A-Za-z0-9_-]{20,}/g },
  {
    name: "github-token-base64",
    re: /eC1hY2Nlc3MtdG9rZW46[A-Za-z0-9+/]*={0,2}/g,
  },
  {
    name: "basic-auth",
    re: /\bBasic\s+(?=[A-Za-z0-9+/]*[0-9+/])[A-Za-z0-9+/]{12,}={0,2}/gi,
  },
  {
    name: "url-credentials",
    re: /(?<=https?:\/\/)[^\s/@:?#"'`]+:[^\s/@"'`]+(?=@)/g,
  },
  { name: "base64-blob", re: /[A-Za-z0-9+/]{100,}={0,2}/g },
];

export function redactSecrets(
  text: string,
  extraPatterns?: Array<{ name: string; re: RegExp }>,
): string {
  let result = text;
  const allPatterns = extraPatterns
    ? [...PATTERNS, ...extraPatterns]
    : PATTERNS;

  for (const p of allPatterns) {
    result = result.replace(p.re, `[REDACTED:${p.name}]`);
  }

  return result;
}
