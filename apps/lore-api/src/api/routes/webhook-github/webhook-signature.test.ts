import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyGitHubSignature } from "./webhook-github.js";
import { verifySlackSignature } from "../webhook-slack/webhook-slack.js";

const SECRET = "shhh";

describe("verifyGitHubSignature", () => {
  const body = JSON.stringify({ action: "labeled" });
  const valid = "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");

  it("returns true for a matching sha256 signature", () => {
    expect(verifyGitHubSignature(SECRET, valid, body)).toBe(true);
  });

  it("returns false when the signature is for a different body", () => {
    expect(verifyGitHubSignature(SECRET, valid, body + "tampered")).toBe(false);
  });

  it("returns false on a length mismatch without throwing", () => {
    expect(verifyGitHubSignature(SECRET, "sha256=short", body)).toBe(false);
  });
});

describe("verifySlackSignature", () => {
  const timestamp = "1700000000";
  const body = "text=hello&channel_id=C1";
  const valid = "v0=" + createHmac("sha256", SECRET).update(`v0:${timestamp}:${body}`).digest("hex");

  it("returns true for a matching v0 signature", () => {
    expect(verifySlackSignature(SECRET, timestamp, valid, body)).toBe(true);
  });

  it("returns false when the timestamp differs", () => {
    expect(verifySlackSignature(SECRET, "1700000001", valid, body)).toBe(false);
  });

  it("returns false on a length mismatch without throwing", () => {
    expect(verifySlackSignature(SECRET, timestamp, "v0=short", body)).toBe(false);
  });
});
