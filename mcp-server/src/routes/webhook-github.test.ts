import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHmac } from "node:crypto";
import { handleApiRoute } from "../routes.js";
import { makeReq, makeRes, makePool, useRateLimitSafeClock } from "../test-helpers/http-mock.js";

vi.mock("../pipeline.js", () => ({ createTask: vi.fn(), getTask: vi.fn(), listTasks: vi.fn(), retryTask: vi.fn() }));
vi.mock("../tasks.js", () => ({ syncTasksToDb: vi.fn() }));
vi.mock("../github-client.js", () => ({ getGitHubToken: vi.fn(), getOctokit: vi.fn() }));
vi.mock("@re-cinq/lore-shared", () => ({
  redactSecrets: (s: string) => s,
  parseTasks: vi.fn(() => [{ id: "T1" }]),
  inferPhaseDependencies: vi.fn((t: unknown) => t),
  parseTrailers: vi.fn(),
  parseSpecTitle: vi.fn(),
  extractSummary: vi.fn(),
  reassembleSpec: vi.fn(),
}));

import { createTask } from "../pipeline.js";
import { syncTasksToDb } from "../tasks.js";
import { getGitHubToken } from "../github-client.js";

const WEBHOOK_SECRET = "gh-secret";
const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

function ghReq(event: string, payload: unknown, opts: { secret?: string; sig?: string } = {}) {
  const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
  const sig = opts.sig ?? "sha256=" + createHmac("sha256", opts.secret ?? WEBHOOK_SECRET).update(raw).digest("hex");
  const headers: Record<string, string> = { "x-github-event": event };
  if (opts.sig !== "OMIT") headers["x-hub-signature-256"] = sig;
  return makeReq({ url: "/api/webhook/github", method: "POST", headers, body: raw });
}

async function run(req: ReturnType<typeof makeReq>, pool: any = null) {
  const res = makeRes();
  await handleApiRoute(req, res, pool);
  return res;
}

describe("POST /api/webhook/github", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.LORE_AGENT_URL = "http://agent:8080";
    process.env.LORE_AGENT_INTERNAL_TOKEN = "agent-tok";
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 202 })) as typeof fetch;
    vi.mocked(getGitHubToken).mockResolvedValue("gh-tok" as any);
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  describe("signature", () => {
    it("returns 503 when the webhook secret is unset", async () => {
      delete process.env.LORE_WEBHOOK_SECRET;
      const res = await run(ghReq("ping", {}));
      expect(res.statusCode).toBe(503);
    });
    it("returns 401 when the signature header is missing", async () => {
      const res = await run(ghReq("ping", {}, { sig: "OMIT" }));
      expect(res.statusCode).toBe(401);
      expect(res.json).toEqual({ error: "missing signature" });
    });
    it("returns 401 on an invalid signature", async () => {
      const res = await run(ghReq("ping", {}, { sig: "sha256=bad" }));
      expect(res.statusCode).toBe(401);
      expect(res.json).toEqual({ error: "invalid signature" });
    });
  });

  describe("pull_request", () => {
    const specPayload = (over: Record<string, unknown> = {}) => ({
      action: "closed",
      repository: { full_name: "o/r" },
      pull_request: {
        merged: true,
        merge_commit_sha: "deadbeef",
        head: { ref: "lore/feature-request/myslug-1234abcd" },
        labels: [{ name: "spec" }],
        ...over,
      },
    });

    it("syncs spec-tasks on a merged spec PR", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response("tasks md", { status: 200 })) as typeof fetch;
      vi.mocked(syncTasksToDb).mockResolvedValue({ synced: 2, created: 2 } as any);
      const pool = makePool();
      pool.query.mockResolvedValue({ rows: [] });
      const res = await run(ghReq("pull_request", specPayload()), pool as any);
      expect(res.json).toMatchObject({ ok: true, spec_slug: "myslug", tasks_created: 2 });
    });
    it("swallows a failing parent-task update", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response("tasks md", { status: 200 })) as typeof fetch;
      vi.mocked(syncTasksToDb).mockResolvedValue({ synced: 1, created: 1 } as any);
      const pool = makePool();
      pool.query.mockImplementation((sql: string) => {
        if (sql.includes("feature-request") && sql.includes("merged")) return Promise.reject(new Error("update fail"));
        return Promise.resolve({ rows: [] });
      });
      const res = await run(ghReq("pull_request", specPayload()), pool as any);
      expect(res.json).toMatchObject({ ok: true });
    });
    it("returns 503 when pool is null on a spec merge", async () => {
      const res = await run(ghReq("pull_request", specPayload()), null);
      expect(res.statusCode).toBe(503);
    });
    it("skips a non-spec branch", async () => {
      const pool = makePool();
      const res = await run(ghReq("pull_request", specPayload({ head: { ref: "feature/x" } })), pool as any);
      expect(res.json).toMatchObject({ skipped: true, reason: "not a spec PR" });
    });
    it("skips when the slug cannot be extracted", async () => {
      const pool = makePool();
      const res = await run(ghReq("pull_request", specPayload({ head: { ref: "lore/feature-request/" } })), pool as any);
      expect(res.json).toMatchObject({ reason: "could not extract spec slug" });
    });
    it("handles a missing head ref and labels (defaults to non-spec)", async () => {
      const pool = makePool();
      const res = await run(ghReq("pull_request", specPayload({ head: undefined, labels: undefined })), pool as any);
      expect(res.json).toMatchObject({ reason: "not a spec PR" });
    });
    it("skips when spec-tasks already synced", async () => {
      const pool = makePool();
      pool.query.mockResolvedValue({ rows: [{ id: 1 }] });
      const res = await run(ghReq("pull_request", specPayload()), pool as any);
      expect(res.json).toMatchObject({ reason: "spec-tasks already synced" });
    });
    it("skips when tasks.md is missing (no GitHub token)", async () => {
      vi.mocked(getGitHubToken).mockResolvedValue(null as any);
      const pool = makePool();
      pool.query.mockResolvedValue({ rows: [] });
      const res = await run(ghReq("pull_request", specPayload()), pool as any);
      expect(res.json).toMatchObject({ reason: "no tasks.md found" });
    });
    it("skips when tasks.md fetch is not ok", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response("nope", { status: 404 })) as typeof fetch;
      const pool = makePool();
      pool.query.mockResolvedValue({ rows: [] });
      const res = await run(ghReq("pull_request", specPayload()), pool as any);
      expect(res.json).toMatchObject({ reason: "no tasks.md found" });
    });
    it("triggers the review reactor on synchronize", async () => {
      const res = await run(ghReq("pull_request", { action: "synchronize", repository: { full_name: "o/r" }, pull_request: { number: 7 } }), makePool() as any);
      expect(res.json).toMatchObject({ triggered: "review-reactor", via: "pull_request" });
    });
    it("skips when the review trigger lacks repo/pr", async () => {
      const res = await run(ghReq("pull_request", { action: "synchronize", pull_request: {} }), makePool() as any);
      expect(res.json).toMatchObject({ reason: "no handler for pull_request action" });
    });
    it("skips an unhandled pull_request action", async () => {
      const res = await run(ghReq("pull_request", { action: "edited", repository: { full_name: "o/r" }, pull_request: { number: 1 } }), makePool() as any);
      expect(res.json).toMatchObject({ skipped: true });
    });
    it("warns and continues when the agent env is unset", async () => {
      delete process.env.LORE_AGENT_URL;
      const res = await run(ghReq("pull_request", { action: "synchronize", repository: { full_name: "o/r" }, pull_request: { number: 7 } }), makePool() as any);
      expect(res.json).toMatchObject({ triggered: "review-reactor" });
    });
    it("swallows a failing reactor-trigger fetch", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("conn refused")) as typeof fetch;
      const res = await run(ghReq("pull_request", { action: "synchronize", repository: { full_name: "o/r" }, pull_request: { number: 7 } }), makePool() as any);
      expect(res.json).toMatchObject({ triggered: "review-reactor" });
      await new Promise((r) => setTimeout(r, 5));
    });
    it("returns 400 on invalid JSON", async () => {
      const res = await run(ghReq("pull_request", "{bad"), makePool() as any);
      expect(res.statusCode).toBe(400);
    });
  });

  describe("pull_request_review", () => {
    it("triggers reactor and auto-merge on a submitted review", async () => {
      const res = await run(ghReq("pull_request_review", { action: "submitted", repository: { full_name: "o/r" }, pull_request: { number: 3 } }), makePool() as any);
      expect(res.json).toMatchObject({ triggered: "review-reactor", via: "pull_request_review" });
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });
    it("returns 400 when repo/pr missing on submitted review", async () => {
      const res = await run(ghReq("pull_request_review", { action: "submitted", pull_request: {} }), makePool() as any);
      expect(res.statusCode).toBe(400);
    });
    it("skips a non-submitted review", async () => {
      const res = await run(ghReq("pull_request_review", { action: "dismissed" }), makePool() as any);
      expect(res.json).toMatchObject({ reason: "not a submitted review" });
    });
    it("returns 400 on invalid JSON", async () => {
      const res = await run(ghReq("pull_request_review", "{bad"), makePool() as any);
      expect(res.statusCode).toBe(400);
    });
  });

  describe("check events", () => {
    it("fans out auto-merge for check_run", async () => {
      const res = await run(ghReq("check_run", { action: "completed", repository: { full_name: "o/r" }, check_run: { pull_requests: [{ number: 4 }] } }), makePool() as any);
      expect(res.json).toMatchObject({ triggered: "auto-merge", via: "check_run", pr_numbers: [4] });
    });
    it("fans out auto-merge for check_suite", async () => {
      const res = await run(ghReq("check_suite", { action: "completed", repository: { full_name: "o/r" }, check_suite: { pull_requests: [{ number: 8 }] } }), makePool() as any);
      expect(res.json).toMatchObject({ via: "check_suite" });
    });
    it("skips a non-completed check", async () => {
      const res = await run(ghReq("check_run", { action: "rerequested" }), makePool() as any);
      expect(res.json).toMatchObject({ reason: "not a completed action" });
    });
    it("skips when there are no pull_requests", async () => {
      const res = await run(ghReq("check_run", { action: "completed", repository: { full_name: "o/r" }, check_run: { pull_requests: [] } }), makePool() as any);
      expect(res.json).toMatchObject({ reason: "no pull_requests in payload" });
    });
    it("returns 400 on invalid JSON", async () => {
      const res = await run(ghReq("check_run", "{bad"), makePool() as any);
      expect(res.statusCode).toBe(400);
    });
    it("warns and continues when the agent env is unset", async () => {
      delete process.env.LORE_AGENT_URL;
      const res = await run(ghReq("check_run", { action: "completed", repository: { full_name: "o/r" }, check_run: { pull_requests: [{ number: 4 }] } }), makePool() as any);
      expect(res.json).toMatchObject({ triggered: "auto-merge" });
      await new Promise((r) => setTimeout(r, 5));
    });
    it("swallows a failing auto-merge-trigger fetch", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("conn refused")) as typeof fetch;
      const res = await run(ghReq("check_run", { action: "completed", repository: { full_name: "o/r" }, check_run: { pull_requests: [{ number: 4 }] } }), makePool() as any);
      expect(res.json).toMatchObject({ triggered: "auto-merge" });
      await new Promise((r) => setTimeout(r, 5));
    });
  });

  describe("issue_comment", () => {
    it("triggers reactor on a PR comment", async () => {
      const res = await run(ghReq("issue_comment", { action: "created", repository: { full_name: "o/r" }, issue: { number: 9, pull_request: {} } }), makePool() as any);
      expect(res.json).toMatchObject({ triggered: "review-reactor", via: "issue_comment" });
    });
    it("skips a comment that lacks repo/pr", async () => {
      const res = await run(ghReq("issue_comment", { action: "created", issue: { pull_request: {} } }), makePool() as any);
      expect(res.json).toMatchObject({ reason: "not a PR issue_comment created event" });
    });
    it("skips a non-PR comment", async () => {
      const res = await run(ghReq("issue_comment", { action: "created", issue: {} }), makePool() as any);
      expect(res.json).toMatchObject({ skipped: true });
    });
    it("returns 400 on invalid JSON", async () => {
      const res = await run(ghReq("issue_comment", "{bad"), makePool() as any);
      expect(res.statusCode).toBe(400);
    });
  });

  describe("issues dispatch", () => {
    const issuePayload = (over: Record<string, unknown> = {}, labelName = "lore") => ({
      action: "labeled",
      repository: { full_name: "o/r" },
      label: { name: labelName },
      issue: { number: 12, title: "Title", body: "Body", html_url: "https://gh/12", labels: [], ...over },
    });

    it("skips a non-issues event", async () => {
      const res = await run(ghReq("label", {}), makePool() as any);
      expect(res.json).toMatchObject({ reason: "not an issues event" });
    });
    it("returns 400 on invalid JSON", async () => {
      const res = await run(ghReq("issues", "{bad"), makePool() as any);
      expect(res.statusCode).toBe(400);
    });
    it("skips a non-labeled action", async () => {
      const res = await run(ghReq("issues", { action: "opened" }), makePool() as any);
      expect(res.json).toMatchObject({ reason: "not a labeled action" });
    });
    it("returns 400 on missing fields", async () => {
      const res = await run(ghReq("issues", { action: "labeled", repository: {} }), makePool() as any);
      expect(res.statusCode).toBe(400);
    });
    it("skips when the label does not match dispatch_label", async () => {
      const pool = makePool();
      pool.query.mockResolvedValue({ rows: [] });
      const res = await run(ghReq("issues", issuePayload({}, "random")), pool as any);
      expect(res.json).toMatchObject({ reason: "label does not match dispatch_label" });
    });
    it("honors string-encoded settings for a custom dispatch label", async () => {
      const pool = makePool();
      pool.query.mockImplementation((sql: string) => {
        if (sql.includes("SELECT settings")) return Promise.resolve({ rows: [{ settings: '{"dispatch_label":"go","dispatch_default_type":"runbook"}' }] });
        if (sql.includes("WHERE issue_number = $1")) return Promise.resolve({ rows: [] });
        return Promise.resolve({});
      });
      vi.mocked(createTask).mockResolvedValue({ task_id: "g1", status: "pending" } as any);
      const res = await run(ghReq("issues", issuePayload({}, "go")), pool as any);
      expect(res.json).toMatchObject({ task_id: "g1" });
    });
    it("uses object settings without dispatch overrides", async () => {
      const pool = makePool();
      pool.query.mockImplementation((sql: string) => {
        if (sql.includes("SELECT settings")) return Promise.resolve({ rows: [{ settings: { other: true } }] });
        if (sql.includes("WHERE issue_number = $1")) return Promise.resolve({ rows: [] });
        return Promise.resolve({});
      });
      vi.mocked(createTask).mockResolvedValue({ task_id: "o1", status: "pending" } as any);
      const res = await run(ghReq("issues", issuePayload({ title: undefined, body: undefined, html_url: undefined, labels: undefined })), pool as any);
      expect(res.json).toMatchObject({ task_id: "o1" });
    });
    it("defaults dispatch settings when the settings query throws", async () => {
      const pool = makePool();
      pool.query.mockImplementation((sql: string) => {
        if (sql.includes("SELECT settings")) return Promise.reject(new Error("settings fail"));
        if (sql.includes("WHERE issue_number = $1")) return Promise.resolve({ rows: [] });
        return Promise.resolve({});
      });
      vi.mocked(createTask).mockResolvedValue({ task_id: "d1", status: "pending" } as any);
      const res = await run(ghReq("issues", issuePayload()), pool as any);
      expect(res.json).toMatchObject({ task_id: "d1" });
    });
    it("returns 503 when pool is null after the label matches", async () => {
      const res = await run(ghReq("issues", issuePayload()), null);
      expect(res.statusCode).toBe(503);
    });
    it("picks the implementation task type from issue labels", async () => {
      const pool = makePool();
      pool.query.mockImplementation((sql: string) => {
        if (sql.includes("SELECT settings")) return Promise.resolve({ rows: [] });
        if (sql.includes("WHERE issue_number = $1")) return Promise.resolve({ rows: [] });
        return Promise.resolve({});
      });
      vi.mocked(createTask).mockResolvedValue({ task_id: "i1", status: "pending" } as any);
      await run(ghReq("issues", issuePayload({ labels: [{ name: "lore:implementation" }] })), pool as any);
      expect(createTask).toHaveBeenCalledWith("Title\n\nBody", "implementation", "o/r", "github-webhook", expect.any(Object));
    });
    it("skips a duplicate task and comments on the issue", async () => {
      const pool = makePool();
      pool.query.mockImplementation((sql: string) => {
        if (sql.includes("SELECT settings")) return Promise.resolve({ rows: [] });
        if (sql.includes("WHERE issue_number = $1")) return Promise.resolve({ rows: [{ id: "existing" }] });
        return Promise.resolve({});
      });
      const res = await run(ghReq("issues", issuePayload()), pool as any);
      expect(res.json).toMatchObject({ reason: "duplicate", task_id: "existing" });
    });
    it("proceeds when the duplicate check throws", async () => {
      const pool = makePool();
      pool.query.mockImplementation((sql: string) => {
        if (sql.includes("SELECT settings")) return Promise.resolve({ rows: [] });
        if (sql.includes("WHERE issue_number = $1")) return Promise.reject(new Error("dup fail"));
        return Promise.resolve({});
      });
      vi.mocked(createTask).mockResolvedValue({ task_id: "p1", status: "pending" } as any);
      const res = await run(ghReq("issues", issuePayload()), pool as any);
      expect(res.json).toMatchObject({ task_id: "p1" });
    });
    it("creates a task and labels the issue (no GitHub token)", async () => {
      vi.mocked(getGitHubToken).mockResolvedValue(null as any);
      const pool = makePool();
      pool.query.mockImplementation((sql: string) => {
        if (sql.includes("SELECT settings")) return Promise.resolve({ rows: [] });
        if (sql.includes("WHERE issue_number = $1")) return Promise.resolve({ rows: [] });
        return Promise.resolve({});
      });
      vi.mocked(createTask).mockResolvedValue({ task_id: "n1", status: "pending" } as any);
      const res = await run(ghReq("issues", issuePayload({ labels: [{ name: "lore:review" }] })), pool as any);
      expect(res.json).toMatchObject({ task_id: "n1", status: "pending" });
    });
    it("returns 500 when createTask throws", async () => {
      const pool = makePool();
      pool.query.mockImplementation((sql: string) => {
        if (sql.includes("SELECT settings")) return Promise.resolve({ rows: [] });
        if (sql.includes("WHERE issue_number = $1")) return Promise.resolve({ rows: [] });
        return Promise.resolve({});
      });
      vi.mocked(createTask).mockRejectedValue(new Error("create fail"));
      const res = await run(ghReq("issues", issuePayload({ labels: [{ name: "lore:runbook" }] })), pool as any);
      expect(res.statusCode).toBe(500);
    });
  });
});
