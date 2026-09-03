import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { buildServer } from "../server.js";

const logLlmCall = vi.fn();
const insertBatch = vi.fn();
const insertTurns = vi.fn();
const write = vi.fn();

vi.mock("../../../kernel/queues.js", () => ({
  clusterAgent: () => ({}),
  usage: () => ({ logLlmCall }),
  agentRunEvents: () => ({ insertBatch }),
  agentRunTurns: () => ({ insertBatch: insertTurns }),
  auditLog: () => ({ write }),
}));

const save = vi.fn(() => Promise.resolve());
const gcsConstructed = vi.fn();

vi.mock("@re-cinq/lore-shared/project/archive/archive-gcs.js", () => ({
  GcsArchive: class {
    save = save;
    read = vi.fn(() => Promise.resolve(null));
    constructor(bucket: string) {
      gcsConstructed(bucket);
    }
  },
}));

const ORIG_TOKEN = process.env.LORE_AGENT_INTERNAL_TOKEN;

const RESULT_LINE = JSON.stringify({
  source: { task: "task-uuid-1", agent: "cr-1" },
  event: {
    type: "result",
    subtype: "success",
    usage: { input_tokens: 3 },
    total_cost_usd: 0.01,
  },
});

const post = (payload: string) =>
  buildServer({ getJobStatus: () => ({}) }).inject({
    method: "POST",
    url: "/api/agent-events",
    headers: { authorization: "Bearer internal-secret" },
    payload,
  });

beforeEach(() => {
  process.env.LORE_AGENT_INTERNAL_TOKEN = "internal-secret";
  logLlmCall.mockReset().mockResolvedValue({ correlated: true });
  insertBatch.mockReset().mockResolvedValue([]);
  insertTurns.mockReset().mockResolvedValue([{ id: "1" }]);
  write.mockReset().mockResolvedValue(undefined);
  save.mockClear();
  gcsConstructed.mockClear();
});

afterEach(() => {
  if (ORIG_TOKEN === undefined) {
    delete process.env.LORE_AGENT_INTERNAL_TOKEN;

    return;
  }
  process.env.LORE_AGENT_INTERNAL_TOKEN = ORIG_TOKEN;
});

describe("POST /api/agent-events object-storage retirement (#1148: agent_run_turns now holds the full redacted stream, so cost/projection/turns are the only durable outputs)", () => {
  it("ingests a batch without instantiating or writing through the GcsArchive adapter, catching a regression that re-adds it", async () => {
    const res = await post(RESULT_LINE);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toMatchObject({ recorded: 1 });
    expect(gcsConstructed).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});
