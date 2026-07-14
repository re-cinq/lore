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

  it("falls back to the parent directory when the path has no specs segment", () => {
    expect(parseSpecTitle("body only", "docs/onboarding/guide.md")).toBe(
      "onboarding",
    );
  });

  it("uses the specs segment when it is the parent directory", () => {
    expect(parseSpecTitle("body only", "specs/spec.md")).toBe("specs");
  });

  it("falls back to the raw path when there is no parent directory", () => {
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

  it("skips fenced code and bullet-list blocks before the prose paragraph", () => {
    const content =
      "```ts\nconst x = 1;\n```\n\n- a bullet item\n\nThe prose after the fences.";

    expect(extractSummary(content)).toBe("The prose after the fences.");
  });

  it("skips whitespace-only blocks between paragraphs", () => {
    const content = "# Title\n\n   \n\nThe first real paragraph.";

    expect(extractSummary(content)).toBe("The first real paragraph.");
  });

  it("returns an empty string when the content is all headings", () => {
    expect(extractSummary("# One\n\n## Two\n\n### Three")).toBe("");
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
