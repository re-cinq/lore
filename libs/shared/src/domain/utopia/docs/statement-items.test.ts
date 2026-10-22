import { describe, it, expect } from "vitest";
import { docStatementItems, statementItems } from "./doc-statements.js";

const SPEC = [
  "# Feature Specification: Mirror",
  "",
  "| Field  | Value |",
  "| ------ | ----- |",
  "| Status | Draft |",
  "",
  "## Chain",
  "",
  "- FR1 — Every document is pushed. ([validated by pushes the doc item](libs/shared/src/work/utopia/mirror-document.test.ts#L12), [validated by counts created](../../libs/shared/src/work/utopia/mirror-document.test.ts#L30), [impl](libs/shared/src/work/utopia/mirror-document.ts))",
  "- FR2 — Settings decide. ([see ADR](adrs/ADR-052-code-to-spec-graph-mirrored-in-utopia.md))",
  "",
  "## Chain",
  "",
  "A second section with the same heading.",
  "",
].join("\n");

const COMMIT = "0123456789abcdef0123456789abcdef01234567";

describe("statementItems", () => {
  it("returns the stmt items of docStatementItems at the commit time and no doc item", () => {
    const input = {
      repo: "re-cinq/lore",
      path: "specs/mirror/spec.md",
      content: SPEC,
      commit: COMMIT,
      commitTime: "2026-10-15T10:00:00Z",
      kind: "spec" as const,
    };

    expect({
      only: statementItems(input),
      ids: statementItems(input).map((pushed) => pushed.externalId),
    }).toEqual({
      only: docStatementItems(input).filter((pushed) =>
        pushed.externalId.startsWith("stmt:"),
      ),
      ids: [
        "stmt:specs/mirror/spec.md#0000",
        "stmt:specs/mirror/spec.md#0001",
        "stmt:specs/mirror/spec.md#0002",
      ],
    });
  });
});
