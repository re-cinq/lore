import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import { makePool, useRateLimitSafeClock, AUTH, LEGACY_TOKEN } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

vi.mock("../../../features/webhook/webhook-manage.js", () => ({
  listRepoWebhooks: vi.fn(),
}));
vi.mock("../../../features/webhook/webhook-ensure.js", () => ({
  ensureFloorWebhook: vi.fn(),
}));

import { listRepoWebhooks } from "../../../features/webhook/webhook-manage.js";
import { ensureFloorWebhook } from "../../../features/webhook/webhook-ensure.js";

const URL = "https://lore-webhook.gcp.re-cinq.com/api/webhook/github";
const originalEnv = { ...process.env };

const goodHook = {
  id: 7,
  active: true,
  events: ["pull_request", "pull_request_review", "pull_request_review_comment", "check_run", "check_suite", "issue_comment", "issues"],
  config: { url: URL },
  last_response: { code: 200, status: "ok" },
};

const inject = (method: "GET" | "POST", url: string) =>
  buildServer(() => makePool() as any).inject({ method, url, headers: AUTH });

describe("GET /api/repos/:o/:r/webhook", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns unknown when LORE_WEBHOOK_URL is not configured", async () => {
    delete process.env.LORE_WEBHOOK_URL;
    const res = await inject("GET", "/api/repos/o/r/webhook");
    expect(res.statusCode).toBe(200);
    expect(res.result).toMatchObject({ state: "unknown", reason: "webhook_host_not_configured" });
  });

  it("classifies the repo's hooks against the canonical URL", async () => {
    process.env.LORE_WEBHOOK_URL = URL;
    vi.mocked(listRepoWebhooks).mockResolvedValue([goodHook] as any);
    const res = await inject("GET", "/api/repos/o/r/webhook");
    expect(res.statusCode).toBe(200);
    expect(res.result).toMatchObject({ state: "configured", hookId: 7, canonicalUrl: URL });
  });

  it("degrades to unknown when the App lacks the webhook permission (403)", async () => {
    process.env.LORE_WEBHOOK_URL = URL;
    vi.mocked(listRepoWebhooks).mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
    const res = await inject("GET", "/api/repos/o/r/webhook");
    expect(res.result).toMatchObject({ state: "unknown", reason: "app_no_webhook_permission" });
  });
});

describe("POST /api/repos/:o/:r/webhook/ensure", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("maps a secret_not_configured skip to 503", async () => {
    process.env.LORE_WEBHOOK_URL = URL;
    vi.mocked(ensureFloorWebhook).mockResolvedValue({ ok: false, reason: "secret_not_configured" });
    const res = await inject("POST", "/api/repos/o/r/webhook/ensure");
    expect(res.statusCode).toBe(503);
  });

  it("maps an app_no_webhook_permission skip to 403", async () => {
    process.env.LORE_WEBHOOK_URL = URL;
    vi.mocked(ensureFloorWebhook).mockResolvedValue({ ok: false, reason: "app_no_webhook_permission" });
    const res = await inject("POST", "/api/repos/o/r/webhook/ensure");
    expect(res.statusCode).toBe(403);
  });

  it("ensures the hook then returns the fresh status", async () => {
    process.env.LORE_WEBHOOK_URL = URL;
    vi.mocked(ensureFloorWebhook).mockResolvedValue({ ok: true, hookId: 7, created: false });
    vi.mocked(listRepoWebhooks).mockResolvedValue([goodHook] as any);
    const res = await inject("POST", "/api/repos/o/r/webhook/ensure");
    expect(ensureFloorWebhook).toHaveBeenCalledWith("o/r");
    expect(res.result).toMatchObject({ state: "configured" });
  });
});

describe("GET /api/repos/:o/:r/webhook/secret", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns the HMAC secret + canonical URL for an admin caller", async () => {
    process.env.LORE_WEBHOOK_URL = URL;
    process.env.LORE_WEBHOOK_SECRET = "s3cr3t";
    const res = await inject("GET", "/api/repos/o/r/webhook/secret");
    expect(res.statusCode).toBe(200);
    expect(res.result).toMatchObject({ secret: "s3cr3t", canonicalUrl: URL });
  });

  it("returns 503 when the secret is not configured", async () => {
    process.env.LORE_WEBHOOK_URL = URL;
    delete process.env.LORE_WEBHOOK_SECRET;
    const res = await inject("GET", "/api/repos/o/r/webhook/secret");
    expect(res.statusCode).toBe(503);
  });
});
