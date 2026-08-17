import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../../platform/project-boot.js", () => ({ projectFor: vi.fn() }));
vi.mock("@re-cinq/lore-server-core/features/pipeline/pipeline.js", () => ({
  createTask: vi.fn(),
  getTask: vi.fn(),
  listTasks: vi.fn(),
  retryTask: vi.fn(),
}));

import { buildServer } from "../../../server/build-server.js";
import { projectFor } from "../../../platform/project-boot.js";
import { createTask } from "@re-cinq/lore-server-core/features/pipeline/pipeline.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  useRateLimitSafeClock,
  makePool,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const base = "/api/repos/octo/repo/features";
const originalEnv = { ...process.env };

function fakeFeatures(overrides: Record<string, unknown> = {}) {
  return {
    get: vi.fn(),
    create: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    appendIteration: vi.fn().mockResolvedValue({ id: "it0", iteration: 0 }),
    attachIterationTask: vi.fn().mockResolvedValue(undefined),
    setIterationResult: vi.fn().mockResolvedValue(undefined),
    transitionStatus: vi.fn().mockResolvedValue(undefined),
    createSplitChild: vi.fn(),
    delete: vi.fn(),
    ...overrides,
  };
}

/** No line for the feature's first task → every round takes the legacy path. */
function fakeAssemblyLines(overrides: Record<string, unknown> = {}) {
  return {
    listForTask: vi.fn().mockResolvedValue([]),
    listStationRuns: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function useProject(
  features: ReturnType<typeof fakeFeatures>,
  assemblyLines = fakeAssemblyLines(),
) {
  vi.mocked(projectFor).mockResolvedValue({ features, assemblyLines } as never);

  return features;
}

const readyIteration = (gap: unknown) => ({
  id: "it1",
  feature_id: "f1",
  iteration: 0,
  task_id: "t0",
  status: "ready",
  user_answers: null,
  gap_result: gap,
  created_at: "2026-06-18T00:00:00Z",
  updated_at: "2026-06-18T00:00:00Z",
});

const req = (method: "GET" | "POST" | "DELETE", url: string, body?: unknown) =>
  buildServer(() => null).inject({
    method,
    url,
    headers: AUTH,
    payload: body === undefined ? undefined : JSON.stringify(body),
  });

const reqAs = (scopes: string[], method: "GET" | "DELETE", url: string) => {
  const pool = makePool();

  pool.query.mockResolvedValue({ rows: [{ scopes }] });

  return buildServer(() => pool as never).inject({
    method,
    url,
    headers: { authorization: "Bearer scoped-token" },
  });
};

describe("features routes", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    vi.clearAllMocks();
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("creates a draft and kicks planning round 1", async () => {
    const features = useProject(
      fakeFeatures({ create: vi.fn().mockResolvedValue({ id: "f1" }) }),
    );

    vi.mocked(createTask).mockResolvedValue({ task_id: "t1" } as never);
    const res = await req("POST", base, {
      title: "Smart Planning",
      prompt: "do it",
    });

    expect(res.statusCode).toBe(201);
    expect(res.result).toEqual({ id: "f1", task_id: "t1" });
    expect(features.create).toHaveBeenCalledWith({
      title: "Smart Planning",
      prompt: "do it",
      parentFeatureId: undefined,
    });
  });

  it("rejects a create with a blank title as a 400 before touching the project", async () => {
    useProject(fakeFeatures());
    const res = await req("POST", base, { title: "   ", prompt: "" });

    expect(res.statusCode).toBe(400);
    expect(res.result).toEqual({ error: "title and prompt are required" });
    expect(projectFor).not.toHaveBeenCalled();
  });

  it("refuses to finalize a feature that is not in a settled planning state", async () => {
    useProject(
      fakeFeatures({
        get: vi
          .fn()
          .mockResolvedValue({ id: "f1", status: "draft", iterations: [] }),
      }),
    );
    const res = await req("POST", `${base}/f1/finalize`, {});

    expect(res.statusCode).toBe(409);
    expect((res.result as { error: string }).error).toMatch(
      /cannot finalize a feature in 'draft'/,
    );
    expect(createTask).not.toHaveBeenCalled();
  });

  it("kicks the finalize task from a spec-ready feature", async () => {
    useProject(
      fakeFeatures({
        get: vi.fn().mockResolvedValue({
          id: "f1",
          status: "spec-ready",
          title: "X",
          slug: "x",
          iterations: [],
        }),
      }),
    );
    vi.mocked(createTask).mockResolvedValue({ task_id: "fin" } as never);
    const res = await req("POST", `${base}/f1/finalize`, {});

    expect(res.statusCode).toBe(202);
    expect(res.result).toEqual({ task_id: "fin" });
  });

  it("reports a later round to the node its line is parked on, minting no task", async () => {
    // The merged line: the author IS the station, so the round is an outcome
    // reported to the parked node — not a new line per round with nothing between.
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [{ id: "1" }] });
    const round1 = { ...readyIteration(null), iteration: 1, task_id: "task-1" };

    useProject(
      fakeFeatures({
        get: vi.fn().mockResolvedValue({ id: "f1", iterations: [round1] }),
        appendIteration: vi.fn().mockResolvedValue({ id: "it2", iteration: 2 }),
      }),
      fakeAssemblyLines({
        listForTask: vi.fn().mockResolvedValue([
          {
            id: "line-1",
            blueprintName: "feature-planning",
            status: "running",
          },
        ]),
        listStationRuns: vi.fn().mockResolvedValue([
          { nodeId: "analyze", iteration: 1, outcome: "success" },
          { nodeId: "author", iteration: 1, outcome: null },
        ]),
      }),
    );

    const res = await buildServer(() => pool as never).inject({
      method: "POST",
      url: `${base}/f1/iterations`,
      headers: AUTH,
      payload: JSON.stringify({ user_answers: { free_form: "smaller" } }),
    });

    expect(res.statusCode).toBe(202);
    expect(res.result).toMatchObject({
      iteration: 2,
      assembly_line_id: "line-1",
      task_id: null,
    });
    // A task here would start a SECOND line for the same feature.
    expect(createTask).not.toHaveBeenCalled();

    const insert = pool.query.mock.calls.find((c) =>
      String(c[0]).includes("events"),
    );

    expect(insert).toBeDefined();
    expect(JSON.stringify(insert)).toContain("assembly_run.resume");
    // The author asked for changes: the edge back to another round.
    expect(JSON.stringify(insert)).toContain("changes_requested");
  });

  it("rewinds to the round the author chose, carrying its draft and its task", async () => {
    const round1 = {
      ...readyIteration({
        sections: [{ title: "Overview", content: "ROUND ONE" }],
        draft_spec_markdown: "d1",
      }),
      iteration: 1,
      task_id: "task-round-1",
    };
    const round2 = {
      ...readyIteration({
        sections: [{ title: "Overview", content: "ROUND TWO" }],
        draft_spec_markdown: "d2",
      }),
      iteration: 2,
      task_id: "task-round-2",
    };
    const features = useProject(
      fakeFeatures({
        get: vi
          .fn()
          .mockResolvedValue({ id: "f1", iterations: [round1, round2] }),
        appendIteration: vi.fn().mockResolvedValue({ id: "it3", iteration: 3 }),
      }),
    );

    vi.mocked(createTask).mockResolvedValue({ task_id: "t3" } as never);

    const res = await req("POST", `${base}/f1/iterations`, {
      from_iteration: 1,
    });

    expect(res.statusCode).toBe(202);
    // The new round records where it forked from — without it the history is a
    // list pretending to be a tree.
    expect(features.appendIteration).toHaveBeenCalledWith("f1", null, 1);
    const bundle = vi.mocked(createTask).mock.calls[0][4] as Record<
      string,
      unknown
    >;

    expect(bundle.resume_from_task).toBe("task-round-1");
    const prompt = vi.mocked(createTask).mock.calls[0][0];

    expect(prompt).toContain("ROUND ONE");
    expect(prompt).not.toContain("ROUND TWO");
  });

  it("rejects rewinding to a round that produced no result", async () => {
    useProject(
      fakeFeatures({
        get: vi.fn().mockResolvedValue({
          id: "f1",
          iterations: [
            { ...readyIteration(null), iteration: 1, status: "failed" },
          ],
        }),
      }),
    );
    const res = await req("POST", `${base}/f1/iterations`, {
      from_iteration: 1,
    });

    expect(res.statusCode).toBe(400);
    expect((res.result as { error: string }).error).toMatch(
      /produced no result/,
    );
  });

  it("refuses to split when the latest ready round has no split suggestion", async () => {
    useProject(
      fakeFeatures({
        get: vi.fn().mockResolvedValue({
          id: "f1",
          iterations: [
            readyIteration({ sections: [], draft_spec_markdown: "x" }),
          ],
        }),
      }),
    );
    const res = await req("POST", `${base}/f1/split`, {
      title: "Part A",
      prompt: "carve A",
    });

    expect(res.statusCode).toBe(409);
    expect((res.result as { error: string }).error).toMatch(
      /no split suggestion/,
    );
  });

  it("creates a split child when the latest ready round suggests one", async () => {
    const gap = {
      sections: [],
      draft_spec_markdown: "x",
      split_suggestion: { rationale: "big", proposed_features: [] },
    };
    const features = useProject(
      fakeFeatures({
        get: vi
          .fn()
          .mockResolvedValue({ id: "f1", iterations: [readyIteration(gap)] }),
        createSplitChild: vi.fn().mockResolvedValue({ id: "child" }),
      }),
    );
    const res = await req("POST", `${base}/f1/split`, {
      title: "Part A",
      prompt: "carve A",
    });

    expect(res.statusCode).toBe(201);
    expect(res.result).toEqual({ id: "child" });
    expect(features.createSplitChild).toHaveBeenCalledWith("f1", {
      title: "Part A",
      prompt: "carve A",
    });
  });

  it("returns 404 for a missing feature on GET", async () => {
    useProject(fakeFeatures({ get: vi.fn().mockResolvedValue(null) }));
    const res = await req("GET", `${base}/missing`);

    expect(res.statusCode).toBe(404);
  });

  it("returns 200 on delete and 404 when nothing was removed", async () => {
    useProject(fakeFeatures({ delete: vi.fn().mockResolvedValue(true) }));
    const ok = await req("DELETE", `${base}/f1`);

    expect(ok.statusCode).toBe(200);
    expect(ok.result).toEqual({ ok: true });

    useProject(fakeFeatures({ delete: vi.fn().mockResolvedValue(false) }));
    const missing = await req("DELETE", `${base}/gone`);

    expect(missing.statusCode).toBe(404);
  });

  it("refuses DELETE with a read-scoped token and never touches the project", async () => {
    const features = useProject(fakeFeatures({ delete: vi.fn() }));
    const res = await reqAs(["read"], "DELETE", `${base}/f1`);

    expect(res.statusCode).toBe(403);
    expect(res.result).toEqual({ error: "insufficient scope" });
    expect(features.delete).not.toHaveBeenCalled();
  });

  it("allows DELETE with a write-scoped token", async () => {
    useProject(fakeFeatures({ delete: vi.fn().mockResolvedValue(true) }));
    const res = await reqAs(["write"], "DELETE", `${base}/f1`);

    expect(res.statusCode).toBe(200);
    expect(res.result).toEqual({ ok: true });
  });

  it("rejects a concurrent planning round with 409", async () => {
    const recent = {
      ...readyIteration(null),
      status: "running",
      created_at: new Date().toISOString(),
    };

    useProject(
      fakeFeatures({
        get: vi.fn().mockResolvedValue({
          id: "f1",
          title: "X",
          original_prompt: "p",
          iterations: [recent],
        }),
      }),
    );
    const res = await req("POST", `${base}/f1/iterations`, {
      user_answers: {},
    });

    expect(res.statusCode).toBe(409);
    expect(createTask).not.toHaveBeenCalled();
  });
});

describe("resume_from_iteration is a REWIND, not the ordinary basis", () => {
  // This block lives outside the suite above, so it needs its own auth fixture —
  // without it every request 401s and the assertions read as "no event emitted".
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    vi.clearAllMocks();
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  const parkedLine = () =>
    fakeAssemblyLines({
      listForTask: vi.fn().mockResolvedValue([
        {
          id: "line-1",
          blueprintName: "feature-planning",
          status: "running",
        },
      ]),
      listStationRuns: vi
        .fn()
        .mockResolvedValue([{ nodeId: "author", iteration: 1, outcome: null }]),
    });

  const post = async (body: unknown) => {
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [{ id: "1" }] });
    useProject(
      fakeFeatures({
        get: vi.fn().mockResolvedValue({
          id: "f1",
          iterations: [
            {
              ...readyIteration({
                sections: [{ title: "Overview", content: "round one" }],
                draft_spec_markdown: "d1",
              }),
              iteration: 1,
              task_id: "task-1",
            },
          ],
        }),
        appendIteration: vi.fn().mockResolvedValue({ id: "it2", iteration: 2 }),
      }),
      parkedLine(),
    );
    const res = await buildServer(() => pool as never).inject({
      method: "POST",
      url: `${base}/f1/iterations`,
      headers: AUTH,
      payload: JSON.stringify(body),
    });
    const insert = pool.query.mock.calls.find((c) =>
      String(c[0]).includes("pipeline.events"),
    );
    // params[2] is the jsonb payload, a JSON STRING — parse it rather than matching
    // text, or every assertion has to know how the driver escaped it.
    const params = (insert?.[1] ?? []) as string[];

    // A 4xx would otherwise read as "no event emitted", which sent me chasing the
    // wrong layer for twenty minutes.
    enforceTrue(
      Boolean(params[2]),
      Error,
      `no event: ${res.statusCode} ${JSON.stringify(res.result)}`,
    );

    return JSON.parse(params[2]) as {
      args?: { resume_from_iteration?: number | null };
    };
  };

  it("sends null for an ordinary round, so the run continues the newest conversation", async () => {
    // Sending the ordinary basis here makes EVERY round claim to be a rewind. The
    // resolver then honours it literally — and the rewind contract says an explicit
    // choice that resolves to nothing must start fresh, so a round whose basis never
    // archived silently loses the whole conversation.
    expect(
      (await post({ user_answers: { free_form: "go" } })).args,
    ).toMatchObject({ resume_from_iteration: null });
  });

  it("sends the chosen round when the author actually rewound", async () => {
    expect(
      (
        await post({
          user_answers: { free_form: "back to one" },
          from_iteration: 1,
        })
      ).args,
    ).toMatchObject({ resume_from_iteration: 1 });
  });
});

describe("accepting the plan resumes the parked node", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    vi.clearAllMocks();
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  const specReady = {
    id: "f1",
    status: "spec-ready",
    title: "X",
    slug: "x",
    iterations: [{ ...readyIteration(null), iteration: 1, task_id: "task-1" }],
  };

  it("reports success to the author node instead of minting a finalize line", async () => {
    // The accept is a station outcome like any other: the spec work follows on the
    // SAME line. A second line here is what made the feature's life invisible.
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [{ id: "1" }] });
    useProject(
      fakeFeatures({ get: vi.fn().mockResolvedValue(specReady) }),
      fakeAssemblyLines({
        listForTask: vi.fn().mockResolvedValue([
          {
            id: "line-1",
            blueprintName: "feature-planning",
            status: "running",
          },
        ]),
        listStationRuns: vi
          .fn()
          .mockResolvedValue([
            { nodeId: "author", iteration: 2, outcome: null },
          ]),
      }),
    );

    const res = await buildServer(() => pool as never).inject({
      method: "POST",
      url: `${base}/f1/finalize`,
      headers: AUTH,
      payload: JSON.stringify({}),
    });

    expect(res.statusCode).toBe(202);
    expect(res.result).toMatchObject({ assembly_line_id: "line-1" });
    expect(createTask).not.toHaveBeenCalled();

    const insert = pool.query.mock.calls.find((c) =>
      String(c[0]).includes("pipeline.events"),
    );
    const params = (insert?.[1] ?? []) as string[];

    enforceTrue(
      Boolean(params[2]),
      Error,
      `no event: ${res.statusCode} ${JSON.stringify(res.result)}`,
    );
    expect(JSON.parse(params[2])).toMatchObject({
      nodeId: "author",
      iteration: 2,
      outcome: "success",
    });
  });

  it("still kicks a finalize task for a feature whose planning predates the merged line", async () => {
    useProject(fakeFeatures({ get: vi.fn().mockResolvedValue(specReady) }));
    vi.mocked(createTask).mockResolvedValue({ task_id: "fin" } as never);

    const res = await req("POST", `${base}/f1/finalize`, {});

    expect(res.statusCode).toBe(202);
    expect(res.result).toEqual({ task_id: "fin" });
  });

  describe("GET .../features/:id/status — the wizard's poll", () => {
    const feature = {
      id: "f1",
      repo: "re-cinq/lore",
      title: "T",
      status: "planning",
      iterations: [
        { ...readyIteration({ sections: [] }), iteration: 1 },
        {
          ...readyIteration(null),
          iteration: 2,
          status: "running",
          task_id: "t2",
          gap_result: null,
        },
      ],
    };

    it("returns the feature without every round's gap payload", async () => {
      // The whole point of a separate route: GET .../features/:id carries every
      // round's gap_result — mockup markup plus a stylesheet each — which must not
      // be re-sent every 4 seconds.
      useProject(fakeFeatures({ get: vi.fn().mockResolvedValue(feature) }));
      const res = await req("GET", `${base}/f1/status`);

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload).feature).not.toHaveProperty("iterations");
    });

    it("carries the newest round and the newest that produced a result", async () => {
      useProject(fakeFeatures({ get: vi.fn().mockResolvedValue(feature) }));
      const body = JSON.parse((await req("GET", `${base}/f1/status`)).payload);

      expect(body.latest_iteration).toMatchObject({ iteration: 2 });
      expect(body.last_ready_iteration).toMatchObject({ iteration: 1 });
    });

    it("resolves the line that owns the feature's planning", async () => {
      // From round 2 on, a resumed round mints no task — only the OWNING task can
      // resolve the line, which is what the run graph hangs on.
      useProject(
        fakeFeatures({ get: vi.fn().mockResolvedValue(feature) }),
        fakeAssemblyLines({
          listForTask: vi
            .fn()
            .mockResolvedValue([
              { id: "line-1", blueprintName: "feature-planning" },
            ]),
        }),
      );
      const body = JSON.parse((await req("GET", `${base}/f1/status`)).payload);

      expect(body.assembly_line_id).toBe("line-1");
    });

    it("reports no line for a feature whose rounds name no task", async () => {
      useProject(
        fakeFeatures({
          get: vi.fn().mockResolvedValue({ ...feature, iterations: [] }),
        }),
      );
      const body = JSON.parse((await req("GET", `${base}/f1/status`)).payload);

      expect(body.assembly_line_id).toBeNull();
    });

    it("404s for a feature that does not exist", async () => {
      useProject(fakeFeatures({ get: vi.fn().mockResolvedValue(null) }));
      expect((await req("GET", `${base}/nope/status`)).statusCode).toBe(404);
    });
  });

  describe("GET .../features/:id/decomposition", () => {
    it("returns the feature's spec-tasks", async () => {
      const tasks = [
        {
          description: "add the port method",
          status: "pending",
          context_bundle: { spec_task_id: "T001", feature_id: "f1" },
        },
      ];

      vi.mocked(projectFor).mockResolvedValue({
        features: fakeFeatures({
          get: vi.fn().mockResolvedValue({ id: "f1", iterations: [] }),
        }),
        assemblyLines: fakeAssemblyLines(),
        tasks: { specTasksForFeature: vi.fn().mockResolvedValue(tasks) },
      } as never);
      const res = await req("GET", `${base}/f1/decomposition`);

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload)).toEqual({ tasks });
    });

    it("404s for a feature id that does not exist", async () => {
      // An unknown id is not an empty tree — reporting {tasks: []} for a typo
      // would look like success.
      vi.mocked(projectFor).mockResolvedValue({
        features: fakeFeatures({ get: vi.fn().mockResolvedValue(null) }),
        assemblyLines: fakeAssemblyLines(),
        tasks: { specTasksForFeature: vi.fn() },
      } as never);

      expect((await req("GET", `${base}/nope/decomposition`)).statusCode).toBe(
        404,
      );
    });

    it("returns an empty list for a feature never decomposed", async () => {
      // Honest empty rather than a 404: the feature exists, its tree does not yet.
      vi.mocked(projectFor).mockResolvedValue({
        features: fakeFeatures({
          get: vi.fn().mockResolvedValue({ id: "f1", iterations: [] }),
        }),
        assemblyLines: fakeAssemblyLines(),
        tasks: { specTasksForFeature: vi.fn().mockResolvedValue([]) },
      } as never);

      expect(
        JSON.parse((await req("GET", `${base}/f1/decomposition`)).payload),
      ).toEqual({
        tasks: [],
      });
    });
  });
});
