import { describe, it, expect, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { buildServer } from "../server.js";
import { verifyGitHubSignature } from "./github-webhook.js";

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

const ORIG = process.env.LORE_WEBHOOK_SECRET;
afterEach(() => {
  if (ORIG === undefined) delete process.env.LORE_WEBHOOK_SECRET;
  else process.env.LORE_WEBHOOK_SECRET = ORIG;
});

describe("POST /api/webhook/github", () => {
  it("returns 503 when the webhook secret is not configured", async () => {
    delete process.env.LORE_WEBHOOK_SECRET;
    const res = await buildServer({ getJobStatus: () => ({}) }).inject({
      method: "POST",
      url: "/api/webhook/github",
      headers: {
        "x-github-event": "ping",
        "x-hub-signature-256": "sha256=deadbeef",
      },
      payload: "{}",
    });
    expect(res.statusCode).toBe(503);
  });

  it("returns 401 when the signature does not match the raw body", async () => {
    process.env.LORE_WEBHOOK_SECRET = SECRET;
    const res = await buildServer({ getJobStatus: () => ({}) }).inject({
      method: "POST",
      url: "/api/webhook/github",
      headers: {
        "x-github-event": "ping",
        "x-hub-signature-256": sign(SECRET, "{}"),
        "x-github-delivery": "d1",
      },
      payload: '{"tampered":true}',
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 202 capturing nothing for a validly-signed event that maps to no work", async () => {
    process.env.LORE_WEBHOOK_SECRET = SECRET;
    const body = JSON.stringify({ zen: "Keep it simple" }); // no repository.full_name → []
    const res = await buildServer({ getJobStatus: () => ({}) }).inject({
      method: "POST",
      url: "/api/webhook/github",
      headers: {
        "x-github-event": "ping",
        "x-hub-signature-256": sign(SECRET, body),
        "x-github-delivery": "d2",
      },
      payload: body,
    });
    expect(res.statusCode).toBe(202);
    expect(res.result).toMatchObject({ captured: 0, events: [] });
  });
});
