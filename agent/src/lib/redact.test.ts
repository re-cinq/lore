import { describe, it, expect } from "vitest";
import { redactSecrets } from "../lib/redact.js";

describe("redactSecrets", () => {
  // ── API keys ──────────────────────────────────────────────────────

  it("redacts ghp_ tokens", () => {
    const input = `token: ${"ghp_"}1234567890abcdefghij1234567890abcdefghij`;
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED:api-key]");
    expect(result).not.toContain("ghp_");
  });

  it("redacts ghs_ tokens", () => {
    const input = `token: ${"ghs_"}abcdefghijklmnopqrstuvwxyz1234567890`;
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED:api-key]");
    expect(result).not.toContain("ghs_");
  });

  it("redacts sk- tokens (OpenAI/Anthropic style)", () => {
    const input = `key: ${"sk-proj"}-abcdefghijklmnopqrstuvwxyz`;
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED:api-key]");
    expect(result).not.toContain("sk-proj");
  });

  it("redacts AWS access keys (AKIA prefix)", () => {
    const input = `aws_key: ${"AKIA"}IOSFODNN7EXAMPLE1234`;
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED:api-key]");
    expect(result).not.toContain("AKIA");
  });

  it("redacts Slack tokens (xoxb-)", () => {
    const input = `slack: ${"xoxb"}-123456789012-abcdefghijklmnopqrstuvwx`;
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED:api-key]");
    expect(result).not.toContain("xoxb-");
  });

  it("redacts GitLab tokens (glpat-)", () => {
    const input = `gitlab: ${"glpat"}-abcdefghijklmnopqrstu`;
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED:api-key]");
    expect(result).not.toContain("glpat-");
  });

  // ── JWTs ──────────────────────────────────────────────────────────

  it("redacts JWTs", () => {
    const input =
      "auth: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED:jwt]");
    expect(result).not.toContain("eyJhbGci");
  });

  // ── Private keys ──────────────────────────────────────────────────

  it("redacts PEM private keys", () => {
    const input = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA2a2rwplBQL...
-----END RSA PRIVATE KEY-----`;
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED:private-key]");
    expect(result).not.toContain("BEGIN RSA PRIVATE KEY");
  });

  it("redacts EC private keys", () => {
    const input = `-----BEGIN EC PRIVATE KEY-----
MHQCAQEEIODxf/1kzH2DYwGK2h...
-----END EC PRIVATE KEY-----`;
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED:private-key]");
    expect(result).not.toContain("BEGIN EC PRIVATE KEY");
  });

  // ── Connection strings ────────────────────────────────────────────

  it("redacts postgres connection strings", () => {
    const input = "db: postgres://user:password@host:5432/mydb";
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED:connection-string]");
    expect(result).not.toContain("password");
  });

  it("redacts mongodb connection strings", () => {
    const input = "db: mongodb://admin:secret@cluster0.abc.net:27017/mydb";
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED:connection-string]");
    expect(result).not.toContain("secret");
  });

  it("redacts redis connection strings", () => {
    const input = "cache: redis://default:mypassword@redis.example.com:6379";
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED:connection-string]");
    expect(result).not.toContain("mypassword");
  });

  // ── Bearer tokens ─────────────────────────────────────────────────

  it("redacts Bearer tokens", () => {
    const input = "Authorization: Bearer ya29.a0AfH6SMBx12345678901234567890";
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED:bearer-token]");
    expect(result).not.toContain("ya29");
  });

  // ── GitHub x-access-token ─────────────────────────────────────────

  it("redacts x-access-token in clone URLs", () => {
    const input =
      `git clone https://x-access-token:${"ghs_"}abcdefghijklmnopqrstuvwx@github.com/org/repo`;
    const result = redactSecrets(input);
    // The ghs_ prefix hits the api-key pattern and x-access-token hits the github-token pattern
    expect(result).not.toContain(`${"ghs_"}abcdefghijklmnopqrstuvwx`);
  });

  // ── Base64 blobs ──────────────────────────────────────────────────

  it("redacts long base64 strings", () => {
    const blob = "A".repeat(120);
    const input = `data: ${blob}`;
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED:base64-blob]");
  });

  // ── Passthrough ───────────────────────────────────────────────────

  it("does not redact normal text", () => {
    const input = "Hello, this is a normal log message with no secrets.";
    expect(redactSecrets(input)).toBe(input);
  });

  it("does not redact short strings that look like tokens", () => {
    const input = "status: sk-short";
    // "sk-short" is only 8 chars, below the 20-char minimum
    expect(redactSecrets(input)).toBe(input);
  });

  // ── Extra patterns ────────────────────────────────────────────────

  it("supports extra patterns", () => {
    const input = "custom: SECRET_VALUE_12345";
    const result = redactSecrets(input, [
      { name: "custom-secret", re: /SECRET_VALUE_\d+/g },
    ]);
    expect(result).toContain("[REDACTED:custom-secret]");
    expect(result).not.toContain("SECRET_VALUE_12345");
  });

  // ── Multiple secrets in one string ────────────────────────────────

  it("redacts multiple secrets in the same string", () => {
    const input = `db=postgres://user:pass@host:5432/db token=ghp_abcdefghijklmnopqrstuvwxyz1234`;
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED:connection-string]");
    expect(result).toContain("[REDACTED:api-key]");
    expect(result).not.toContain("pass@host");
    expect(result).not.toContain("ghp_");
  });
});
