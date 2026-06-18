import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../platform/project-boot.js", () => ({ projectFor: vi.fn() }));
vi.mock("../../features/pipeline/pipeline.js", () => ({ createTask: vi.fn() }));

import { handleFeaturesRoute, matchFeaturesRoute } from "./features.js";
import { projectFor } from "../../platform/project-boot.js";
import { createTask } from "../../features/pipeline/pipeline.js";
import { makeReq, makeRes } from "../../test-helpers/http-mock.js";

const base = "/api/repos/octo/repo/features";

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

describe("matchFeaturesRoute", () => {
  it("routes the POST result path with iteration + feature id captured", () => {
    const matched = matchFeaturesRoute(`${base}/f1/iterations/2/result`, "POST");
    expect(matched?.m[3]).toBe("f1");
    expect(matched?.m[4]).toBe("2");
  });

  it("returns null for a known path with an unsupported method", () => {
    expect(matchFeaturesRoute(`${base}/f1`, "PUT")).toBeNull();
    expect(matchFeaturesRoute(`${base}/f1/iterations/2/result`, "GET")).toBeNull();
  });

  it("distinguishes GET one, DELETE one, GET list, and POST create", () => {
    expect(matchFeaturesRoute(`${base}/f1`, "GET")?.m[3]).toBe("f1");
    expect(matchFeaturesRoute(`${base}/f1`, "DELETE")?.m[3]).toBe("f1");
    expect(matchFeaturesRoute(base, "GET")).not.toBeNull();
    expect(matchFeaturesRoute(base, "POST")).not.toBeNull();
  });

  it("returns null for a path outside the feature surface", () => {
    expect(matchFeaturesRoute("/api/repos/octo/repo/specs", "GET")).toBeNull();
  });
});

describe("handleFeaturesRoute", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a draft and kicks planning round 1", async () => {
    const features = useProject(fakeFeatures({ create: vi.fn().mockResolvedValue({ id: "f1" }) }));
    vi.mocked(createTask).mockResolvedValue({ task_id: "t1" } as never);
    const res = makeRes();
    await handleFeaturesRoute(makeReq({ url: base, method: "POST", body: { title: "Smart Planning", prompt: "do it" } }), res, null);
    expect(res.statusCode).toBe(201);
    expect(res.json).toEqual({ id: "f1", task_id: "t1" });
    expect(features.create).toHaveBeenCalledWith({ title: "Smart Planning", prompt: "do it", parentFeatureId: undefined });
  });

  it("rejects a create with a blank title as a 400 before touching the project", async () => {
    useProject(fakeFeatures());
    const res = makeRes();
    await handleFeaturesRoute(makeReq({ url: base, method: "POST", body: { title: "   ", prompt: "" } }), res, null);
    expect(res.statusCode).toBe(400);
    expect(res.json).toEqual({ error: "title and prompt are required" });
    expect(projectFor).not.toHaveBeenCalled();
  });

  it("refuses to finalize a feature that is not in a settled planning state", async () => {
    useProject(fakeFeatures({ get: vi.fn().mockResolvedValue({ id: "f1", status: "draft", iterations: [] }) }));
    const res = makeRes();
    await handleFeaturesRoute(makeReq({ url: `${base}/f1/finalize`, method: "POST", body: {} }), res, null);
    expect(res.statusCode).toBe(409);
    expect(res.json.error).toMatch(/cannot finalize a feature in 'draft'/);
    expect(createTask).not.toHaveBeenCalled();
  });

  it("kicks the finalize task from a spec-ready feature", async () => {
    useProject(fakeFeatures({ get: vi.fn().mockResolvedValue({ id: "f1", status: "spec-ready", title: "X", slug: "x", iterations: [] }) }));
    vi.mocked(createTask).mockResolvedValue({ task_id: "fin" } as never);
    const res = makeRes();
    await handleFeaturesRoute(makeReq({ url: `${base}/f1/finalize`, method: "POST", body: {} }), res, null);
    expect(res.statusCode).toBe(202);
    expect(res.json).toEqual({ task_id: "fin" });
  });

  it("refuses to split when the latest ready round has no split suggestion", async () => {
    useProject(fakeFeatures({
      get: vi.fn().mockResolvedValue({ id: "f1", iterations: [readyIteration({ sections: [], draft_spec_markdown: "x" })] }),
    }));
    const res = makeRes();
    await handleFeaturesRoute(makeReq({ url: `${base}/f1/split`, method: "POST", body: { title: "Part A", prompt: "carve A" } }), res, null);
    expect(res.statusCode).toBe(409);
    expect(res.json.error).toMatch(/no split suggestion/);
  });

  it("creates a split child when the latest ready round suggests one", async () => {
    const gap = { sections: [], draft_spec_markdown: "x", split_suggestion: { rationale: "big", proposed_features: [] } };
    const features = useProject(fakeFeatures({
      get: vi.fn().mockResolvedValue({ id: "f1", iterations: [readyIteration(gap)] }),
      createSplitChild: vi.fn().mockResolvedValue({ id: "child" }),
    }));
    const res = makeRes();
    await handleFeaturesRoute(makeReq({ url: `${base}/f1/split`, method: "POST", body: { title: "Part A", prompt: "carve A" } }), res, null);
    expect(res.statusCode).toBe(201);
    expect(res.json).toEqual({ id: "child" });
    expect(features.createSplitChild).toHaveBeenCalledWith("f1", { title: "Part A", prompt: "carve A" });
  });

  it("returns 404 for a missing feature on GET", async () => {
    useProject(fakeFeatures({ get: vi.fn().mockResolvedValue(null) }));
    const res = makeRes();
    await handleFeaturesRoute(makeReq({ url: `${base}/missing`, method: "GET" }), res, null);
    expect(res.statusCode).toBe(404);
  });

  it("returns 200 on delete and 404 when nothing was removed", async () => {
    useProject(fakeFeatures({ delete: vi.fn().mockResolvedValue(true) }));
    const ok = makeRes();
    await handleFeaturesRoute(makeReq({ url: `${base}/f1`, method: "DELETE" }), ok, null);
    expect(ok.statusCode).toBe(200);
    expect(ok.json).toEqual({ ok: true });

    useProject(fakeFeatures({ delete: vi.fn().mockResolvedValue(false) }));
    const missing = makeRes();
    await handleFeaturesRoute(makeReq({ url: `${base}/gone`, method: "DELETE" }), missing, null);
    expect(missing.statusCode).toBe(404);
  });

  it("rejects a concurrent planning round with 409", async () => {
    const recent = { ...readyIteration(null), status: "running", created_at: new Date().toISOString() };
    useProject(fakeFeatures({ get: vi.fn().mockResolvedValue({ id: "f1", title: "X", original_prompt: "p", iterations: [recent] }) }));
    const res = makeRes();
    await handleFeaturesRoute(makeReq({ url: `${base}/f1/iterations`, method: "POST", body: { user_answers: {} } }), res, null);
    expect(res.statusCode).toBe(409);
    expect(createTask).not.toHaveBeenCalled();
  });

  it("returns 404 for a path outside the feature surface", async () => {
    const res = makeRes();
    await handleFeaturesRoute(makeReq({ url: "/api/repos/octo/repo/specs", method: "GET" }), res, null);
    expect(res.statusCode).toBe(404);
    expect(res.json).toEqual({ error: "not found" });
  });
});
