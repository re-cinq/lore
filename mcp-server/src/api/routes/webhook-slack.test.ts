import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHmac } from "node:crypto";
import { handleApiRoute } from "../routes.js";
import { makeReq, makeRes, makePool, useRateLimitSafeClock } from "../../test-helpers/http-mock.js";

vi.mock("../../features/pipeline/pipeline.js", () => ({ createTask: vi.fn(), getTask: vi.fn(), listTasks: vi.fn(), retryTask: vi.fn() }));

import { createTask, retryTask } from "../../features/pipeline/pipeline.js";

const SLACK_SECRET = "slack-secret";
const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

function slackReq(fields: Record<string, string>, opts: { ts?: string; sign?: boolean } = {}) {
  const raw = new URLSearchParams(fields).toString();
  const ts = opts.ts ?? String(Math.floor(Date.now() / 1000));
  const sig = "v0=" + createHmac("sha256", SLACK_SECRET).update(`v0:${ts}:${raw}`).digest("hex");
  return makeReq({
    url: "/api/webhook/slack",
    method: "POST",
    headers: { "x-slack-request-timestamp": ts, "x-slack-signature": opts.sign === false ? "v0=bad" : sig },
    body: raw,
  });
}

async function run(req: ReturnType<typeof makeReq>, pool: any = null) {
  const res = makeRes();
  await handleApiRoute(req, res, pool);
  return res;
}

describe("POST /api/webhook/slack", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_SLACK_SIGNING_SECRET = SLACK_SECRET;
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 202 })) as typeof fetch;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("returns 503 when the signing secret is unset", async () => {
    delete process.env.LORE_SLACK_SIGNING_SECRET;
    const res = await run(slackReq({ text: "hi" }));
    expect(res.statusCode).toBe(503);
  });
  it("returns 401 when signature headers are missing", async () => {
    const req = makeReq({ url: "/api/webhook/slack", method: "POST", headers: {}, body: "text=hi" });
    const res = await run(req);
    expect(res.statusCode).toBe(401);
  });
  it("returns 401 when the timestamp is too old", async () => {
    const res = await run(slackReq({ text: "hi" }, { ts: String(Math.floor(Date.now() / 1000) - 400) }));
    expect(res.statusCode).toBe(401);
  });
  it("returns 401 on an invalid signature", async () => {
    const res = await run(slackReq({ text: "hi" }, { sign: false }));
    expect(res.statusCode).toBe(401);
  });
  it("answers the url_verification challenge", async () => {
    const res = await run(slackReq({ type: "url_verification", challenge: "ch123" }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("ch123");
  });
  it("answers url_verification with an empty challenge when absent", async () => {
    const res = await run(slackReq({ type: "url_verification" }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("");
  });
  it("returns usage help when text is empty", async () => {
    const res = await run(slackReq({ text: "", channel_id: "C1", user_name: "u" }));
    expect(res.json.text).toContain("Usage:");
  });
  it("retries a task", async () => {
    vi.mocked(retryTask).mockResolvedValue({ task_id: "new" } as any);
    const res = await run(slackReq({ text: "retry t1", channel_id: "C1" }));
    expect(res.json).toMatchObject({ response_type: "in_channel" });
    expect(res.json.text).toContain("Retrying task");
  });
  it("reports a failed retry", async () => {
    vi.mocked(retryTask).mockRejectedValue(new Error("nope"));
    const res = await run(slackReq({ text: "retry t1" }));
    expect(res.json.text).toContain("Retry failed");
  });
  it("returns the no-repo message when the channel is unmapped", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [] });
    const res = await run(slackReq({ text: "do something", channel_id: "C-unmapped" }), pool as any);
    expect(res.json.text).toContain("No repo mapped");
  });
  it("returns the no-repo message when pool is null", async () => {
    const res = await run(slackReq({ text: "do something", channel_id: "C1" }), null);
    expect(res.json.text).toContain("No repo mapped");
  });
  it("falls through to no-repo when the channel query throws", async () => {
    const pool = makePool();
    pool.query.mockRejectedValue(new Error("lookup fail"));
    const res = await run(slackReq({ text: "do something", channel_id: "C1" }), pool as any);
    expect(res.json.text).toContain("No repo mapped");
  });
  it("creates an immediate task with a known type", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [{ full_name: "o/r" }] });
    vi.mocked(createTask).mockResolvedValue({ task_id: "s1" } as any);
    const res = await run(slackReq({ text: "! implementation add caching", channel_id: "C1", user_name: "bob" }), pool as any);
    expect(res.json.text).toContain("Priority: `immediate`");
    expect(createTask).toHaveBeenCalledWith("add caching", "implementation", "o/r", "slack:bob", { slack_channel_id: "C1", slack_user: "bob" }, "immediate");
  });
  it("creates a normal-priority task and reports the backlog", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [{ full_name: "o/r" }] });
    vi.mocked(createTask).mockResolvedValue({ task_id: "s2" } as any);
    const res = await run(slackReq({ text: "review check this", channel_id: "C1", user_name: "bob" }), pool as any);
    expect(res.json.text).toContain("backlog");
  });
  it("reports a failed task creation", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [{ full_name: "o/r" }] });
    vi.mocked(createTask).mockRejectedValue(new Error("create fail"));
    const res = await run(slackReq({ text: "do something", channel_id: "C1" }), pool as any);
    expect(res.json.text).toContain("Failed to create task");
  });
  it("treats a bare retry with no task id as a general-task description", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [{ full_name: "o/r" }] });
    vi.mocked(createTask).mockResolvedValue({ task_id: "r1" } as any);
    const res = await run(slackReq({ text: "retry", channel_id: "C1", user_name: "bob" }), pool as any);
    expect(createTask).toHaveBeenCalledWith("retry", "general", "o/r", "slack:bob", { slack_channel_id: "C1", slack_user: "bob" }, "normal");
    expect(res.json.text).toContain("Type: `general`");
  });
  it("creates an immediate general-typed task when no known type follows the bang", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [{ full_name: "o/r" }] });
    vi.mocked(createTask).mockResolvedValue({ task_id: "b1" } as any);
    const res = await run(slackReq({ text: "! fix the login bug", channel_id: "C1", user_name: "bob" }), pool as any);
    expect(createTask).toHaveBeenCalledWith("fix the login bug", "general", "o/r", "slack:bob", { slack_channel_id: "C1", slack_user: "bob" }, "immediate");
    expect(res.json.text).toContain("Priority: `immediate`");
  });
});
