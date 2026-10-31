import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FakeLlm } from "@re-cinq/lore-shared/llm/fake-llm.js";
import { buildServer } from "../../../app/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { setTicketEvalDepsForTests } from "./context-eval-ticket.js";

const originalEnv = { ...process.env };
const TICKET = { number: 4024, title: "Ticket evals", body: "Grade blocks." };

const post = (body: unknown, pool: unknown = makePool(), headers = AUTH) =>
  buildServer(() => pool as never).inject({
    method: "POST",
    url: "/api/context-evals/ticket",
    headers,
    payload: JSON.stringify(body),
  });

describe("POST /api/context-evals/ticket", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    setTicketEvalDepsForTests({
      llm: new FakeLlm({
        data: { score: 3, useful: ["run.mjs"], noise: "none" },
        usage: { model: "gemini-4-argon" },
      }),
      assemble: async (_repo, _query, backend) => ({
        text: `<${backend}/>`,
        sections: ["code"],
      }),
      clock: () => 0,
    });
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    setTicketEvalDepsForTests(undefined);
  });

  it("answers 200 with score 3 for a ticket graded on the lore backend", async () => {
    const res = await post({ repo: "re-cinq/lore", ticket: TICKET });

    expect({ status: res.statusCode, body: JSON.parse(res.payload) }).toEqual({
      status: 200,
      body: {
        score: 3,
        useful: ["run.mjs"],
        noise: "none",
        model: "gemini-4-argon",
        latency_ms: 0,
        chars: 7,
        sections: ["code"],
      },
    });
  });

  it("answers lore and utopia verdicts when the body names backend both", async () => {
    const res = await post({
      repo: "re-cinq/lore",
      ticket: TICKET,
      backend: "both",
    });

    expect(Object.keys(JSON.parse(res.payload))).toEqual(["lore", "utopia"]);
  });

  it("answers 403 to a token that holds only the read scope, since every call spends on a model", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [{ scopes: ["read"] }] });
    const res = await post({ repo: "re-cinq/lore", ticket: TICKET }, pool, {
      authorization: "Bearer read-only",
    });

    expect({ status: res.statusCode, body: JSON.parse(res.payload) }).toEqual({
      status: 403,
      body: { error: "insufficient scope" },
    });
  });

  it("answers 400 for a repo that is not owner/name", async () => {
    const res = await post({ repo: "lore", ticket: TICKET });

    expect(res.statusCode).toBe(400);
  });
});
