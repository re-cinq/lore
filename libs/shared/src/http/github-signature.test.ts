import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyGitHubSignature } from "./github-signature.js";

const SECRET = "test-webhook-secret";
const BODY = JSON.stringify({ action: "opened", number: 7 });

function sign(secret: string, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

describe("verifyGitHubSignature", () => {
  it("accepts a signature computed with the same secret and body", () => {
    expect(verifyGitHubSignature(SECRET, sign(SECRET, BODY), BODY)).toBe(true);
  });

  it("rejects a signature computed with a different secret", () => {
    expect(
      verifyGitHubSignature(SECRET, sign("wrong-secret", BODY), BODY),
    ).toBe(false);
  });

  it("rejects when the body was tampered after signing", () => {
    expect(verifyGitHubSignature(SECRET, sign(SECRET, BODY), BODY + " ")).toBe(
      false,
    );
  });

  it("rejects a malformed signature without length-mismatch crash", () => {
    expect(verifyGitHubSignature(SECRET, "sha256=deadbeef", BODY)).toBe(false);
  });
});
