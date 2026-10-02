import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FakeLlm } from "@re-cinq/lore-shared/llm/fake-llm.js";
import { buildServer } from "../../../app/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { setEvalDepsForTests } from "./context-evals.js";

const originalEnv = { ...process.env };
const ADR = "adrs/ADR-032-split-local-remote-api.md";

const post = (body: unknown, pool: unknown = makePool()) =>
  buildServer(() => pool as never).inject({
    method: "POST",
    url: "/api/context-evals",
    headers: AUTH,
    payload: JSON.stringify(body),
  });

describe("POST /api/context-evals", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    setEvalDepsForTests({
      llm: new FakeLlm({
        text: "Can the MCP server query Postgres directly?",
        data: {
          answer: "No.",
          used_sources: [ADR],
          pass: true,
          reason: "Agrees with the decision.",
        },
        usage: { model: "gemini-2.5-flash" },
      }),
      document: async (_repo, path) =>
        path === ADR ? "The adapter holds no pool." : null,
      assemble: async () => ({
        text: "<context/>",
        sources: [
          { path: ADR, tokens: 300 },
          { path: "eslint.config.mjs", tokens: 100 },
        ],
      }),
    });
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    setEvalDepsForTests(undefined);
  });

  it("answers 200 with the document's verdict: found, answered and a useful share of 0.75", async () => {
    const res = await post({ repo: "re-cinq/lore", path: ADR });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({
      path: ADR,
      question: "Can the MCP server query Postgres directly?",
      found: true,
      answered: true,
      useful_share: 0.75,
      reason: "Agrees with the decision.",
      model: "gemini-2.5-flash",
    });
  });

  it("answers 404 naming the path for a document Lore does not hold", async () => {
    const res = await post({ repo: "re-cinq/lore", path: "adrs/missing.md" });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.payload)).toMatchObject({
      error: "no ADR or spec at adrs/missing.md in re-cinq/lore",
    });
  });

  it("answers 400 for a repo that is not owner/name", async () => {
    expect((await post({ repo: "lore", path: ADR })).statusCode).toBe(400);
  });

  it("answers 400 for a body with no path", async () => {
    expect((await post({ repo: "re-cinq/lore" })).statusCode).toBe(400);
  });

  it("answers 503 when there is no database", async () => {
    expect(
      (await post({ repo: "re-cinq/lore", path: ADR }, null)).statusCode,
    ).toBe(503);
  });
});
