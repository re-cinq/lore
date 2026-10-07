import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../../outbound/project-boot.js", () => ({ projectFor: vi.fn() }));

import { buildServer } from "../../../app/build-server.js";
import { projectFor } from "../../../outbound/project-boot.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

const openIssue = (number: number, labels: string[], created: string) => ({
  repo: "re-cinq/lore",
  number,
  title: `Ticket ${number}`,
  state: "open",
  labels,
  url: `https://gh/i/${number}`,
  createdAt: created,
});

describe("/api/repos/{owner}/{repo}/implementation-loop", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  function get(pool: unknown = makePool()) {
    return buildServer(() => pool as never).inject({
      method: "GET",
      url: "/api/repos/re-cinq/lore/implementation-loop",
      headers: AUTH,
    });
  }

  function put(payload: unknown, pool: unknown = makePool()) {
    return buildServer(() => pool as never).inject({
      method: "PUT",
      url: "/api/repos/re-cinq/lore/implementation-loop",
      headers: AUTH,
      payload: JSON.stringify(payload),
    });
  }

  it("returns 503 when the pool is null", async () => {
    expect((await get(null)).statusCode).toBe(503);
    expect((await put({ enabled: true }, null)).statusCode).toBe(503);
  });

  it("returns 404 for a repo with no row", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [] });

    expect((await get(pool)).statusCode).toBe(404);
  });

  it("reports the repo's onboarding state and its last onboard task, so the page can say why nothing is picked", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            settings: { implementation_loop: { enabled: true } },
            onboarding_pr_merged: false,
            onboarding_pr_url: null,
            id: "d5602eb8-0000-4000-8000-000000000001",
            status: "failed",
            failure_reason: "Git Repository is empty.",
          },
        ],
      })
      .mockResolvedValue({ rows: [] });
    vi.mocked(projectFor).mockResolvedValue({
      issues: { list: async () => [] },
    } as never);

    const res = await get(pool);

    expect(JSON.parse(res.payload).onboarding).toEqual({
      merged: false,
      pr_url: null,
      last_task: {
        id: "d5602eb8-0000-4000-8000-000000000001",
        status: "failed",
        failure_reason: "Git Repository is empty.",
        in_flight: false,
      },
    });
  });

  it("marks a still-running onboard task as in flight, so the page links to it instead of offering a retry", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            settings: { implementation_loop: { enabled: true } },
            onboarding_pr_merged: false,
            onboarding_pr_url: null,
            id: "t3",
            status: "running",
            failure_reason: null,
          },
        ],
      })
      .mockResolvedValue({ rows: [] });
    vi.mocked(projectFor).mockResolvedValue({
      issues: { list: async () => [] },
    } as never);

    const res = await get(pool);

    expect(JSON.parse(res.payload).onboarding.last_task).toEqual({
      id: "t3",
      status: "running",
      failure_reason: null,
      in_flight: true,
    });
  });

  it("returns the toggle, current ticket, ordered queue, and recent tickets", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({
        rows: [{ settings: { implementation_loop: { enabled: true } } }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "task-7",
            created_at: "2026-08-26T06:00:00.000Z",
            status: "running",
            description: "Ticket 7",
            issue_number: 7,
            issue_url: "https://gh/i/7",
            pr_url: "https://gh/pr/70",
          },
          {
            id: "task-5",
            created_at: "2026-08-26T06:00:00.000Z",
            status: "completed",
            description: "Ticket 5",
            issue_number: 5,
            issue_url: "https://gh/i/5",
            pr_url: "https://gh/pr/50",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ id: "run-42" }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "run-42",
            task_id: "task-7",
            status: "running",
            reason: "edge validate->implement exceeded iteration_max 1",
            graph: {
              nodes: [
                { id: "implement", type: "agent" },
                { id: "validate", type: "validate" },
                { id: "await-pr", type: "pr_review" },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            assembly_run_id: "run-42",
            node_id: "implement",
            iteration: 1,
            outcome: "success",
          },
          {
            assembly_run_id: "run-42",
            node_id: "validate",
            iteration: 1,
            outcome: null,
          },
        ],
      });
    vi.mocked(projectFor).mockResolvedValue({
      issues: {
        list: async () => [
          openIssue(7, ["priority:high"], "2026-08-01T00:00:00Z"),
          openIssue(9, ["priority:low"], "2026-08-02T00:00:00Z"),
          openIssue(8, ["priority:medium"], "2026-08-03T00:00:00Z"),
          openIssue(6, ["bug"], "2026-08-04T00:00:00Z"),
        ],
      },
    } as never);

    const res = await get(pool);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({
      enabled: true,
      onboarding: { merged: false, pr_url: null, last_task: null },
      current_run_id: "run-42",
      current: {
        created_at: "2026-08-26T06:00:00.000Z",
        hold: null,
        issue_number: 7,
        issue_url: "https://gh/i/7",
        title: "Ticket 7",
        priority: "priority:high",
        pr_url: "https://gh/pr/70",
        state: "running",
        run_id: "run-42",
        pipeline: [
          { node_id: "implement", state: "success" },
          { node_id: "validate", state: "running" },
          { node_id: "await-pr", state: "pending" },
        ],
      },
      next: [
        {
          created_at: "2026-08-03T00:00:00.000Z",
          hold: null,
          issue_number: 8,
          issue_url: "https://gh/i/8",
          title: "Ticket 8",
          priority: "priority:medium",
          pr_url: null,
          state: "queued",
          run_id: null,
          pipeline: null,
        },
        {
          created_at: "2026-08-02T00:00:00.000Z",
          hold: null,
          issue_number: 9,
          issue_url: "https://gh/i/9",
          title: "Ticket 9",
          priority: "priority:low",
          pr_url: null,
          state: "queued",
          run_id: null,
          pipeline: null,
        },
      ],
      parked: [],
      recent: [
        {
          created_at: "2026-08-26T06:00:00.000Z",
          hold: null,
          issue_number: 5,
          issue_url: "https://gh/i/5",
          title: "Ticket 5",
          priority: null,
          pr_url: "https://gh/pr/50",
          state: "completed",
          run_id: null,
          pipeline: null,
        },
      ],
    });
  });

  it("still renders the queue when the loop is disabled", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({ rows: [{ settings: {} }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValue({ rows: [] });
    vi.mocked(projectFor).mockResolvedValue({
      issues: {
        list: async () => [
          openIssue(3, ["priority:low"], "2026-08-01T00:00:00Z"),
        ],
      },
    } as never);

    const res = await get(pool);

    expect(JSON.parse(res.payload)).toMatchObject({
      enabled: false,
      current: null,
      next: [{ issue_number: 3 }],
      recent: [],
    });
  });

  it("excludes the current ticket's issue from the queue", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({
        rows: [{ settings: { implementation_loop: { enabled: true } } }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "task-7b",
            created_at: "2026-08-26T06:00:00.000Z",
            status: "running",
            description: "Ticket 7",
            issue_number: 7,
            issue_url: "https://gh/i/7",
            pr_url: null,
          },
        ],
      });
    pool.query.mockResolvedValue({ rows: [] } as never);
    vi.mocked(projectFor).mockResolvedValue({
      issues: {
        list: async () => [
          openIssue(7, ["priority:high"], "2026-08-01T00:00:00Z"),
        ],
      },
    } as never);

    const res = await get(pool);

    expect(JSON.parse(res.payload)).toMatchObject({
      current: { issue_number: 7 },
      next: [],
    });
  });

  it("keeps an addressed-but-unmerged ticket out of the queue", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({
        rows: [{ settings: { implementation_loop: { enabled: true } } }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "task-5c",
            created_at: "2026-08-26T05:00:00.000Z",
            status: "completed",
            description: "Ticket 5",
            issue_number: 5,
            issue_url: "https://gh/i/5",
            pr_url: "https://gh/pr/50",
          },
        ],
      });
    pool.query.mockResolvedValue({ rows: [] } as never);
    vi.mocked(projectFor).mockResolvedValue({
      issues: {
        list: async () => [
          openIssue(5, ["priority:high"], "2026-08-01T00:00:00Z"),
        ],
      },
    } as never);

    const res = await get(pool);

    expect(JSON.parse(res.payload)).toMatchObject({
      current: null,
      next: [],
      recent: [{ issue_number: 5, pr_url: "https://gh/pr/50" }],
    });
  });

  it("PUT flips the toggle under admin scope and echoes the new state", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({ rows: [{ full_name: "re-cinq/lore" }] })
      .mockResolvedValue({ rows: [] });
    vi.mocked(projectFor).mockResolvedValue({
      issues: { createLabels: async () => {} },
    } as never);

    const res = await put({ enabled: true }, pool);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ ok: true, enabled: true });
    const update = pool.query.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE lore.repos"),
    );

    expect(String(update?.[0])).toContain("implementation_loop");
  });

  it("enabling seeds the priority and lore:blocked labels on the repo", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({ rows: [{ full_name: "re-cinq/lore" }] })
      .mockResolvedValue({ rows: [] });
    const seeded: Array<{ name: string }> = [];

    vi.mocked(projectFor).mockResolvedValue({
      issues: {
        createLabels: async (labels: Array<{ name: string }>) => {
          seeded.push(...labels);
        },
      },
    } as never);

    const res = await put({ enabled: true }, pool);

    expect(res.statusCode).toBe(200);
    expect(seeded.map((l) => l.name)).toEqual([
      "priority:high",
      "priority:medium",
      "priority:low",
      "lore:blocked",
    ]);
  });

  it("disabling seeds nothing", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({ rows: [{ full_name: "re-cinq/lore" }] })
      .mockResolvedValue({ rows: [] });

    const res = await put({ enabled: false }, pool);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ ok: true, enabled: false });
    expect(projectFor).not.toHaveBeenCalled();
  });

  it("a label-seeding failure does not fail the toggle write", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({ rows: [{ full_name: "re-cinq/lore" }] })
      .mockResolvedValue({ rows: [] });
    vi.mocked(projectFor).mockRejectedValue(new Error("github down"));

    const res = await put({ enabled: true }, pool);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ ok: true, enabled: true });
  });

  it("PUT rejects a payload without a boolean enabled", async () => {
    expect((await put({ enabled: "yes" })).statusCode).toBe(400);
  });

  it("excludes a task row with no issue number from recent", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({
        rows: [{ settings: { implementation_loop: { enabled: true } } }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "task-no-issue",
            created_at: "2026-08-26T06:00:00.000Z",
            status: "completed",
            description: "Untracked ticket",
            issue_number: null,
            issue_url: null,
            pr_url: null,
          },
        ],
      });
    pool.query.mockResolvedValue({ rows: [] } as never);
    vi.mocked(projectFor).mockResolvedValue({
      issues: { list: async () => [] },
    } as never);

    const res = await get(pool);

    expect(JSON.parse(res.payload)).toMatchObject({
      current: null,
      recent: [],
    });
  });
});

describe("pipelineOf", () => {
  const run = {
    id: "run-1",
    task_id: "task-1",
    status: "running",
    reason: null,
    graph: {
      nodes: [
        { id: "implement", type: "agent" },
        { id: "await-pr", type: "pr_review" },
      ],
    },
  };

  it("shows an open pr_review row as waiting and takes the latest iteration", async () => {
    const { pipelineOf } = await import("./backlog.js");

    expect(
      pipelineOf(run, [
        {
          assembly_run_id: "run-1",
          node_id: "implement",
          iteration: 1,
          outcome: "failed",
        },
        {
          assembly_run_id: "run-1",
          node_id: "implement",
          iteration: 2,
          outcome: "success",
        },
        {
          assembly_run_id: "run-1",
          node_id: "await-pr",
          iteration: 1,
          outcome: null,
        },
        {
          assembly_run_id: "other-run",
          node_id: "implement",
          iteration: 9,
          outcome: "failed",
        },
      ]),
    ).toEqual([
      { node_id: "implement", state: "success" },
      { node_id: "await-pr", state: "waiting" },
    ]);
  });

  it("is null when the run or its graph is missing", async () => {
    const { pipelineOf } = await import("./backlog.js");

    expect(pipelineOf(undefined, [])).toBeNull();
    expect(pipelineOf({ ...run, graph: null }, [])).toBeNull();
  });

  it("keeps the higher iteration when a lower one arrives after it", async () => {
    const { pipelineOf } = await import("./backlog.js");

    expect(
      pipelineOf(run, [
        {
          assembly_run_id: "run-1",
          node_id: "implement",
          iteration: 2,
          outcome: "success",
        },
        {
          assembly_run_id: "run-1",
          node_id: "implement",
          iteration: 1,
          outcome: "failed",
        },
      ]),
    ).toEqual([
      { node_id: "implement", state: "success" },
      { node_id: "await-pr", state: "pending" },
    ]);
  });
});

describe("GET on a repo with no loop tasks yet", () => {
  function get(pool: unknown) {
    return buildServer(() => pool as never).inject({
      method: "GET",
      url: "/api/repos/re-cinq/lore/implementation-loop",
      headers: AUTH,
    });
  }

  it("serves the queue without issuing empty ANY() queries", async () => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({
        rows: [{ settings: { implementation_loop: { enabled: true } } }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValue({ rows: [] });
    vi.mocked(projectFor).mockResolvedValue({
      issues: {
        list: async () => [
          openIssue(3, ["priority:low"], "2026-08-01T00:00:00Z"),
        ],
      },
    } as never);

    const res = await get(pool);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toMatchObject({
      next: [{ issue_number: 3 }],
      recent: [],
    });
    const anyCalls = pool.query.mock.calls.filter(([sql]) =>
      String(sql).includes("ANY("),
    );

    expect(anyCalls).toHaveLength(0);
  });
});

describe("GET with a queued ticket whose text is too long", () => {
  it("holds #4 with a 32000-char body as text_too_long and #6 not at all", async () => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({
        rows: [{ settings: { implementation_loop: { enabled: true } } }],
      })
      .mockResolvedValue({ rows: [] });
    vi.mocked(projectFor).mockResolvedValue({
      issues: {
        list: async () => [
          {
            ...openIssue(4, ["priority:high"], "2026-08-01T00:00:00Z"),
            body: "x".repeat(32_000),
          },
          openIssue(6, ["priority:high"], "2026-08-02T00:00:00Z"),
        ],
      },
    } as never);

    const res = await buildServer(() => pool as never).inject({
      method: "GET",
      url: "/api/repos/re-cinq/lore/implementation-loop",
      headers: AUTH,
    });

    expect(JSON.parse(res.payload)).toMatchObject({
      next: [
        { issue_number: 4, hold: { kind: "text_too_long" } },
        { issue_number: 6, hold: null },
      ],
    });
  });
});

describe("GET with tickets the loop is not working", () => {
  const enabledRepo = {
    rows: [{ settings: { implementation_loop: { enabled: true } } }],
  };
  const taskRow = (issue: number, status: string, failureReason: string) => ({
    id: `task-${issue}`,
    created_at: "2026-08-26T06:00:00.000Z",
    status,
    description: `Ticket ${issue}`,
    issue_number: issue,
    issue_url: `https://gh/i/${issue}`,
    pr_url: `https://gh/pr/${issue}0`,
    failure_reason: failureReason,
  });

  async function read(tasks: unknown[], issues: Record<string, unknown>) {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce(enabledRepo)
      .mockResolvedValueOnce({ rows: tasks })
      .mockResolvedValue({ rows: [] });
    vi.mocked(projectFor).mockResolvedValue({ issues } as never);

    const res = await buildServer(() => pool as never).inject({
      method: "GET",
      url: "/api/repos/re-cinq/lore/implementation-loop",
      headers: AUTH,
    });

    return JSON.parse(res.payload);
  }

  it("lists the lore:blocked #2 as parked with the reason its task stored, and keeps it out of the queue", async () => {
    const why =
      "the definition-of-done step could not express this ticket as acceptance tests: it asks for a decision";
    const loop = await read([taskRow(2, "completed", why)], {
      list: async () => [
        openIssue(2, ["priority:high", "lore:blocked"], "2026-08-01T00:00:00Z"),
      ],
    });

    expect(loop).toMatchObject({
      next: [],
      parked: [
        {
          issue_number: 2,
          state: "parked",
          pr_url: "https://gh/pr/20",
          hold: {
            kind: "parked",
            message: `The loop parked this ticket: ${why}.`,
            fix: "Fix what it names, then remove the lore:blocked label to re-queue it.",
          },
        },
      ],
    });
  });

  it("holds the queued #4 on its open blocker #12 and asks GitHub about no ticket without a blocked-by link", async () => {
    const asked: number[] = [];
    const loop = await read([], {
      list: async () => [
        {
          ...openIssue(4, ["priority:high"], "2026-08-01T00:00:00Z"),
          blockedByCount: 1,
        },
        openIssue(6, ["priority:high"], "2026-08-02T00:00:00Z"),
      ],
      openBlockers: async (issueNumber: number) => {
        asked.push(issueNumber);

        return [12];
      },
    });

    expect(asked).toEqual([4]);
    expect(loop.next).toMatchObject([
      {
        issue_number: 4,
        hold: {
          kind: "waits_on_blockers",
          message: "Waits on #12, which is still open.",
        },
      },
      { issue_number: 6, hold: null },
    ]);
  });

  it("holds the re-queued #5 on why its last attempt failed, read from the task", async () => {
    const loop = await read(
      [taskRow(5, "failed", "the run ended failed: 403 Forbidden")],
      {
        list: async () => [
          openIssue(5, ["priority:high"], "2026-08-01T00:00:00Z"),
        ],
      },
    );
    const hold = {
      kind: "failed",
      message: "The last attempt failed: the run ended failed: 403 Forbidden.",
      fix: "Check the Lore GitHub App's repository permissions and that it is installed on the target repo.",
    };

    expect(loop).toMatchObject({
      next: [{ issue_number: 5, state: "queued", hold }],
      recent: [{ issue_number: 5, state: "failed", hold }],
    });
  });
});

describe("floorRunContext", () => {
  function fakeFloor(overrides: {
    summaries?: Array<{ id: string; status: string; reason: string | null }>;
    graph?: { nodes: Array<{ id: string; type: string }> } | null;
    visits?: Array<{
      nodeId: string;
      iteration: number;
      outcome: string | null;
    }>;
  }) {
    return {
      listSummaries: async () => overrides.summaries ?? [],
      getById: async () => ({ graph: overrides.graph ?? null }),
      listStationRuns: async () => overrides.visits ?? [],
    };
  }

  it("is null when the floor has no run for the task", async () => {
    const { floorRunContext } = await import("./backlog-ticket.js");

    expect(
      await floorRunContext(fakeFloor({}) as never, "re-cinq/lore", "task-1"),
    ).toBeNull();
  });

  it("carries the run's status and reason even with no graph yet", async () => {
    const { floorRunContext } = await import("./backlog-ticket.js");
    const floor = fakeFloor({
      summaries: [{ id: "run-9", status: "running", reason: null }],
      graph: null,
    });

    expect(
      await floorRunContext(floor as never, "re-cinq/lore", "task-1"),
    ).toEqual({
      run: {
        id: "run-9",
        task_id: "task-1",
        status: "running",
        reason: null,
        graph: null,
      },
      nodeRows: [],
    });
  });

  it("maps the floor's visits into the pipeline's node rows", async () => {
    const { floorRunContext } = await import("./backlog-ticket.js");
    const floor = fakeFloor({
      summaries: [{ id: "run-9", status: "failed", reason: "iteration_max" }],
      graph: { nodes: [{ id: "implement", type: "agent" }] },
      visits: [{ nodeId: "implement", iteration: 1, outcome: "failed" }],
    });

    expect(
      await floorRunContext(floor as never, "re-cinq/lore", "task-1"),
    ).toEqual({
      run: {
        id: "run-9",
        task_id: "task-1",
        status: "failed",
        reason: "iteration_max",
        graph: { nodes: [{ id: "implement", type: "agent" }] },
      },
      nodeRows: [
        {
          assembly_run_id: "run-9",
          node_id: "implement",
          iteration: 1,
          outcome: "failed",
        },
      ],
    });
  });
});

describe("GET with a parked ticket whose last attempt has a run", () => {
  it("shows the parked ticket's Stages from its last attempt, same as a working one", async () => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({
        rows: [{ settings: { implementation_loop: { enabled: true } } }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "task-2",
            created_at: "2026-08-26T06:00:00.000Z",
            status: "completed",
            description: "Ticket 2",
            issue_number: 2,
            issue_url: "https://gh/i/2",
            pr_url: "https://gh/pr/20",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "run-2",
            task_id: "task-2",
            status: "completed",
            reason: null,
            graph: { nodes: [{ id: "implement", type: "agent" }] },
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            assembly_run_id: "run-2",
            node_id: "implement",
            iteration: 1,
            outcome: "success",
          },
        ],
      });
    vi.mocked(projectFor).mockResolvedValue({
      issues: {
        list: async () => [
          openIssue(
            2,
            ["priority:high", "lore:blocked"],
            "2026-08-01T00:00:00Z",
          ),
        ],
      },
    } as never);

    const res = await buildServer(() => pool as never).inject({
      method: "GET",
      url: "/api/repos/re-cinq/lore/implementation-loop",
      headers: AUTH,
    });

    expect(JSON.parse(res.payload).parked).toMatchObject([
      {
        issue_number: 2,
        state: "parked",
        run_id: "run-2",
        pipeline: [{ node_id: "implement", state: "success" }],
      },
    ]);
  });
});
