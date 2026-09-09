import { describe, it, expect } from "vitest";
import { mapCiTests } from "./ci-tests-map.js";

describe("mapCiTests", () => {
  it("maps a test-report body to one internal.ingest.spec_trace event with kind test-report", () => {
    const result = mapCiTests({
      repo: "re-cinq/lore",
      commit: "abc123",
      branch: "main",
      tests: [{ id: "t1" }],
      results: [{ id: "t1", passed: true }],
    });

    expect(result).toEqual({
      ok: true,
      events: [
        {
          eventName: "internal.ingest.spec_trace",
          source: "internal",
          params: {
            repo: "re-cinq/lore",
            kind: "test-report",
            payload: {
              commit: "abc123",
              branch: "main",
              tests: [{ id: "t1" }],
              results: [{ id: "t1", passed: true }],
            },
          },
        },
      ],
    });
  });

  it("rejects a missing repo with a 400", () => {
    expect(mapCiTests({ commit: "abc" })).toEqual({
      ok: false,
      status: 400,
      error: "missing repo",
    });
  });

  it("rejects a missing commit with a 400", () => {
    expect(mapCiTests({ repo: "o/r" })).toEqual({
      ok: false,
      status: 400,
      error: "missing commit",
    });
  });
});
