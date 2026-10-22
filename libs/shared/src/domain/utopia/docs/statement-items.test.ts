import { describe, it, expect } from "vitest";
import { statementItems } from "./doc-statements.js";

const SPEC = [
  "## Chain",
  "",
  "- FR1 — Every document is pushed.",
  "- FR2 — Settings decide.",
  "",
  "## Chain",
  "",
  "A second section with the same heading.",
  "",
].join("\n");

describe("statementItems", () => {
  it("returns one stmt item per statement, dated at the commit time, and no doc item", () => {
    const pushed = statementItems({
      repo: "re-cinq/lore",
      path: "specs/mirror/spec.md",
      content: SPEC,
      commit: "0123456789abcdef0123456789abcdef01234567",
      commitTime: "2026-10-15T10:00:00Z",
      kind: "spec",
    });

    expect(
      pushed.map(({ externalId, doc_time }) => [externalId, doc_time]),
    ).toEqual([
      ["stmt:specs/mirror/spec.md#0000", "2026-10-15T10:00:00Z"],
      ["stmt:specs/mirror/spec.md#0001", "2026-10-15T10:00:00Z"],
      ["stmt:specs/mirror/spec.md#0002", "2026-10-15T10:00:00Z"],
    ]);
  });
});
