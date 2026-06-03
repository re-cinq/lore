import { describe, it, expect } from "vitest";
import { parseSpecTitle, extractSummary, reassembleSpec } from "./spec-summary.js";

describe("parseSpecTitle", () => {
  it("returns the first H1 stripped of the hash", () => {
    expect(parseSpecTitle("# Local Task Runner\n\nbody", "specs/local-task-runner/spec.md")).toBe(
      "Local Task Runner",
    );
  });

  it("strips a 'Feature Specification:' prefix from the H1", () => {
    expect(parseSpecTitle("# Feature Specification: Spec → Test Coverage\n", "x/spec.md")).toBe(
      "Spec → Test Coverage",
    );
  });

  it("falls back to the feature directory name when there is no H1", () => {
    expect(parseSpecTitle("no heading here", "specs/local-task-runner/spec.md")).toBe(
      "local-task-runner",
    );
  });

  it("falls back to the file path when there is no H1 and no feature dir", () => {
    expect(parseSpecTitle("plain text", "spec.md")).toBe("spec.md");
  });
});

describe("extractSummary", () => {
  it("returns the first non-heading, non-table paragraph", () => {
    const content = "# Title\n\n| a | b |\n|---|---|\n\nThe real summary paragraph.\n\nSecond.";
    expect(extractSummary(content)).toBe("The real summary paragraph.");
  });

  it("collapses internal whitespace and joins wrapped lines", () => {
    expect(extractSummary("# T\n\nLine one\nline two.")).toBe("Line one line two.");
  });

  it("truncates to the max length with an ellipsis", () => {
    const long = "# T\n\n" + "x".repeat(400);
    const summary = extractSummary(long, 280);
    expect(summary.length).toBeLessThanOrEqual(281);
    expect(summary.endsWith("…")).toBe(true);
  });

  it("returns an empty string when there is no paragraph", () => {
    expect(extractSummary("# Only A Heading")).toBe("");
  });
});

describe("reassembleSpec", () => {
  it("joins chunk contents in order", () => {
    const chunks = [
      { content: "part two", ingested_at: "2026-01-02" },
      { content: "part one", ingested_at: "2026-01-01" },
    ];
    expect(reassembleSpec(chunks)).toBe("part one\n\npart two");
  });

  it("deduplicates identical chunk contents", () => {
    const chunks = [
      { content: "same", ingested_at: "2026-01-01" },
      { content: "same", ingested_at: "2026-01-02" },
    ];
    expect(reassembleSpec(chunks)).toBe("same");
  });
});
