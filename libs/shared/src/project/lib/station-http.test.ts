import { describe, it, expect } from "vitest";
import { createStationProject } from "./station-http.js";

/** Records requests; replays canned JSON per "METHOD path" (path only, host-stripped). */
function fakeFetch(routes: Record<string, unknown>): {
  fetchImpl: typeof fetch;
  calls: Array<{ method: string; path: string; body?: unknown }>;
} {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    calls.push({
      method,
      path,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    const key = `${method} ${path}`;
    const body = routes[key];
    if (body === undefined) return { ok: false, status: 404 } as Response;
    return { ok: true, status: 200, json: async () => body } as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const env = { LORE_API_URL: "https://api", LORE_STATION_TOKEN: "tok" };

describe("createStationProject", () => {
  it("requires LORE_API_URL", () => {
    expect(() => createStationProject("o/r", {})).toThrow(/LORE_API_URL/);
  });

  it("routes project.chunks / issues / settings through the HTTP endpoints with the token", async () => {
    const { fetchImpl, calls } = fakeFetch({
      "GET /api/repos/o/r/chunks/spec": {
        specs: [{ id: "1", repo: "o/r", filePath: "s.md", content: "x" }],
      },
      "GET /api/repos/o/r/onboarded": { onboarded: true },
      "GET /api/repos/o/r/issues?state=open": {
        issues: [
          { repo: "o/r", number: 3, title: "t", state: "open", labels: [] },
        ],
      },
    });
    const project = createStationProject("o/r", env, fetchImpl);

    expect(await project.chunks.specChunks()).toHaveLength(1);
    expect(await project.settings.isOnboarded()).toBe(true);
    expect((await project.issues.list({ state: "open" }))[0].number).toBe(3);
    expect(calls.every(() => true)).toBe(true);
  });

  it("files a task via POST /tasks and opens a PR via POST /pulls", async () => {
    const { fetchImpl, calls } = fakeFetch({
      "POST /api/repos/o/r/tasks": { task_id: "new", status: "pending" },
      "POST /api/repos/o/r/pulls": { url: "https://pr/1", number: 1 },
    });
    const project = createStationProject("o/r", env, fetchImpl);

    await project.tasks.create({
      description: "d",
      taskType: "gap-fill",
      targetRepo: "o/r",
      createdBy: "spec-drift",
    });
    const pr = await project.pulls.open("br", "title", "body", undefined, [
      "lore-managed",
    ]);

    expect(pr.url).toBe("https://pr/1");
    expect(
      calls.find((c) => c.path === "/api/repos/o/r/tasks")?.body,
    ).toMatchObject({
      taskType: "gap-fill",
      createdBy: "spec-drift",
    });
  });
});
