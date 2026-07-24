// The archive in-flight bound (FR5.7): each archive pins the body + a redacted
// copy until GCS resolves, so the route sheds uploads beyond a small cap instead
// of stacking them — the unbounded form OOM-crash-looped the 512Mi Floor the
// first time LORE_AGENT_EVENTS_BUCKET was set (2026-07-24).
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { buildServer } from "../server.js";

const logLlmCall = vi.fn();
const insertBatch = vi.fn();

vi.mock("../../../kernel/queues.js", () => ({
  usage: () => ({ logLlmCall }),
  agentRunEvents: () => ({ insertBatch }),
}));

const saveResolvers: Array<() => void> = [];
const save = vi.fn(
  () => new Promise<void>((resolve) => saveResolvers.push(resolve)),
);

vi.mock("../../../kernel/archives.js", () => ({
  agentEventsArchive: () => ({ save }),
}));

const ORIG = process.env.LORE_AGENT_INTERNAL_TOKEN;

const RESULT_LINE = JSON.stringify({
  source: { task: "task-uuid-1", agent: "cr-1" },
  event: {
    type: "result",
    subtype: "success",
    usage: { input_tokens: 3 },
    total_cost_usd: 0.01,
  },
});

const post = () =>
  buildServer({ getJobStatus: () => ({}) }).inject({
    method: "POST",
    url: "/api/agent-events",
    headers: { authorization: "Bearer internal-secret" },
    payload: RESULT_LINE,
  });

const drainArchives = async () => {
  saveResolvers.splice(0).forEach((resolve) => resolve());
  await new Promise((r) => setImmediate(r));
};

beforeEach(() => {
  process.env.LORE_AGENT_INTERNAL_TOKEN = "internal-secret";
  logLlmCall.mockReset().mockResolvedValue(undefined);
  insertBatch.mockReset().mockResolvedValue([]);
  save.mockClear();
});

afterEach(async () => {
  await drainArchives();

  if (ORIG === undefined) {
    delete process.env.LORE_AGENT_INTERNAL_TOKEN;
  } else {
    process.env.LORE_AGENT_INTERNAL_TOKEN = ORIG;
  }
});

describe("POST /api/agent-events archive in-flight bound", () => {
  it("sheds the third archive while two uploads are in flight and still ingests cost", async () => {
    const first = await post();
    const second = await post();
    const third = await post();

    expect(save).toHaveBeenCalledTimes(2);
    // The shed request still succeeds and records its cost row.
    expect(third.statusCode).toBe(200);
    expect(third.result).toEqual({ status: "ok", events: 1, recorded: 1 });
    expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
    expect(logLlmCall).toHaveBeenCalledTimes(3);
  });

  it("frees the slot once an upload settles", async () => {
    await post();
    await post();
    await post();
    expect(save).toHaveBeenCalledTimes(2);

    await drainArchives();
    await post();

    expect(save).toHaveBeenCalledTimes(3);
  });
});
