import { describe, expect, it } from "vitest";
import { declaredNewPaths, groundingFindings } from "./grounding.js";

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

  it("accepts a path the requirements define and the files-touched list names, as a new file of the feature", () => {
    const findings = groundingFindings({
      text: [
        "- **FR1**: The line MUST be defined as a floor pipeline at `libs/assembly-lines/src/floor-pipelines/issue-triage.yaml`.",
        "",
        "## Project Structure",
        "",
        "- `apps/stations/src/work/close-issue/` — `close_issue` service station",
      ].join("\n"),
      tree: TREE,
      files: {},
    });

    expect(findings).toEqual([]);
  });

  it("leaves LORE_NODE_RESULT unchecked on a line that names a recipe file the feature adds", () => {
    const findings = groundingFindings({
      text: "Ship `libs/shared/src/agent-defaults/triage-verify.md`, each emitting `LORE_NODE_RESULT`; checked by `libs/shared/src/work/backlog/label-dispatch.ts`.",
      tree: TREE,
      files: {
        "libs/shared/src/work/backlog/label-dispatch.ts": LABEL_DISPATCH,
      },
    });

    expect(findings).toEqual([]);
  });

  it("leaves an identifier unchecked on a line that says the feature adds it to the file it names", () => {
    const findings = groundingFindings({
      text: "Add `OIDC_CLIENT_ID` to `libs/shared/src/work/backlog/label-dispatch.ts`.",
      tree: TREE,
      files: {
        "libs/shared/src/work/backlog/label-dispatch.ts": LABEL_DISPATCH,
      },
    });

    expect(findings).toEqual([]);
  });

  it("reports a bare repository path a plan quote names without backticks", () => {
    const findings = groundingFindings({
      text: "> outcomes: EdgeCondition and PRODUCIBLE_OUTCOMES in libs/assembly-lines/src/assembly-line-schema.ts.",
      tree: TREE,
      files: {},
    });

    expect(findings).toEqual([
      {
        name: "libs/assembly-lines/src/assembly-line-schema.ts",
        kind: "path",
        line: 1,
      },
    ]);
  });

  it("reports pipeline.station_runs named as where the line's outcomes are read from", () => {
    const findings = groundingFindings({
      text: "Computed from the `outcome` of each issue-triage row in `pipeline.station_runs`.",
      tree: TREE,
      files: {},
    });

    expect(findings).toMatchObject([
      { name: "pipeline.station_runs", kind: "retired", line: 1 },
    ]);
  });

  it("accepts a test file inside the folder the text says it implements", () => {
    const findings = groundingFindings({
      text: [
        "Implement the triage_label station in `apps/stations/src/work/triage-label/`.",
        "`apps/stations/src/work/triage-label/triage-label.test.ts` asserts each outcome's label.",
      ].join("\n"),
      tree: TREE,
      files: {},
    });

    expect(findings).toEqual([]);
  });

  it("reports apps/floor as retired when a plan quote names it without backticks", () => {
    const findings = groundingFindings({
      text: "> map it to this line (assemblyLineFor in apps/floor/src/work/task/dispatch-agent-cr.ts)",
      tree: TREE,
      files: {},
    });

    expect(findings).toMatchObject([
      { name: "apps/floor", kind: "retired", line: 1 },
    ]);
  });

  it("accepts a test file beside a file the text creates in a folder main does not have", () => {
    const findings = groundingFindings({
      text: [
        "Create `apps/stations/src/work/triage-label/index.ts` applying the label.",
        "- [ ] apps/stations/src/work/triage-label/triage-label.test.ts passes.",
      ].join("\n"),
      tree: TREE,
      files: {},
    });

    expect(findings).toEqual([]);
  });

  it("still reports a missing sibling of a file the text adds to a folder main has", () => {
    const findings = groundingFindings({
      text: [
        "Add `libs/shared/src/work/backlog/issue-triage.ts`.",
        "It replaces `libs/shared/src/work/backlog/label-dispatcher.ts`.",
      ].join("\n"),
      tree: TREE,
      files: {},
    });

    expect(findings).toEqual([
      {
        name: "libs/shared/src/work/backlog/label-dispatcher.ts",
        kind: "path",
        line: 2,
      },
    ]);
  });

  it("accepts a folder spec.md names that plan.md's files-touched list adds", () => {
    const plan =
      "Files touched:\n- `apps/stations/src/work/issue-triage-tick/` — cron sweep";

    const findings = groundingFindings({
      text: "- **FR9**: a sweep under `apps/stations/src/work/issue-triage-tick/` picks the oldest issues.",
      tree: TREE,
      files: {},
      added: declaredNewPaths(plan),
    });

    expect(findings).toEqual([]);
  });
});
