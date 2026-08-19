// @vitest-environment node
//
// The route is now a proxy: lore-api owns the write, the privileged-field
// refusal, and the `internal.repo.team_changed` event (all covered by
// repo-settings.test.ts there). What is left to prove here is that this route
// forwards the caller's patch faithfully and does not flatten a refusal.

import { describe, it, expect, vi, beforeEach } from "vitest";

const getRepo = vi.fn();
const putRepoSettings = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/repos", () => ({ getRepo, putRepoSettings }));

const { POST } = await import("./route");

const params = Promise.resolve({ owner: "re-cinq", repo: "lore" });

function postRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/repos/re-cinq/lore/settings", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  putRepoSettings.mockResolvedValue({ status: "ok", data: { ok: true } });
  getRepo.mockResolvedValue({
    status: "ok",
    data: { fullName: "re-cinq/lore", team: "platform", settings: {} },
  });
});

describe("settings POST", () => {
  it("forwards a team change to lore-api", async () => {
    const res = await POST(postRequest({ team: "platform" }) as never, {
      params,
    });

    expect(res.status).toBe(200);
    expect(putRepoSettings).toHaveBeenCalledWith("re-cinq/lore", {
      team: "platform",
    });
  });

  it("normalizes a cleared team to null", async () => {
    await POST(postRequest({ team: "" }) as never, { params });

    expect(putRepoSettings).toHaveBeenCalledWith("re-cinq/lore", {
      team: null,
    });
  });

  it("forwards a settings-only patch without naming a team", async () => {
    await POST(postRequest({ settings: { auto_review: true } }) as never, {
      params,
    });

    expect(putRepoSettings).toHaveBeenCalledWith("re-cinq/lore", {
      settings: { auto_review: true },
    });
  });

  it("forwards a privileged-field refusal with its 403 rather than flattening it", async () => {
    putRepoSettings.mockResolvedValue({
      status: "error",
      message: "privileged dark-factory fields (enabled) are written through …",
      code: 403,
    });

    const res = await POST(
      postRequest({ settings: { dark_factory: { enabled: true } } }) as never,
      { params },
    );

    expect(res.status).toBe(403);
  });

  it("returns the stored row after a successful write", async () => {
    const res = await POST(postRequest({ team: "platform" }) as never, {
      params,
    });

    expect(await res.json()).toEqual({
      full_name: "re-cinq/lore",
      team: "platform",
      settings: {},
    });
  });
});
