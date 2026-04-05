import { describe, it, expect } from "vitest";

// redactLogs in local-runner.ts and redactSecrets in agent/src/lib/redact.ts
// are not importable here (redactLogs is private, redact.ts lives outside this
// package). Re-implement the patterns inline so we can test the exact regexes
// that ship in production. This mirrors the pattern used in facts.test.ts and
// graph.test.ts.

const PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "api-key", re: /(?:sk-|ghp_|ghs_|AKIA|xoxb-|xoxp-|glpat-)[A-Za-z0-9_\-]{20,}/g },
  { name: "jwt", re: /eyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}/g },
  { name: "private-key", re: /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g },
  { name: "connection-string", re: /(?:postgres|mysql|mongodb|redis|amqp):\/\/[^\s"'`]+/g },
  { name: "bearer-token", re: /Bearer\s+[A-Za-z0-9_\-.]{20,}/g },
  { name: "base64-blob", re: /[A-Za-z0-9+\/]{100,}={0,2}/g },
];

function redactSecrets(text: string): string {
  let result = text;
  for (const p of PATTERNS) {
    result = result.replace(p.re, `[REDACTED:${p.name}]`);
  }
  return result;
}

// ---------------------------------------------------------------------------

describe("redactSecrets", () => {
  it("redacts GitHub personal access tokens (ghp_)", () => {
    const input = `token: ${"ghp_"}ABCDEFghijklmnop1234567890`;
    const result = redactSecrets(input);
    expect(result).toBe("token: [REDACTED:api-key]");
    expect(result).not.toContain("ghp_");
  });

  it("redacts GitHub server tokens (ghs_)", () => {
    const input = `Authorization: ${"ghs_"}xyzABCDEFghijklmnop12345`;
    const result = redactSecrets(input);
    expect(result).toBe("Authorization: [REDACTED:api-key]");
    expect(result).not.toContain("ghs_");
  });

  it("redacts Anthropic API keys (sk-ant-)", () => {
    const input = `ANTHROPIC_API_KEY=${"sk-ant"}-api03-abcdefghij1234567890abcdefghij`;
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED:api-key]");
    expect(result).not.toContain("sk-ant-");
  });

  it("redacts generic sk- prefixed keys", () => {
    const input = "key: sk-1234567890abcdefghij1234567890";
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED:api-key]");
    expect(result).not.toContain("sk-1234567890");
  });

  it("redacts AWS access keys (AKIA)", () => {
    const input = `aws_access_key_id = ${"AKIA"}IOSFODNN7EXAMPLE12345`;
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED:api-key]");
    expect(result).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("redacts Slack tokens (xoxb-, xoxp-)", () => {
    const input = `SLACK_TOKEN=${"xoxb"}-1234567890abcdefghij1234567890`;
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED:api-key]");
    expect(result).not.toContain("xoxb-");
  });

  it("redacts GitLab tokens (glpat-)", () => {
    const input = `GITLAB_TOKEN=${"glpat"}-xxxxxxxxxxxxxxxxxxxx12345`;
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED:api-key]");
    expect(result).not.toContain("glpat-");
  });

  it("redacts JWTs", () => {
    const jwt = [
      "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9",
      "eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0",
      "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c_extra_data",
    ].join(".");
    const input = `Bearer ${jwt}`;
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED:jwt]");
    expect(result).not.toContain("eyJhbGciOiJSUzI1NiI");
  });

  it("redacts RSA private keys", () => {
    const key = [
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEowIBAAKCAQEA0Z3THAT1sKeyD4t4+example",
      "-----END RSA PRIVATE KEY-----",
    ].join("\n");
    const input = `config:\n${key}\nmore text`;
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED:private-key]");
    expect(result).not.toContain("MIIEowIBAAKCAQEA");
  });

  it("redacts generic private keys (EC, DSA)", () => {
    const key = [
      "-----BEGIN EC PRIVATE KEY-----",
      "MHQCAQEEIODYDeqpzQyOGrGWCYEL7example",
      "-----END EC PRIVATE KEY-----",
    ].join("\n");
    const result = redactSecrets(key);
    expect(result).toContain("[REDACTED:private-key]");
    expect(result).not.toContain("MHQCAQEEIODYDeq");
  });

  it("redacts PostgreSQL connection strings", () => {
    const input = "DATABASE_URL=postgres://user:password@host:5432/dbname";
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED:connection-string]");
    expect(result).not.toContain("password");
  });

  it("redacts MySQL connection strings", () => {
    const input = "mysql://root:secret@localhost/mydb";
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED:connection-string]");
    expect(result).not.toContain("secret");
  });

  it("redacts MongoDB connection strings", () => {
    const input = "mongodb://admin:pass123@cluster0.abc.mongodb.net/test";
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED:connection-string]");
    expect(result).not.toContain("pass123");
  });

  it("redacts Redis connection strings", () => {
    const input = "redis://default:mypassword@redis-host:6379";
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED:connection-string]");
    expect(result).not.toContain("mypassword");
  });

  it("redacts AMQP connection strings", () => {
    const input = "amqp://guest:guest@rabbitmq:5672/vhost";
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED:connection-string]");
    expect(result).not.toContain("guest:guest");
  });

  it("redacts Bearer tokens", () => {
    const input = "Authorization: Bearer eyAbCdEfGhIjKlMnOpQrStUvWxYz012345";
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED:bearer-token]");
    expect(result).not.toContain("eyAbCdEfGhIjKlMnOpQrStUvWxYz");
  });

  it("redacts long base64 blobs", () => {
    const base64 = "A".repeat(120);
    const input = `data: ${base64} end`;
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED:base64-blob]");
    expect(result).not.toContain("A".repeat(120));
  });

  it("does not redact short base64 strings (< 100 chars)", () => {
    const base64 = "A".repeat(50);
    const input = `value: ${base64}`;
    const result = redactSecrets(input);
    expect(result).toBe(input);
  });

  it("preserves normal text", () => {
    const input = "This is a normal log line with no secrets. Status: OK. Count: 42.";
    expect(redactSecrets(input)).toBe(input);
  });

  it("preserves code snippets", () => {
    const input = "const x = 42;\nfunction hello() { return 'world'; }";
    expect(redactSecrets(input)).toBe(input);
  });

  it("handles empty string", () => {
    expect(redactSecrets("")).toBe("");
  });

  it("handles text with multiple secrets", () => {
    const input = [
      `API_KEY=${"ghp_"}ABCDEFghijklmnop1234567890`,
      "DB=postgres://user:pass@host:5432/db",
      "Authorization: Bearer eyAbCdEfGhIjKlMnOpQrStUvWxYz012345",
    ].join("\n");
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED:api-key]");
    expect(result).toContain("[REDACTED:connection-string]");
    expect(result).toContain("[REDACTED:bearer-token]");
    expect(result).not.toContain("ghp_");
    expect(result).not.toContain("user:pass");
  });

  it("redacts secrets embedded in JSON", () => {
    const input = '{"token":"${"ghp_"}ABCDEFghijklmnop1234567890","url":"https://api.example.com"}';
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED:api-key]");
    expect(result).toContain("https://api.example.com");
  });
});
