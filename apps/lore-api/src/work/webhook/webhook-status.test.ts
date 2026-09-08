import { describe, it, expect } from "vitest";
import {
  classifyWebhook,
  isLoreHook,
  LORE_HOOK_PATHS,
  REQUIRED_EVENTS,
  type RepoHook,
} from "./webhook-status.js";

const URL = "https://lore-events.gcp.re-cinq.com/api/events";
const LEGACY_URL = "https://lore-webhook.gcp.re-cinq.com/api/webhook/github";

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
    expect(classifyWebhook([hook()], URL)).toMatchObject({
      state: "configured",
      hookId: 1,
    });
  });

  it("treats events ['*'] as covering all required events", () => {
    expect(classifyWebhook([hook({ events: ["*"] })], URL).state).toBe(
      "configured",
    );
  });

  it("returns missing when no hook is at either Lore hook path", () => {
    expect(
      classifyWebhook(
        [hook({ config: { url: "https://example.com/other" } })],
        URL,
      ),
    ).toMatchObject({
      state: "missing",
      canonicalUrl: URL,
    });
  });

  it("returns wrong_url when a legacy hook at lore-webhook.gcp.re-cinq.com/api/webhook/github is still installed", () => {
    expect(
      classifyWebhook([hook({ config: { url: LEGACY_URL } })], URL),
    ).toMatchObject({ state: "wrong_url", url: LEGACY_URL, hookId: 1 });
  });

  it("returns wrong_url when an /api/events hook points at another host", () => {
    const other = "https://lore-events.example.com/api/events";

    expect(
      classifyWebhook([hook({ config: { url: other } })], URL),
    ).toMatchObject({ state: "wrong_url", url: other });
  });

  it("prefers the canonical-URL hook when a legacy hook is installed alongside it", () => {
    expect(
      classifyWebhook(
        [hook({ id: 1, config: { url: LEGACY_URL } }), hook({ id: 2 })],
        URL,
      ),
    ).toMatchObject({ state: "configured", hookId: 2 });
  });

  it("returns inactive when the hook is disabled", () => {
    expect(classifyWebhook([hook({ active: false })], URL).state).toBe(
      "inactive",
    );
  });

  it("returns narrow_events when the hook only subscribes to issues", () => {
    expect(classifyWebhook([hook({ events: ["issues"] })], URL).state).toBe(
      "narrow_events",
    );
  });

  it("returns delivery_failing when the last delivery was a 401 (secret mismatch)", () => {
    expect(
      classifyWebhook(
        [hook({ last_response: { code: 401, status: null } })],
        URL,
      ),
    ).toMatchObject({
      state: "delivery_failing",
      lastCode: 401,
    });
  });

  it("stays configured when the hook has never delivered (lastCode null)", () => {
    expect(
      classifyWebhook(
        [hook({ last_response: { code: null, status: null } })],
        URL,
      ).state,
    ).toBe("configured");
  });

  it("returns unknown when the canonical URL is not configured", () => {
    expect(classifyWebhook([hook()], "")).toMatchObject({
      state: "unknown",
      reason: "webhook_host_not_configured",
    });
  });

  it("returns missing when a non-matching hook has no config url at all", () => {
    expect(classifyWebhook([hook({ config: {} })], URL).state).toBe("missing");
  });
});

describe("isLoreHook", () => {
  it("lists /api/events and the legacy /api/webhook/github as Lore hook paths", () => {
    expect([...LORE_HOOK_PATHS]).toEqual([
      "/api/events",
      "/api/webhook/github",
    ]);
  });

  it("accepts a hook at /api/events", () => {
    expect(isLoreHook({ config: { url: URL } })).toBe(true);
  });

  it("accepts a hook at the legacy /api/webhook/github path", () => {
    expect(isLoreHook({ config: { url: LEGACY_URL } })).toBe(true);
  });

  it("rejects https://example.com/other and a hook with no url", () => {
    expect(isLoreHook({ config: { url: "https://example.com/other" } })).toBe(
      false,
    );
    expect(isLoreHook({ config: {} })).toBe(false);
  });
});
