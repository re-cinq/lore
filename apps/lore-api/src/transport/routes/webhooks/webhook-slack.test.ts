import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHmac } from "node:crypto";
import { buildServer } from "../../../app/build-server.js";
import { useRateLimitSafeClock } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

vi.mock("@re-cinq/lore-server-core/features/pipeline/pipeline.js", () => ({
  createTask: vi.fn(),
  getTask: vi.fn(),
  listTasks: vi.fn(),
  retryTask: vi.fn(),
}));

import {
  createTask,
  retryTask,
} from "@re-cinq/lore-server-core/features/pipeline/pipeline.js";

const NO_TYPED_TASKS =
  "Lore no longer runs typed tasks, so nothing is created here. To have something implemented or written, open an issue with a priority:high, priority:medium or priority:low label and the implementation loop picks it up. To have a feature specified, start a plan on the repository's Plans page. Every open pull request is reviewed already; comment `@lore review` on one to have it reviewed again.";
const SLACK_SECRET = "slack-secret";
const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

function slack(
  fields: Record<string, string>,
  opts: { ts?: string; sign?: boolean } = {},
  pool: unknown = null,
) {
  const raw = new URLSearchParams(fields).toString();
  const ts = opts.ts ?? String(Math.floor(Date.now() / 1000)); // eslint-disable-line re-lint/no-nondeterministic-tests -- clock pinned for the file by useRateLimitSafeClock()
  const sig =
    "v0=" +
    createHmac("sha256", SLACK_SECRET).update(`v0:${ts}:${raw}`).digest("hex");

  return buildServer(() => pool as any).inject({
    method: "POST",
    url: "/api/webhook/slack",
    headers: {
      "x-slack-request-timestamp": ts,
      "x-slack-signature": opts.sign === false ? "v0=bad" : sig,
    },
    payload: raw,
  });
}
const text = (result: unknown) => (result as { text: string }).text;

describe("POST /api/webhook/slack", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_SLACK_SIGNING_SECRET = SLACK_SECRET;
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 202 })) as typeof fetch;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("returns 503 when the signing secret is unset", async () => {
    delete process.env.LORE_SLACK_SIGNING_SECRET;
    const res = await slack({ text: "hi" });

    expect(res.statusCode).toBe(503);
  });

  it("returns 401 when signature headers are missing", async () => {
    const res = await buildServer(() => null).inject({
      method: "POST",
      url: "/api/webhook/slack",
      payload: "text=hi",
    });

    expect(res.statusCode).toBe(401);
  });

  it("returns 401 when the timestamp is too old", async () => {
    const res = await slack(
      { text: "hi" },
      { ts: String(Math.floor(Date.now() / 1000) - 400) }, // eslint-disable-line re-lint/no-nondeterministic-tests -- clock pinned for the file by useRateLimitSafeClock()
    );

    expect(res.statusCode).toBe(401);
  });

  it("returns 401 on an invalid signature", async () => {
    const res = await slack({ text: "hi" }, { sign: false });

    expect(res.statusCode).toBe(401);
  });

  it("answers the url_verification challenge", async () => {
    const res = await slack({ type: "url_verification", challenge: "ch123" });

    expect(res.statusCode).toBe(200);
    expect(res.payload).toBe("ch123");
  });

  it("answers url_verification with an empty challenge when absent", async () => {
    const res = await slack({ type: "url_verification" });

    expect(res.statusCode).toBe(200);
    expect(res.payload).toBe("");
  });

  it("returns usage help when text is empty", async () => {
    const res = await slack({ text: "", channel_id: "C1", user_name: "u" });

    expect(text(res.result)).toContain("`/lore retry <task_id>`");
  });

  it("retries a task", async () => {
    vi.mocked(retryTask).mockResolvedValue({ task_id: "new" } as any);
    const res = await slack({ text: "retry t1", channel_id: "C1" });

    expect(res.result).toMatchObject({ response_type: "in_channel" });
    expect(text(res.result)).toContain("Retrying task");
  });

  it("reports a failed retry", async () => {
    vi.mocked(retryTask).mockRejectedValue(new Error("nope"));
    const res = await slack({ text: "retry t1" });

    expect(text(res.result)).toContain("Retry failed");
  });

  it.each(["runbook database failover", "! fix the login bug", "retry"])(
    "creates no task for /lore %s and says where that work goes now",
    async (typed) => {
      const res = await slack({
        text: typed,
        channel_id: "C1",
        user_name: "bob",
      });

      expect(res.result).toEqual({
        response_type: "ephemeral",
        text: NO_TYPED_TASKS,
      });
      expect(createTask).not.toHaveBeenCalled();
    },
  );
});
