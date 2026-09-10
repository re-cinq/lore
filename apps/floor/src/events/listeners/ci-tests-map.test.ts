import { describe, it, expect } from "vitest";
import { mapCiTests } from "./ci-tests-map.js";

describe("mapCiTests", () => {
  it("maps a test-report body to one internal.ingest.spec_trace event with kind test-report", () => {
    const result = mapCiTests(
      {
        repo: "re-cinq/lore",
        commit: "abc123",
        branch: "main",
        tests: [{ id: "t1" }],
        results: [{ id: "t1", passed: true }],
      },
      "main",
    );

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
    expect(mapCiTests({ commit: "abc" }, "main")).toEqual({
      ok: false,
      status: 400,
      error: "missing repo",
    });
  });

  it("rejects a missing commit with a 400", () => {
    expect(mapCiTests({ repo: "o/r" }, "main")).toEqual({
      ok: false,
      status: 400,
      error: "missing commit",
    });
  });

  it("names feat/x as the overlay branch when the report is for feat/x and the default branch is main", () => {
    const mapped = mapCiTests(
      { repo: "o/r", commit: "abc", branch: "feat/x" },
      "main",
    );

    expect(mapped).toMatchObject({
      ok: true,
      events: [
        {
          params: {
            repo: "o/r",
            kind: "test-report",
            payload: { overlayBranch: "feat/x", branch: "feat/x" },
          },
        },
      ],
    });
  });
});
