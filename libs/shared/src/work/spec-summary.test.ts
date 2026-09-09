import { describe, it, expect } from "vitest";
import {
  parseSpecTitle,
  extractSummary,
  reassembleSpec,
} from "./spec-summary.js";

describe("parseSpecTitle", () => {
  it("returns the first H1 stripped of the hash", () => {
    expect(
      parseSpecTitle(
        "# Local Task Runner\n\nbody",
        "specs/local-task-runner/spec.md",
      ),
    ).toBe("Local Task Runner");
  });

  it("strips a 'Feature Specification:' prefix from the H1", () => {
    expect(
      parseSpecTitle(
        "# Feature Specification: Spec → Test Coverage\n",
        "x/spec.md",
      ),
    ).toBe("Spec → Test Coverage");
  });

  it("falls back to the feature directory name when there is no H1", () => {
    expect(
      parseSpecTitle("no heading here", "specs/local-task-runner/spec.md"),
    ).toBe("local-task-runner");
  });

  it("falls back to the file path when there is no H1 and no feature dir", () => {
    expect(parseSpecTitle("plain text", "spec.md")).toBe("spec.md");
  });
});

describe("extractSummary", () => {
  it("returns the first non-heading, non-table paragraph", () => {
    const content =
      "# Title\n\n| a | b |\n|---|---|\n\nThe real summary paragraph.\n\nSecond.";

    expect(extractSummary(content)).toBe("The real summary paragraph.");
  });

  it("collapses internal whitespace and joins wrapped lines", () => {
    expect(extractSummary("# T\n\nLine one\nline two.")).toBe(
      "Line one line two.",
    );
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

  it("skips a leading blockquote note and returns the first prose paragraph", () => {
    const content =
      "# Title\n\n> **Note:** This spec was updated after shipping.\n> Several features were not exposed.\n\nThe real summary paragraph.";

    expect(extractSummary(content)).toBe("The real summary paragraph.");
  });
});

describe("reassembleSpec", () => {
  it("orders chunks with identical ingested_at by chunk_index", () => {
    const chunks = [
      { content: "part two", ingested_at: "2026-01-01", chunk_index: 1 },
      { content: "part one", ingested_at: "2026-01-01", chunk_index: 0 },
    ];

    expect(reassembleSpec(chunks)).toBe("part one\n\npart two");
  });

  it("orders by chunk_index over a contradicting ingested_at", () => {
    const chunks = [
      { content: "part two", ingested_at: "2026-01-01", chunk_index: 1 },
      { content: "part one", ingested_at: "2026-01-02", chunk_index: 0 },
    ];

    expect(reassembleSpec(chunks)).toBe("part one\n\npart two");
  });

  it("sorts chunks without chunk_index last, among themselves by ingested_at", () => {
    const chunks = [
      { content: "legacy two", ingested_at: "2026-01-04" },
      { content: "indexed", ingested_at: "2026-01-05", chunk_index: 0 },
      { content: "legacy one", ingested_at: "2026-01-03", chunk_index: null },
    ];

    expect(reassembleSpec(chunks)).toBe("indexed\n\nlegacy one\n\nlegacy two");
  });

  it("joins chunks without any chunk_index in ingest order", () => {
    const chunks = [
      { content: "part two", ingested_at: "2026-01-02" },
      { content: "part one", ingested_at: "2026-01-01" },
    ];

    expect(reassembleSpec(chunks)).toBe("part one\n\npart two");
  });

  it("deduplicates identical chunk contents", () => {
    const chunks = [
      { content: "same", ingested_at: "2026-01-01", chunk_index: 0 },
      { content: "same", ingested_at: "2026-01-02", chunk_index: 1 },
    ];

    expect(reassembleSpec(chunks)).toBe("same");
  });
});
