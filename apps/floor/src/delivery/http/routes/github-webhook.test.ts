import { describe, it, expect, afterEach, vi } from "vitest";
import { createHmac } from "node:crypto";
import { buildServer } from "../server.js";
import { insertEventList } from "../../../main-loop/store.js";

vi.mock("../../../main-loop/store.js", () => ({ insertEventList: vi.fn() }));

const SECRET = "test-webhook-secret";

function sign(secret: string, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

const ORIG = process.env.LORE_WEBHOOK_SECRET;

afterEach(() => {
  vi.mocked(insertEventList).mockReset();

  if (ORIG === undefined) {
    delete process.env.LORE_WEBHOOK_SECRET;

    return;
  }
  process.env.LORE_WEBHOOK_SECRET = ORIG;
});

describe("POST /api/webhook/github", () => {
  it("returns 202 and queues a github.pull_request.opened event for a signed delivery", async () => {
    process.env.LORE_WEBHOOK_SECRET = SECRET;
    const body = JSON.stringify({
      action: "opened",
      repository: { full_name: "re-cinq/lore" },
      pull_request: { number: 7 },
    });
    const res = await buildServer({ getJobStatus: () => ({}) }).inject({
      method: "POST",
      url: "/api/webhook/github",
      headers: {
        "x-github-event": "pull_request",
        "x-hub-signature-256": sign(SECRET, body),
        "x-github-delivery": "delivery-7",
      },
      payload: body,
    });

    expect(res.statusCode).toBe(202);
    expect(res.result).toMatchObject({ captured: 1 });
    // The dedupe key is the delivery id: GitHub redelivers on any non-2xx, and
    // without it a retried delivery would run the whole reaction twice.
    expect(vi.mocked(insertEventList).mock.calls[0]).toEqual([
      [
        {
          eventName: "github.pull_request.opened",
          source: "github",
          params: { repo: "re-cinq/lore", pr_number: 7 },
          dedupeKey: "github:delivery-7",
        },
      ],
      "github",
    ]);
  });

  it("returns 400 when the delivery carries no x-github-event header", async () => {
    process.env.LORE_WEBHOOK_SECRET = SECRET;
    const body = "{}";
    const res = await buildServer({ getJobStatus: () => ({}) }).inject({
      method: "POST",
      url: "/api/webhook/github",
      headers: {
        "x-hub-signature-256": sign(SECRET, body),
        "x-github-delivery": "d3",
      },
      payload: body,
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 500 when the webhook secret is not configured", async () => {
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

    expect(res.statusCode).toBe(500);
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
