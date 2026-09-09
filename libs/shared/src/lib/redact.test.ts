import { describe, it, expect } from "vitest";
import { redactSecrets } from "./redact.js";

describe("redactSecrets", () => {
  it("redacts ghp_ tokens", () => {
    const result = redactSecrets(
      `token: ${"ghp_"}1234567890abcdefghij1234567890abcdefghij`,
    );

    expect(result).toContain("[REDACTED:api-key]");
    expect(result).not.toContain("ghp_");
  });

  it("redacts sk- tokens", () => {
    const result = redactSecrets(
      `key: ${"sk-proj"}-abcdefghijklmnopqrstuvwxyz`,
    );

    expect(result).toContain("[REDACTED:api-key]");
    expect(result).not.toContain("sk-proj");
  });

  it("redacts AWS access keys", () => {
    const result = redactSecrets(`aws: ${"AKIA"}IOSFODNN7EXAMPLE1234`);

    expect(result).toContain("[REDACTED:api-key]");
    expect(result).not.toContain("AKIA");
  });

  it("redacts JWTs", () => {
    const result = redactSecrets(
      "auth: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    );

    expect(result).toContain("[REDACTED:jwt]");
    expect(result).not.toContain("eyJhbGci");
  });

  it("redacts PEM private keys", () => {
    const result = redactSecrets(
      `-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA2a2rwplBQL...\n-----END RSA PRIVATE KEY-----`,
    );

    expect(result).toContain("[REDACTED:private-key]");
    expect(result).not.toContain("BEGIN RSA PRIVATE KEY");
  });

  it("redacts postgres connection strings", () => {
    const result = redactSecrets("db: postgres://user:password@host:5432/mydb");

    expect(result).toContain("[REDACTED:connection-string]");
    expect(result).not.toContain("password");
  });

  it("redacts Bearer tokens", () => {
    const result = redactSecrets(
      "Authorization: Bearer ya29.a0AfH6SMBx12345678901234567890",
    );

    expect(result).toContain("[REDACTED:bearer-token]");
    expect(result).not.toContain("ya29");
  });

  it("redacts x-access-token clone URLs", () => {
    const result = redactSecrets(
      `git clone https://x-access-token:${"ghs_"}abcdefghijklmnopqrstuvwx@github.com/org/repo`,
    );

    expect(result).not.toContain(`${"ghs_"}abcdefghijklmnopqrstuvwx`);
  });

  it("redacts long base64 blobs", () => {
    const result = redactSecrets(`data: ${"A".repeat(120)}`);

    expect(result).toContain("[REDACTED:base64-blob]");
  });

  it("redacts multiple secrets in one string", () => {
    const result = redactSecrets(
      `db=postgres://user:pass@host:5432/db token=ghp_abcdefghijklmnopqrstuvwxyz1234`,
    );

    expect(result).toContain("[REDACTED:connection-string]");
    expect(result).toContain("[REDACTED:api-key]");
    expect(result).not.toContain("pass@host");
    expect(result).not.toContain("ghp_");
  });

  it("leaves normal text untouched", () => {
    const input = "Hello, this is a normal log message with no secrets.";

    expect(redactSecrets(input)).toBe(input);
  });

  it("leaves short token-like strings untouched", () => {
    const input = "status: sk-short";

    expect(redactSecrets(input)).toBe(input);
  });

  it("redacts caller-supplied extra patterns", () => {
    const result = redactSecrets("custom: SECRET_VALUE_12345", [
      { name: "custom-secret", re: /SECRET_VALUE_\d+/g },
    ]);

    expect(result).toContain("[REDACTED:custom-secret]");
    expect(result).not.toContain("SECRET_VALUE_12345");
  });
});
