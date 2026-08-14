// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

const query = vi.fn<(text: string, params?: unknown[]) => Promise<unknown[]>>();
const getRepo = vi.fn();

vi.mock("@/lib/db", () => ({
  query: (text: string, params?: unknown[]) => query(text, params),
}));
vi.mock("@/lib/api/repos", () => ({ getRepo }));

const { POST } = await import("./route");

const params = Promise.resolve({ owner: "re-cinq", repo: "lore" });

function postRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/repos/re-cinq/lore/settings", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function teamChangedInserts(): Array<unknown[] | undefined> {
  return query.mock.calls
    .filter(([text]) => text.includes("INSERT INTO pipeline.events"))
    .map(([, values]) => values);
}

beforeEach(() => {
  query.mockReset().mockResolvedValue([]);
  getRepo.mockReset().mockResolvedValue({
    status: "ok",
    data: { full_name: "re-cinq/lore", team: null, settings: null },
  });
});

describe("settings POST team change", () => {
  it("emits one internal.repo.team_changed event when the team value changes", async () => {
    const res = await POST(postRequest({ team: "platform" }) as never, {
      params,
    });

    expect(res.status).toBe(200);

    const inserts = teamChangedInserts();

    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toEqual([
      JSON.stringify({ repo: "re-cinq/lore" }),
      "re-cinq/lore",
    ]);
  });

  it("emits no event when the posted team equals the stored team", async () => {
    getRepo.mockResolvedValue({
      status: "ok",
      data: { full_name: "re-cinq/lore", team: "platform", settings: null },
    });

    await POST(postRequest({ team: "platform" }) as never, { params });

    expect(teamChangedInserts()).toHaveLength(0);
  });

  it("emits no event on a settings-only update", async () => {
    await POST(postRequest({ settings: { auto_review: true } }) as never, {
      params,
    });

    expect(teamChangedInserts()).toHaveLength(0);
  });

  it("emits an event when a team is cleared, normalizing empty string to null", async () => {
    getRepo.mockResolvedValue({
      status: "ok",
      data: { full_name: "re-cinq/lore", team: "platform", settings: null },
    });

    await POST(postRequest({ team: "" }) as never, { params });

    expect(teamChangedInserts()).toHaveLength(1);
  });

  it("returns the updated row even when the event insert fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    query.mockImplementation(async (text) => {
      if (text.includes("INSERT INTO pipeline.events")) {
        throw new Error("permission denied");
      }

      return [];
    });

    const res = await POST(postRequest({ team: "platform" }) as never, {
      params,
    });

    expect(res.status).toBe(200);
  });
});
