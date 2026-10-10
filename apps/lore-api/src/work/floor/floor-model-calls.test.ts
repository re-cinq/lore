import { describe, expect, it } from "vitest";
import type { StationRunRecordView } from "@re-cinq/floor-client";
import { modelCallsOf } from "./floor-model-calls.js";

const record = (seq: number, body: unknown): StationRunRecordView => ({
  visitId: "visit-1",
  kind: "llm_call",
  seq,
  body,
  occurredAt: "2026-10-10T10:00:00.000Z",
});

describe("modelCallsOf", () => {
  it("reads a service's modelCall as one row with its model, tokens and cost", () => {
    const call = record(1, {
      model: "gemini-3.1-pro",
      costUsd: 0.02,
      usage: {
        input_tokens: 900,
        output_tokens: 120,
        cache_read_input_tokens: 100,
      },
    });

    expect(modelCallsOf([call])).toEqual([
      {
        seq: 1,
        occurredAt: "2026-10-10T10:00:00.000Z",
        model: "gemini-3.1-pro",
        costUsd: 0.02,
        tokensIn: 1000,
        tokensOut: 120,
      },
    ]);
  });

  it("reads an agent result naming two models as two rows, each with its own tokens and cost", () => {
    const result = record(2, {
      text: "done",
      costUsd: 0.5,
      models: {
        "claude-sonnet-5-5": {
          input_tokens: 2000,
          output_tokens: 300,
          cost_usd: 0.45,
        },
        "claude-haiku-4-5": {
          input_tokens: 500,
          output_tokens: 50,
          cost_usd: 0.05,
        },
      },
    });

    expect(
      modelCallsOf([result]).map((row) => [
        row.model,
        row.tokensIn,
        row.costUsd,
      ]),
    ).toEqual([
      ["claude-sonnet-5-5", 2000, 0.45],
      ["claude-haiku-4-5", 500, 0.05],
    ]);
  });

  it("reads a result naming no model as one row with the record's cost and a null model", () => {
    expect(modelCallsOf([record(3, { costUsd: 0.1 })])).toMatchObject([
      { model: null, costUsd: 0.1, tokensIn: null, tokensOut: null },
    ]);
  });

  it("answers no rows for no records", () => {
    expect(modelCallsOf([])).toEqual([]);
  });
});
