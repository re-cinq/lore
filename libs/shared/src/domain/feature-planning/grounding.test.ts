import { describe, expect, it } from "vitest";
import {
  declaredNewPaths,
  groundingFindings,
  implementationEvidenceLink,
} from "./grounding.js";

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

describe("groundingFindings on a ticket's files", () => {
  const TESTED_TREE = [
    ...TREE,
    "apps/lore-api/src/work/repo/repo-validation-cli.test.ts",
    "deploy/chart/charts/ui-helm/templates/migrate-job.yaml",
  ];

  it("reports deploy/chart/templates/upgrade-check-job.yaml when a ticket starts from it without backticks", () => {
    const findings = groundingFindings({
      text: "Change the chart files needed; start from deploy/chart/templates/upgrade-check-job.yaml.",
      tree: TESTED_TREE,
      files: {},
    });

    expect(findings).toEqual([
      {
        name: "deploy/chart/templates/upgrade-check-job.yaml",
        kind: "path",
        line: 1,
      },
    ]);
  });

  it("reports a test the ticket adds under deploy/chart/templates, where no folder above it holds a test", () => {
    const findings = groundingFindings({
      text: "Add or extend tests next to the changed code (and `deploy/chart/templates/upgrade-check-job.test.ts`).",
      tree: TESTED_TREE,
      files: {},
    });

    expect(findings).toEqual([
      {
        name: "deploy/chart/templates/upgrade-check-job.test.ts",
        kind: "test-folder",
        line: 1,
      },
    ]);
  });

  it("accepts a test the ticket adds under apps/lore-api, a package that already holds tests", () => {
    const findings = groundingFindings({
      text: "Adds `apps/lore-api/src/work/upgrade-check/upgrade-check.test.ts` beside the check.",
      tree: TESTED_TREE,
      files: {},
    });

    expect(findings).toEqual([]);
  });

  it("reports no test-folder finding for a test under deploy/chart/templates when the tree holds no tests at all", () => {
    const findings = groundingFindings({
      text: "Adds `deploy/chart/templates/upgrade-check-job.test.ts`.",
      tree: TREE,
      files: {},
    });

    expect(findings).toEqual([]);
  });

  it("reports tools/vitest/missing-helper.ts when a ticket names it without backticks", () => {
    const findings = groundingFindings({
      text: "Reuse the helper in tools/vitest/missing-helper.ts.",
      tree: TESTED_TREE,
      files: {},
    });

    expect(findings).toEqual([
      { name: "tools/vitest/missing-helper.ts", kind: "path", line: 1 },
    ]);
  });

  it("reports a test the ticket adds under apps/new-pkg, a package with no tests, though apps holds tests elsewhere", () => {
    const findings = groundingFindings({
      text: "Adds `apps/new-pkg/src/x.test.ts`.",
      tree: TESTED_TREE,
      files: {},
    });

    expect(findings).toEqual([
      { name: "apps/new-pkg/src/x.test.ts", kind: "test-folder", line: 1 },
    ]);
  });

  it("reports no test-folder finding for a test under deploy/chart/templates that is already on main", () => {
    const findings = groundingFindings({
      text: "Extend `deploy/chart/templates/upgrade-check-job.test.ts`.",
      tree: [
        ...TESTED_TREE,
        "deploy/chart/templates/upgrade-check-job.test.ts",
      ],
      files: {},
    });

    expect(findings).toEqual([]);
  });
});

describe("implementationEvidenceLink", () => {
  it("links lines 3 to 9 of src/a.ts at commit abc123 on https://ghe.example.com", () => {
    expect(
      implementationEvidenceLink(
        "o/r",
        "abc123",
        { path: "src/a.ts", start: 3, end: 9, text: "x" },
        "ghe.example.com",
      ),
    ).toBe("https://ghe.example.com/o/r/blob/abc123/src/a.ts#L3-L9");
  });
});
