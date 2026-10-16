import { describe, it, expect } from "vitest";
import {
  onlyAnsweredBy,
  sideBySide,
  sourceOverlap,
  type BackendVerdict,
} from "./side-by-side.js";

const ADR = "adrs/ADR-032-split-local-remote-api.md";
const QUESTION = "Can the MCP server query Postgres directly?";

const ANSWERED: BackendVerdict = {
  found: true,
  answered: true,
  useful_share: 0.5,
  reason: "Agrees with the decision.",
  model: "gemini-2.5-flash",
  latency_ms: 10,
};
const UNANSWERED: BackendVerdict = { ...ANSWERED, answered: false };

describe("sideBySide", () => {
  it("names utopia as the only store that answered when Lore's assembly did not", () => {
    expect(
      sideBySide(
        { path: ADR, question: QUESTION },
        { verdict: UNANSWERED, sources: [{ path: ADR, tokens: 1 }] },
        { verdict: ANSWERED, sources: [{ path: ADR, tokens: 1 }] },
      ),
    ).toEqual({
      path: ADR,
      question: QUESTION,
      lore: UNANSWERED,
      utopia: ANSWERED,
      top_k_overlap: 1,
      only_answered_by: "utopia",
    });
  });
});

describe("sourceOverlap", () => {
  it("returns 0.33 when two assemblies share 1 of 3 distinct paths", () => {
    expect(
      sourceOverlap(
        [
          { path: "a.md", tokens: 1 },
          { path: "b.md", tokens: 1 },
        ],
        [
          { path: "b.md", tokens: 5 },
          { path: "c.md", tokens: 5 },
        ],
      ),
    ).toEqual(0.33);
  });

  it("returns 0 when both assemblies are empty", () => {
    expect(sourceOverlap([], [])).toEqual(0);
  });
});

describe("onlyAnsweredBy", () => {
  it("returns lore, utopia, null and null for the four answered pairs", () => {
    expect([
      onlyAnsweredBy(ANSWERED, UNANSWERED),
      onlyAnsweredBy(UNANSWERED, ANSWERED),
      onlyAnsweredBy(ANSWERED, ANSWERED),
      onlyAnsweredBy(UNANSWERED, UNANSWERED),
    ]).toEqual(["lore", "utopia", null, null]);
  });
});
