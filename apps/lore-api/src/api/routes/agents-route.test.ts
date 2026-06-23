import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { handleApiRoute } from "../routes.js";
import { makeReq, makeRes, makePool, makeOctokit, useRateLimitSafeClock, AUTH, LEGACY_TOKEN } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

// The agent-definitions route delegates to project.agentDefs and reuses the
// dark-factory two-key ceremony for the `image` field. parseAgentInput /
// imageFieldTouched are the REAL schema (not mocked) — bodies must be valid.

vi.mock("../../features/dark-factory/dark-factory-authz.js", () => {
  class TwoKeyError extends Error {
    constructor(message: string, public readonly code: string) {
      super(message);
    }
  }
  return { verifyApproval: vi.fn(), TwoKeyError };
});
vi.mock("../../platform/github-client.js", () => ({ getOctokit: vi.fn(), getGitHubToken: vi.fn() }));

const fakeAgents = {
  resolve: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};
vi.mock("../../platform/project-boot.js", () => ({ projectFor: vi.fn(async () => ({ agentDefs: fakeAgents })) }));

import { verifyApproval, TwoKeyError } from "../../features/dark-factory/dark-factory-authz.js";
import { getOctokit } from "../../platform/github-client.js";

const BASE = "/api/repos/o/r/agent-definitions";
const originalEnv = { ...process.env };

const def = {
  name: "general",
  model: "claude-opus-4-8",
  timeout_minutes: 45,
  prompt: "Task: {description}",
  image: null,
  execution_mode: "claude-code",
  review_required: true,
  project_id: "p1",
};

describe("routes — agents", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  function call(url: string, method: string, body?: unknown, headers: Record<string, string> = {}, pool = makePool()) {
    pool.query.mockResolvedValue({}); // audit insert (real pg returns a Promise)
    const res = makeRes();
    return handleApiRoute(
      makeReq({ url, method, headers: { ...AUTH, ...headers }, body }),
      res,
      pool as any,
    ).then(() => ({ res, pool }));
  }

  it("returns 503 when the pool is null", async () => {
    const res = makeRes();
    await handleApiRoute(makeReq({ url: BASE, headers: AUTH }), res, null);
    expect(res.statusCode).toBe(503);
  });

  describe("GET", () => {
    it("lists the repo's resolved agents", async () => {
      fakeAgents.list.mockResolvedValue([def]);
      const { res } = await call(BASE, "GET");
      expect(res.json).toEqual({ agents: [def] });
    });

    it("resolves one agent by name", async () => {
      fakeAgents.resolve.mockResolvedValue(def);
      const { res } = await call(`${BASE}/general`, "GET");
      expect(res.json).toEqual(def);
      expect(fakeAgents.resolve).toHaveBeenCalledWith("general");
    });

    it("returns 404 when the agent does not exist", async () => {
      fakeAgents.resolve.mockResolvedValue(null);
      const { res } = await call(`${BASE}/nope`, "GET");
      expect(res.statusCode).toBe(404);
      expect(res.json).toEqual({ error: "agent definition not found", name: "nope" });
    });
  });

  describe("writes", () => {
    it("creates an agent (admin tier) and audits it", async () => {
      fakeAgents.create.mockResolvedValue(def);
      const pool = makePool();
      const { res } = await call(BASE, "POST", { name: "general", model: "claude-opus-4-8" }, {}, pool);
      expect(res.json).toMatchObject({ ok: true, agent: def, ceremony: { tier: "admin" } });
      expect(fakeAgents.create).toHaveBeenCalled();
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining("pipeline.audit_log"),
        expect.arrayContaining(["agent_created", "o/r"]),
      );
    });

    it("rejects an invalid body with 400", async () => {
      const { res } = await call(BASE, "POST", { name: "NotKebab" });
      expect(res.statusCode).toBe(400);
      expect(res.json.error).toBe("invalid_agent");
    });

    it("two-key gates a create that sets an image (no approval header)", async () => {
      const { res } = await call(BASE, "POST", { name: "custom", image: "golang:1.23" });
      expect(res.statusCode).toBe(403);
      expect(res.json.error).toBe("two_key_required");
      expect(fakeAgents.create).not.toHaveBeenCalled();
    });

    it("applies an image create after CODEOWNERS approval", async () => {
      fakeAgents.create.mockResolvedValue({ ...def, name: "custom", image: "golang:1.23" });
      vi.mocked(getOctokit).mockResolvedValue(makeOctokit() as any);
      vi.mocked(verifyApproval).mockResolvedValue({ prRef: "#5", approver: "alice", prUrl: "https://gh/5" } as any);
      const { res } = await call(BASE, "POST", { name: "custom", image: "golang:1.23" }, { "x-lore-approval-pr": "#5" });
      expect(res.json).toMatchObject({ ok: true, ceremony: { tier: "two_key", approver: "alice" } });
    });

    it("returns 403 on a CODEOWNERS failure for an image change", async () => {
      vi.mocked(getOctokit).mockResolvedValue(makeOctokit() as any);
      vi.mocked(verifyApproval).mockRejectedValue(new TwoKeyError("nope", "approver_not_codeowner"));
      const { res } = await call(BASE, "POST", { name: "custom", image: "golang:1.23" }, { "x-lore-approval-pr": "#5" });
      expect(res.json).toMatchObject({ error: "codeowners_check_failed", code: "approver_not_codeowner" });
    });

    it("updates an agent by name", async () => {
      fakeAgents.update.mockResolvedValue(def);
      const { res } = await call(`${BASE}/general`, "PUT", { model: "claude-haiku-4-5-20251001" });
      expect(res.json).toMatchObject({ ok: true, agent: def });
      expect(fakeAgents.update).toHaveBeenCalledWith("general", { model: "claude-haiku-4-5-20251001" });
    });

    it("deletes an agent by name", async () => {
      fakeAgents.delete.mockResolvedValue(undefined);
      const { res } = await call(`${BASE}/general`, "DELETE");
      expect(res.json).toEqual({ ok: true, deleted: "general", crd_deleted: false });
      expect(fakeAgents.delete).toHaveBeenCalledWith("general");
    });
  });
});
