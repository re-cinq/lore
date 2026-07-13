import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("./webhook-manage.js", () => ({ ensureRepoWebhook: vi.fn() }));

import { ensureRepoWebhook } from "./webhook-manage.js";
import { ensureFloorWebhook } from "./webhook-ensure.js";

const URL = "https://lore-webhook.gcp.re-cinq.com/api/webhook/github";
const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.clearAllMocks();
});

describe("ensureFloorWebhook", () => {
  it("skips when LORE_WEBHOOK_URL is unset, without touching GitHub", async () => {
    delete process.env.LORE_WEBHOOK_URL;
    process.env.LORE_WEBHOOK_SECRET = "s3cr3t";
    expect(await ensureFloorWebhook("o/r")).toEqual({
      ok: false,
      reason: "webhook_host_not_configured",
    });
    expect(ensureRepoWebhook).not.toHaveBeenCalled();
  });

  it("skips when LORE_WEBHOOK_SECRET is unset, without touching GitHub", async () => {
    process.env.LORE_WEBHOOK_URL = URL;
    delete process.env.LORE_WEBHOOK_SECRET;
    expect(await ensureFloorWebhook("o/r")).toEqual({
      ok: false,
      reason: "secret_not_configured",
    });
    expect(ensureRepoWebhook).not.toHaveBeenCalled();
  });

  it("ensures the hook with the secret and the required events", async () => {
    process.env.LORE_WEBHOOK_URL = URL;
    process.env.LORE_WEBHOOK_SECRET = "s3cr3t";
    vi.mocked(ensureRepoWebhook).mockResolvedValue({
      hookId: 7,
      created: true,
    });
    expect(await ensureFloorWebhook("o/r")).toEqual({
      ok: true,
      hookId: 7,
      created: true,
    });
    expect(ensureRepoWebhook).toHaveBeenCalledWith(
      "o/r",
      URL,
      "s3cr3t",
      expect.arrayContaining([
        "pull_request",
        "pull_request_review",
        "check_run",
        "issues",
      ]),
    );
  });

  it("reports app_no_webhook_permission on a 403 from GitHub", async () => {
    process.env.LORE_WEBHOOK_URL = URL;
    process.env.LORE_WEBHOOK_SECRET = "s3cr3t";
    vi.mocked(ensureRepoWebhook).mockRejectedValue(
      Object.assign(new Error("Forbidden"), { status: 403 }),
    );
    expect(await ensureFloorWebhook("o/r")).toEqual({
      ok: false,
      reason: "app_no_webhook_permission",
    });
  });

  it("reports ensure_failed with a detail on any other error", async () => {
    process.env.LORE_WEBHOOK_URL = URL;
    process.env.LORE_WEBHOOK_SECRET = "s3cr3t";
    vi.mocked(ensureRepoWebhook).mockRejectedValue(new Error("network down"));
    expect(await ensureFloorWebhook("o/r")).toEqual({
      ok: false,
      reason: "ensure_failed",
      detail: "network down",
    });
  });
});
