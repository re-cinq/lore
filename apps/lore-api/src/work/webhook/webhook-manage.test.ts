import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../../outbound/github-client.js", () => ({ getOctokit: vi.fn() }));

import { getOctokit } from "../../outbound/github-client.js";
import { ensureRepoWebhook } from "./webhook-manage.js";
import { REQUIRED_EVENTS, type RepoHook } from "./webhook-status.js";

const URL = "https://lore-events.gcp.re-cinq.com/api/events";
const LEGACY_URL = "https://lore-webhook.gcp.re-cinq.com/api/webhook/github";
const SECRET = "s3cr3t";
const EVENTS = [...REQUIRED_EVENTS];

function octokitWith(hooks: Partial<RepoHook>[]): {
  listWebhooks: ReturnType<typeof vi.fn>;
  updateWebhook: ReturnType<typeof vi.fn>;
  createWebhook: ReturnType<typeof vi.fn>;
  pingWebhook: ReturnType<typeof vi.fn>;
} {
  const repos = {
    listWebhooks: vi.fn().mockResolvedValue({ data: hooks }),
    updateWebhook: vi.fn().mockResolvedValue({}),
    createWebhook: vi.fn().mockResolvedValue({ data: { id: 99 } }),
    pingWebhook: vi.fn().mockResolvedValue({}),
  };

  vi.mocked(getOctokit).mockResolvedValue({
    rest: { repos },
  } as unknown as Awaited<ReturnType<typeof getOctokit>>);

  return repos;
}

afterEach(() => vi.clearAllMocks());

describe("ensureRepoWebhook", () => {
  it("repoints a legacy hook at lore-webhook.gcp.re-cinq.com/api/webhook/github in place, replacing url, secret and events", async () => {
    const repos = octokitWith([{ id: 7, config: { url: LEGACY_URL } }]);

    expect(await ensureRepoWebhook("o/r", URL, SECRET, EVENTS)).toEqual({
      hookId: 7,
      created: false,
    });
    expect(repos.updateWebhook).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      hook_id: 7,
      config: { url: URL, content_type: "json", secret: SECRET },
      events: EVENTS,
      active: true,
    });
    expect(repos.createWebhook).not.toHaveBeenCalled();
  });

  it("updates a hook already at /api/events in place instead of creating a second one", async () => {
    const repos = octokitWith([{ id: 7, config: { url: URL } }]);

    expect(await ensureRepoWebhook("o/r", URL, SECRET, EVENTS)).toEqual({
      hookId: 7,
      created: false,
    });
    expect(repos.createWebhook).not.toHaveBeenCalled();
  });

  it("creates an active hook and pings it when no Lore hook exists", async () => {
    const repos = octokitWith([
      { id: 3, config: { url: "https://example.com/other" } },
    ]);

    expect(await ensureRepoWebhook("o/r", URL, SECRET, EVENTS)).toEqual({
      hookId: 99,
      created: true,
    });
    expect(repos.createWebhook).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      name: "web",
      config: { url: URL, content_type: "json", secret: SECRET },
      events: EVENTS,
      active: true,
    });
    expect(repos.pingWebhook).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      hook_id: 99,
    });
  });

  it("returns the hook even when the ping rejects", async () => {
    const repos = octokitWith([]);

    repos.pingWebhook.mockRejectedValue(new Error("ping failed"));

    expect(await ensureRepoWebhook("o/r", URL, SECRET, EVENTS)).toEqual({
      hookId: 99,
      created: true,
    });
  });
});
