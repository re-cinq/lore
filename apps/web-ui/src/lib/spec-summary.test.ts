import { describe, it, expect } from "vitest";
import { parseSpecTitle, extractSummary, reassembleSpec } from "./spec-summary";

describe("parseSpecTitle", () => {
  it("returns the first H1 without a Feature Specification prefix", () => {
    expect(
      parseSpecTitle(
        "# Feature Specification: Spec → Test Coverage\n",
        "x/spec.md",
      ),
    ).toBe("Spec → Test Coverage");
  });

  it("falls back to the feature directory when no H1 exists", () => {
    expect(parseSpecTitle("body only", "specs/local-task-runner/spec.md")).toBe(
      "local-task-runner",
    );
  });

  it("uses the parent directory when the path has no specs segment", () => {
    expect(parseSpecTitle("body only", "docs/onboarding/guide.md")).toBe(
      "onboarding",
    );
  });

  it("returns the raw path for a single-segment path with no H1", () => {
    expect(parseSpecTitle("body only", "spec.md")).toBe("spec.md");
  });
});

describe("extractSummary", () => {
  it("returns the first prose paragraph, skipping headings and tables", () => {
    const content = "# Title\n\n| a | b |\n|---|---|\n\nThe summary paragraph.";

    expect(extractSummary(content)).toBe("The summary paragraph.");
  });

  it("truncates with an ellipsis past the limit", () => {
    expect(extractSummary("# T\n\n" + "x".repeat(400), 280).endsWith("…")).toBe(
      true,
    );
  });

  it("skips a leading blockquote note and returns the first prose paragraph", () => {
    const content =
      "# Title\n\n> **Note:** This spec was updated after shipping.\n> Several features were not exposed.\n\nThe real summary paragraph.";

    expect(extractSummary(content)).toBe("The real summary paragraph.");
  });

  it("skips a leading whitespace-only block and returns the following prose", () => {
    expect(extractSummary("   \n\n# H\n\nActual prose.")).toBe("Actual prose.");
  });

  it("returns an empty string when the content is only headings, tables, and lists", () => {
    expect(extractSummary("# Title\n\n| a |\n|---|\n\n- item\n- item")).toBe(
      "",
    );
  });
});

describe("reassembleSpec", () => {
  it("orders chunks by ingest time and dedupes identical content", () => {
    expect(
      reassembleSpec([
        { content: "b", ingested_at: "2026-01-02" },
        { content: "a", ingested_at: "2026-01-01" },
        { content: "a", ingested_at: "2026-01-03" },
      ]),
    ).toBe("a\n\nb");
  });
});
