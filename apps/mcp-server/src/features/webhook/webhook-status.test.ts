import { describe, it, expect } from "vitest";
import { classifyWebhook, REQUIRED_EVENTS, type RepoHook } from "./webhook-status.js";

const URL = "https://lore-webhook.gcp.re-cinq.com/api/webhook/github";

function hook(overrides: Partial<RepoHook> = {}): RepoHook {
  return {
    id: 1,
    active: true,
    events: [...REQUIRED_EVENTS],
    config: { url: URL },
    last_response: { code: 200, status: "ok" },
    ...overrides,
  };
}

describe("classifyWebhook", () => {
  it("returns configured when the hook is active, on the canonical URL, covers the events, and last delivery is 2xx", () => {
    expect(classifyWebhook([hook()], URL)).toMatchObject({ state: "configured", hookId: 1 });
  });

  it("treats events ['*'] as covering all required events", () => {
    expect(classifyWebhook([hook({ events: ["*"] })], URL).state).toBe("configured");
  });

  it("returns missing when no hook targets the Floor webhook path", () => {
    expect(classifyWebhook([hook({ config: { url: "https://example.com/other" } })], URL)).toMatchObject({
      state: "missing",
      canonicalUrl: URL,
    });
  });

  it("returns wrong_url when a Floor-path hook still points at the old host", () => {
    const old = "https://lore-api.gcp.re-cinq.com/api/webhook/github";
    expect(classifyWebhook([hook({ config: { url: old } })], URL)).toMatchObject({ state: "wrong_url", url: old });
  });

  it("returns inactive when the hook is disabled", () => {
    expect(classifyWebhook([hook({ active: false })], URL).state).toBe("inactive");
  });

  it("returns narrow_events when the hook only subscribes to issues", () => {
    expect(classifyWebhook([hook({ events: ["issues"] })], URL).state).toBe("narrow_events");
  });

  it("returns delivery_failing when the last delivery was a 401 (secret mismatch)", () => {
    expect(classifyWebhook([hook({ last_response: { code: 401, status: null } })], URL)).toMatchObject({
      state: "delivery_failing",
      lastCode: 401,
    });
  });

  it("stays configured when the hook has never delivered (lastCode null)", () => {
    expect(classifyWebhook([hook({ last_response: { code: null, status: null } })], URL).state).toBe("configured");
  });

  it("returns unknown when the canonical URL is not configured", () => {
    expect(classifyWebhook([hook()], "")).toMatchObject({ state: "unknown", reason: "webhook_host_not_configured" });
  });
});
