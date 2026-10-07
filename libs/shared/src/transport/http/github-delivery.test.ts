import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  eventsFromGitHubDelivery,
  githubSignature,
} from "./github-delivery.js";

const SECRET = "shhh";
const door = { webhookSecret: SECRET, service: "lore-api" };

function signed(body: string): string {
  return "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");
}

describe("githubSignature", () => {
  it("returns sha256=abc for a request carrying that x-hub-signature-256 header", () => {
    expect(githubSignature({ "x-hub-signature-256": "sha256=abc" })).toBe(
      "sha256=abc",
    );
  });

  it("returns undefined for a request with no signature header", () => {
    expect(githubSignature({ authorization: "Bearer tok" })).toBeUndefined();
  });
});

describe("eventsFromGitHubDelivery", () => {
  it("maps signed delivery d-1 of a closed pull request to github.pull_request.closed deduped on github:d-1", () => {
    const body = JSON.stringify({
      action: "closed",
      pull_request: { number: 7, merged: true },
      repository: { full_name: "re-cinq/lore" },
    });

    const events = eventsFromGitHubDelivery(
      { "x-github-event": "pull_request", "x-github-delivery": "d-1" },
      body,
      signed(body),
      door,
    );

    expect(events).toMatchObject([
      {
        eventName: "github.pull_request.closed",
        source: "github",
        dedupeKey: "github:d-1",
      },
    ]);
  });

  it("maps a signed ping to no events", () => {
    const body = JSON.stringify({ zen: "Keep it simple" });

    expect(
      eventsFromGitHubDelivery(
        { "x-github-event": "ping", "x-github-delivery": "d-4" },
        body,
        signed(body),
        door,
      ),
    ).toEqual([]);
  });

  it("refuses a signature that does not match the secret with a 401", () => {
    expect(() =>
      eventsFromGitHubDelivery(
        { "x-github-event": "pull_request" },
        "{}",
        "sha256=" + "0".repeat(64),
        door,
      ),
    ).toThrow(
      expect.objectContaining({
        output: expect.objectContaining({ statusCode: 401 }),
      }),
    );
  });

  it("refuses with a 500 naming the lore-api deployment when the webhook secret is not configured", () => {
    expect(() =>
      eventsFromGitHubDelivery(
        { "x-github-event": "ping" },
        "{}",
        "sha256=deadbeef",
        { service: "lore-api" },
      ),
    ).toThrow(
      expect.objectContaining({
        message:
          "webhook secret not configured — set LORE_WEBHOOK_SECRET on the lore-api deployment",
        output: expect.objectContaining({ statusCode: 500 }),
      }),
    );
  });

  it("refuses a signed delivery with no x-github-event header with a 400", () => {
    expect(() =>
      eventsFromGitHubDelivery(
        { "x-github-delivery": "d-3" },
        "{}",
        signed("{}"),
        door,
      ),
    ).toThrow(
      expect.objectContaining({
        output: expect.objectContaining({ statusCode: 400 }),
      }),
    );
  });
});
