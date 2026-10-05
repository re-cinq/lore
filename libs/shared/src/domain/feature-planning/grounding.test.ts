import { describe, expect, it } from "vitest";
import { groundingFindings } from "./grounding.js";

const TREE = [
  "apps/stations/src/events/repo-handlers.ts",
  "libs/shared/src/work/backlog/label-dispatch.ts",
  "libs/shared/src/work/backlog/queue-ticket.ts",
];

const LABEL_DISPATCH = `export async function dispatchLabeledIssue(deps, labeled) {
  const working = await deps.activeTaskByIssue(repo, issue.number);
  await queueTicket(deps, { repo, issue });
}`;

describe("groundingFindings", () => {
  it("reports a backticked path missing from the tree", () => {
    const findings = groundingFindings({
      text: "- **FR7**: wired in `apps/stations/src/events/repo-handler.ts`.",
      tree: TREE,
      files: {},
    });

    expect(findings).toEqual([
      {
        name: "apps/stations/src/events/repo-handler.ts",
        kind: "path",
        line: 1,
      },
    ]);
  });

  it("returns nothing when every path is on main, with a line anchor or as a folder", () => {
    const findings = groundingFindings({
      text: "Handled in `apps/stations/src/events/repo-handlers.ts:38` and `libs/shared/src/work/backlog/`.",
      tree: TREE,
      files: {},
    });

    expect(findings).toEqual([]);
  });

  it("accepts a missing path the same line says it adds", () => {
    const findings = groundingFindings({
      text: "Add `libs/assembly-lines/src/floor-pipelines/issue-triage.yaml` with a `done` exit node.",
      tree: TREE,
      files: {},
    });

    expect(findings).toEqual([]);
  });

  it("reports the line number of a path on a later line", () => {
    const findings = groundingFindings({
      text: "# Spec\n\nSee `apps/floor-x/main.ts`.",
      tree: TREE,
      files: {},
    });

    expect(findings).toEqual([
      { name: "apps/floor-x/main.ts", kind: "path", line: 3 },
    ]);
  });

  it("reports an identifier absent from the file the same line names, hinting the closest one", () => {
    const findings = groundingFindings({
      text: "Before the `alreadyWorkingOnIssue` guard in `libs/shared/src/work/backlog/label-dispatch.ts`.",
      tree: TREE,
      files: {
        "libs/shared/src/work/backlog/label-dispatch.ts": LABEL_DISPATCH,
      },
    });

    expect(findings).toEqual([
      {
        name: "alreadyWorkingOnIssue",
        kind: "identifier",
        line: 1,
        hint: "activeTaskByIssue",
      },
    ]);
  });

  it("accepts an identifier found in the file the same line names", () => {
    const findings = groundingFindings({
      text: "It calls `queueTicket` (`libs/shared/src/work/backlog/label-dispatch.ts`).",
      tree: TREE,
      files: {
        "libs/shared/src/work/backlog/label-dispatch.ts": LABEL_DISPATCH,
      },
    });

    expect(findings).toEqual([]);
  });

  it("leaves an identifier unchecked when the line names no file", () => {
    const findings = groundingFindings({
      text: "Report success via `reportToParkedNode`.",
      tree: TREE,
      files: {},
    });

    expect(findings).toEqual([]);
  });

  it("reports a retired component even when the path is still named", () => {
    const findings = groundingFindings({
      text: "In `issuesLabeled` (`apps/floor/src/events/handlers/github.ts`), owned by the Event Router.",
      tree: TREE,
      files: {},
    });

    expect(findings).toMatchObject([
      { name: "apps/floor", kind: "retired", line: 1 },
      { name: "Event Router", kind: "retired", line: 1 },
    ]);
  });

  it("reports a repeated missing name once per line", () => {
    const findings = groundingFindings({
      text: "`apps/x/a.ts` then `apps/x/a.ts` again.",
      tree: TREE,
      files: {},
    });

    expect(findings).toEqual([{ name: "apps/x/a.ts", kind: "path", line: 1 }]);
  });
});
