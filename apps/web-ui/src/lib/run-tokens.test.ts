import { describe, it, expect } from "vitest";
import { sumTurnUsage, formatTokens, type TurnUsageRow } from "./run-tokens";

const turn = (over: Partial<TurnUsageRow> = {}): TurnUsageRow => ({
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_tokens: 0,
  cache_read_tokens: 0,
  ...over,
});

describe("sumTurnUsage", () => {
  it("returns null when the run has reported no usage at all", () => {
    expect(sumTurnUsage([])).toEqual(null);
  });

  it("adds every turn's prompt and completion", () => {
    expect(
      sumTurnUsage([
        turn({ input_tokens: 100, output_tokens: 20 }),
        turn({ input_tokens: 300, output_tokens: 40 }),
      ]),
    ).toEqual({ input: 400, output: 60, total: 460 });
  });

  it("counts cache creation and cache reads as prompt tokens, because they are billed", () => {
    expect(
      sumTurnUsage([
        turn({
          input_tokens: 10,
          cache_creation_tokens: 4000,
          cache_read_tokens: 60000,
          output_tokens: 5,
        }),
      ]),
    ).toEqual({ input: 64010, output: 5, total: 64015 });
  });

  it("treats a turn that reported no usage as zero rather than dropping the run", () => {
    expect(sumTurnUsage([turn(), turn({ output_tokens: 7 })])).toEqual({
      input: 0,
      output: 7,
      total: 7,
    });
  });
});

describe("formatTokens", () => {
  it("writes a small count in full", () => {
    expect(formatTokens(940)).toEqual("940");
  });

  it("writes thousands with one decimal", () => {
    expect(formatTokens(64015)).toEqual("64.0k");
  });

  it("writes millions with one decimal", () => {
    expect(formatTokens(1250000)).toEqual("1.3M");
  });

  it("writes zero as zero", () => {
    expect(formatTokens(0)).toEqual("0");
  });
});
