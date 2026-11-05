import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FakeLlm } from "@re-cinq/lore-shared/llm/fake-llm.js";
import { buildServer } from "../../../app/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { setExplainDepsForTests } from "./explain-code.js";
import { NO_LINKS_ANSWER } from "../../../work/explain/explain-code.js";

const originalEnv = { ...process.env };
const SELECTION = {
  path: "src/widget.ts",
  start_line: 10,
  end_line: 12,
  code: "export function spin() {\n  return 42;\n}",
};

const post = (body: unknown) =>
  buildServer(() => makePool() as never).inject({
    method: "POST",
    url: "/api/repos/re-cinq/lore/explain",
    headers: AUTH,
    payload: JSON.stringify(body),
  });

describe("POST /api/repos/:owner/:repo/explain", () => {
  useRateLimitSafeClock();
  let llm: FakeLlm;

  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    llm = new FakeLlm({
      text: "It spins the widget.",
      usage: { model: "gemini-3-flash" },
    });
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    setExplainDepsForTests(undefined);
  });

  it("answers the model's explanation with the statements that link the lines", async () => {
    setExplainDepsForTests({
      llm,
      statementsAt: async () => [{ text: "The widget spins.", via: "covered" }],
    });

    const res = await post(SELECTION);

    expect({ status: res.statusCode, body: JSON.parse(res.payload) }).toEqual({
      status: 200,
      body: {
        answer: "It spins the widget.",
        statements: [{ text: "The widget spins.", via: "covered" }],
        model: "gemini-3-flash",
      },
    });
  });

  it("answers I don't know without calling the model when no statement links the lines", async () => {
    setExplainDepsForTests({ llm, statementsAt: async () => [] });

    const res = await post(SELECTION);

    expect({
      body: JSON.parse(res.payload),
      modelCalls: llm.calls.length,
    }).toEqual({
      body: { answer: NO_LINKS_ANSWER, statements: [], model: null },
      modelCalls: 0,
    });
  });

  it("asks the model with the statements, the path and the code", async () => {
    setExplainDepsForTests({
      llm,
      statementsAt: async () => [{ text: "The widget spins.", via: "covered" }],
    });

    await post(SELECTION);

    expect(llm.calls[0]?.prompt).toMatch(
      /src\/widget\.ts lines 10-12[\s\S]*The widget spins\.[\s\S]*return 42;/,
    );
  });

  it("reads the statements for the selected span of the repo's file", async () => {
    const spans: unknown[] = [];

    setExplainDepsForTests({
      llm,
      statementsAt: async (span) => {
        spans.push(span);

        return [];
      },
    });

    await post(SELECTION);

    expect(spans).toEqual([
      { file: "src/widget.ts", startLine: 10, endLine: 12 },
    ]);
  });

  it("answers 400 when the end line is before the start line", async () => {
    setExplainDepsForTests({ llm, statementsAt: async () => [] });

    const res = await post({ ...SELECTION, start_line: 12, end_line: 10 });

    expect(res.statusCode).toBe(400);
  });
});
