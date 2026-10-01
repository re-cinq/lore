import { describe, it, expect } from "vitest";
import { createStationProject, dropOverlayOverHttp } from "./station-http.js";

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

    if (body === undefined) {
      return { ok: false, status: 404 } as Response;
    }

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

  it("lists closed lore-managed issues with the label filter on the query", async () => {
    const { fetchImpl } = fakeFetch({
      "GET /api/repos/o/r/issues?state=closed&labels=lore-managed": {
        issues: [
          {
            repo: "o/r",
            number: 2262,
            title: "T002",
            state: "closed",
            labels: [],
          },
        ],
      },
    });
    const project = createStationProject("o/r", env, fetchImpl);

    expect(
      (
        await project.issues.list({ state: "closed", labels: ["lore-managed"] })
      ).map((issue) => issue.number),
    ).toEqual([2262]);
  });

  it("reconciles plan 3b3a67af's spec-tasks with one PUT /tasks/spec-tasks", async () => {
    const reconciled = { created: 1, updated: 9, cancelled: 0 };
    const { fetchImpl, calls } = fakeFetch({
      "PUT /api/repos/o/r/tasks/spec-tasks": reconciled,
    });
    const project = createStationProject("o/r", env, fetchImpl);
    const input = {
      planId: "3b3a67af",
      groupId: "g1",
      tasks: [{ description: "T001", issueNumber: 2261 }],
    };

    expect({
      result: await project.tasks.reconcileSpecTasks(input),
      calls,
    }).toEqual({
      result: reconciled,
      calls: [
        { method: "PUT", path: "/api/repos/o/r/tasks/spec-tasks", body: input },
      ],
    });
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
    const pr = await project.pulls.open("br", {
      title: "title",
      body: "body",
      labels: ["lore-managed"],
    });

    expect(pr.url).toBe("https://pr/1");
    expect(
      calls.find((c) => c.path === "/api/repos/o/r/tasks")?.body,
    ).toMatchObject({
      taskType: "gap-fill",
      createdBy: "spec-drift",
    });
  });
});

describe("findOpenLike accepts either wire spelling", () => {
  const query =
    "GET /api/repos/o/r/tasks/open-like?task_type=gap-fill&description_prefix=Gap%3A&statuses=running";

  const find = (tasks: unknown[]) =>
    createStationProject(
      "o/r",
      env,
      fakeFetch({ [query]: { tasks } }).fetchImpl,
    ).tasks.findOpenLike({
      taskType: "gap-fill",
      descriptionPrefix: "Gap:",
      statuses: ["running"],
    });

  it("reads the snake_case body a producer emits today", async () => {
    expect(
      await find([{ id: "t1", task_type: "gap-fill", status: "running" }]),
    ).toEqual([{ id: "t1", task_type: "gap-fill", status: "running" }]);
  });

  it("reads a camelCase body from a producer that has already flipped", async () => {
    expect(
      await find([{ id: "t1", taskType: "gap-fill", status: "running" }]),
    ).toEqual([{ id: "t1", task_type: "gap-fill", status: "running" }]);
  });
});

describe("filing a spec-task over HTTP", () => {
  it("carries the spec-task's own issue #2261 on POST /tasks", async () => {
    const { fetchImpl, calls } = fakeFetch({
      "POST /api/repos/o/r/tasks": { task_id: "new", status: "pending" },
    });

    await createStationProject("o/r", env, fetchImpl).tasks.create({
      description: "T001",
      taskType: "spec-task",
      targetRepo: "o/r",
      issueNumber: 2261,
      issueUrl: "https://github.com/o/r/issues/2261",
    });

    expect(
      calls.find((c) => c.path === "/api/repos/o/r/tasks")?.body,
    ).toMatchObject({
      issueNumber: 2261,
      issueUrl: "https://github.com/o/r/issues/2261",
    });
  });

  it("carries the task group g-1 on POST /tasks", async () => {
    const { fetchImpl, calls } = fakeFetch({
      "POST /api/repos/o/r/tasks": { task_id: "new", status: "pending" },
    });

    await createStationProject("o/r", env, fetchImpl).tasks.create({
      description: "T001",
      taskType: "spec-task",
      targetRepo: "o/r",
      taskGroupId: "g-1",
    });

    expect(
      calls.find((c) => c.path === "/api/repos/o/r/tasks")?.body,
    ).toMatchObject({ taskType: "spec-task", taskGroupId: "g-1" });
  });

  it("names lore-api's reason in the error, not only the 500", async () => {
    const refusing = (async () => ({
      ok: false,
      status: 500,
      text: async () =>
        JSON.stringify({ error: 'Task type "spec-task" not allowed' }),
    })) as unknown as typeof fetch;

    await expect(
      createStationProject("o/r", env, refusing).tasks.create({
        description: "T001",
        taskType: "spec-task",
        targetRepo: "o/r",
      }),
    ).rejects.toThrow(
      new Error('POST /tasks failed: 500 — Task type "spec-task" not allowed'),
    );
  });
});

describe("tying task issues to their story issue over HTTP", () => {
  it("links #2261 under #2260 and rewrites #2260's title and body", async () => {
    const { fetchImpl, calls } = fakeFetch({
      "POST /api/repos/o/r/issues/2260/sub-issues": { ok: true },
      "PATCH /api/repos/o/r/issues/2260": { ok: true },
    });
    const project = createStationProject("o/r", env, fetchImpl);

    await project.issues.addSubIssue(2260, 2261);
    await project.issues.update(2260, {
      title: "User story: Issue triage",
      body: "- [ ] #2261 T001",
    });

    expect(calls).toEqual([
      {
        method: "POST",
        path: "/api/repos/o/r/issues/2260/sub-issues",
        body: { child: 2261 },
      },
      {
        method: "PATCH",
        path: "/api/repos/o/r/issues/2260",
        body: { title: "User story: Issue triage", body: "- [ ] #2261 T001" },
      },
    ]);
  });
});

describe("dropping a branch's graph overlay over HTTP", () => {
  it("posts branch feat/x to /trace/overlay-drop of o/r", async () => {
    const { fetchImpl, calls } = fakeFetch({
      "POST /api/repos/o/r/trace/overlay-drop": { dropped: true },
    });

    await dropOverlayOverHttp(
      { repo: "o/r", branch: "feat/x" },
      env,
      fetchImpl,
    );

    expect(calls).toEqual([
      {
        method: "POST",
        path: "/api/repos/o/r/trace/overlay-drop",
        body: { branch: "feat/x" },
      },
    ]);
  });
});
