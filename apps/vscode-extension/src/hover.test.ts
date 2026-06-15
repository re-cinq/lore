import { describe, it, expect } from "vitest";
import { renderHoverMarkdown } from "./hover.js";
import { openLocalCommandUri } from "./command-links.js";
import type { RangeEntry } from "./spec-index.js";

const implemented: RangeEntry = {
  startLine: 42,
  endLine: 42,
  layer: "implemented",
  evidence: "human-linked",
  statementText: "The runner claims a pending task before GKE picks it up.",
  specPath: "specs/auth/spec.md",
  specLine: 6,
  related: [{ label: "validated by runner.test.ts", path: "mcp-server/src/local-runner.test.ts", line: 88 }],
};

describe("renderHoverMarkdown", () => {
  it("shows the statement text for an implemented line", () => {
    expect(renderHoverMarkdown(implemented)).toContain(
      "The runner claims a pending task before GKE picks it up.",
    );
  });

  it("links to the local spec at the statement line", () => {
    expect(renderHoverMarkdown(implemented)).toContain(
      openLocalCommandUri({ path: "specs/auth/spec.md", line: 6 }),
    );
  });

  it("links to each related artifact at its line", () => {
    expect(renderHoverMarkdown(implemented)).toContain(
      openLocalCommandUri({ path: "mcp-server/src/local-runner.test.ts", line: 88 }),
    );
  });

  it("labels a covered line with its execution-verified evidence", () => {
    const covered: RangeEntry = { ...implemented, layer: "covered", evidence: "execution-verified", related: [] };
    expect(renderHoverMarkdown(covered)).toContain("execution-verified");
  });

  it("opens the spec at line 1 when the statement line is unknown", () => {
    const noLine: RangeEntry = { ...implemented, specLine: 0, related: [] };
    expect(renderHoverMarkdown(noLine)).toContain(
      openLocalCommandUri({ path: "specs/auth/spec.md", line: 1 }),
    );
  });
});
