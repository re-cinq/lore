// The GCS archive retirement (#1148): with pipeline.agent_run_turns holding the
// full redacted stream (specs/turn-level-transcript-store), the sink's durable
// outputs are exactly the three Postgres row families — cost, projection, turns
// — and it writes no object-storage copy. A separate file from
// agent-events.test.ts for the same reason agent-events-turns.test.ts is: that
// file carries #L anchors from other specs, and widening its module mock in
// place would shift every anchor below it.

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { buildServer } from "../server.js";

const logLlmCall = vi.fn();
const insertBatch = vi.fn();
const insertTurns = vi.fn();
const write = vi.fn();

vi.mock("../../../kernel/queues.js", () => ({
  usage: () => ({ logLlmCall }),
  agentRunEvents: () => ({ insertBatch }),
  agentRunTurns: () => ({ insertBatch: insertTurns }),
  auditLog: () => ({ write }),
}));

// Spies on the ONE GCS adapter in the codebase, so the guard catches a
// re-added kernel/archives singleton call and a direct `new GcsArchive(...)`
// alike. Today nothing in the route's import graph touches it, so the mock
// never even instantiates — it arms the moment a regression pulls it back in.
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
  process.env.LORE_AGENT_INTERNAL_TOKEN = ORIG_TOKEN ?? "";
});

describe("POST /api/agent-events object-storage retirement", () => {
  it("ingests a batch without writing any object-storage copy", async () => {
    const res = await post(RESULT_LINE);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toMatchObject({ recorded: 1 });
    expect(gcsConstructed).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});
