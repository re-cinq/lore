import { describe, it, expect } from "vitest";
import {
  formatTrailers,
  formatValidatesTrailer,
  parseTrailers,
  parseValidatesTrailers,
  type ProvenanceRef,
} from "./commit-trailers.js";

describe("formatTrailers", () => {
  it("formats minimal trailer block", () => {
    const out = formatTrailers({
      stage: "implement",
      iteration: 1,
      taskId: "abc-123",
    });
    expect(out).toBe(
      "Lore-Stage: implement\nLore-Iteration: 1\nLore-Task: abc-123",
    );
  });

  it("appends extras after required keys", () => {
    const out = formatTrailers({
      stage: "validate",
      iteration: 2,
      taskId: "abc-123",
      extras: {
        "Lore-Outcome": "success",
        "Lore-Cost-Tokens": "input=100 output=50",
      },
    });
    const lines = out.split("\n");
    expect(lines[0]).toBe("Lore-Stage: validate");
    expect(lines[1]).toBe("Lore-Iteration: 2");
    expect(lines[2]).toBe("Lore-Task: abc-123");
    expect(lines).toContain("Lore-Outcome: success");
    expect(lines).toContain("Lore-Cost-Tokens: input=100 output=50");
  });
});

describe("parseTrailers", () => {
  it("round-trips a minimal trailer block", () => {
    const original = { stage: "implement", iteration: 1, taskId: "abc-123" };
    const parsed = parseTrailers(formatTrailers(original));
    expect(parsed).toEqual(original);
  });

  it("round-trips with extras", () => {
    const original = {
      stage: "review",
      iteration: 3,
      taskId: "u",
      extras: { "Lore-Outcome": "success" },
    };
    expect(parseTrailers(formatTrailers(original))).toEqual(original);
  });

  it("parses trailer block at end of multi-paragraph commit", () => {
    const msg = `[stage:implement] iter=1

Implements the X feature.

This change touches files A, B, C.

Lore-Stage: implement
Lore-Iteration: 1
Lore-Task: abc-123`;
    expect(parseTrailers(msg)).toEqual({
      stage: "implement",
      iteration: 1,
      taskId: "abc-123",
    });
  });

  it("returns null when no trailers present", () => {
    expect(parseTrailers("Just a commit message.")).toBeNull();
  });

  it("returns null when required key is missing", () => {
    expect(parseTrailers("Lore-Stage: implement\nLore-Iteration: 1")).toBeNull();
  });

  it("returns null when iteration is not a number", () => {
    expect(
      parseTrailers(
        "Lore-Stage: implement\nLore-Iteration: abc\nLore-Task: x",
      ),
    ).toBeNull();
  });

  it("returns null when last paragraph mixes trailer and non-trailer lines", () => {
    const msg =
      "Lore-Stage: implement\nthis is not a trailer\nLore-Iteration: 1\nLore-Task: x";
    expect(parseTrailers(msg)).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(parseTrailers("")).toBeNull();
    expect(parseTrailers("\n\n  \n")).toBeNull();
  });

  it("preserves arbitrary extras", () => {
    const parsed = parseTrailers(
      "Lore-Stage: implement\nLore-Iteration: 1\nLore-Task: x\nLore-Outcome: success\nLore-Cost-Tokens: 100",
    );
    expect(parsed?.extras).toEqual({
      "Lore-Outcome": "success",
      "Lore-Cost-Tokens": "100",
    });
  });

  it("handles CRLF line endings", () => {
    const msg =
      "Subject\r\n\r\nLore-Stage: a\r\nLore-Iteration: 1\r\nLore-Task: x";
    expect(parseTrailers(msg)).toEqual({
      stage: "a",
      iteration: 1,
      taskId: "x",
    });
  });

  it("strips trailing whitespace before parsing", () => {
    const msg = "Lore-Stage: a\nLore-Iteration: 1\nLore-Task: x\n\n   \n";
    expect(parseTrailers(msg)).toEqual({
      stage: "a",
      iteration: 1,
      taskId: "x",
    });
  });

  it("omits extras when only required keys are present", () => {
    const parsed = parseTrailers(
      "Lore-Stage: a\nLore-Iteration: 1\nLore-Task: x",
    );
    expect(parsed).toEqual({ stage: "a", iteration: 1, taskId: "x" });
    expect(parsed).not.toHaveProperty("extras");
  });
});

describe("parseValidatesTrailers", () => {
  it("returns one ref with numeric ordinal for a single Lore-Validates line", () => {
    const message = `feat: add widget

Body text.

Lore-Validates: specs/foo/spec.md#7 -> test/x.test.ts`;
    const expected: ProvenanceRef[] = [
      { specPath: "specs/foo/spec.md", ordinal: 7, target: "test/x.test.ts" },
    ];
    expect(parseValidatesTrailers(message)).toEqual(expected);
  });
});

describe("formatValidatesTrailer", () => {
  it("renders specs/foo/spec.md#7 -> test/x.test.ts and round-trips through parseValidatesTrailers", () => {
    const ref: ProvenanceRef = {
      specPath: "specs/foo/spec.md",
      ordinal: 7,
      target: "test/x.test.ts",
    };
    expect(formatValidatesTrailer(ref)).toBe(
      "Lore-Validates: specs/foo/spec.md#7 -> test/x.test.ts",
    );
    expect(parseValidatesTrailers(formatValidatesTrailer(ref))).toEqual([ref]);
  });
});
