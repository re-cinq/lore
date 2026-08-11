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

function useProject(features: ReturnType<typeof fakeFeatures>) {
  vi.mocked(projectFor).mockResolvedValue({ features } as never);

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
