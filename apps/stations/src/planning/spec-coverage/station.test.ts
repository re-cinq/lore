import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import { specCoverageHandle } from "./station.js";
import type { CoverageDeps, RunVisit } from "../coverage-deps.js";

const PLAN_URL = "https://lore.example/repos/re-cinq/lore/plans/p1";
const SPEC_PATH = "specs/checkout/spec.md";
const CITABLE = {
  plan_url: PLAN_URL,
  blocks: [
    {
      id: "b-why",
      slot: "intent",
      kind: "paragraph",
      text: "Members pay in their currency.",
      link: `${PLAN_URL}#b-why`,
    },
    {
      id: "k-1",
      slot: "kpis",
      kind: "kpi",
      text: "Checkout drop-off under 5%",
      link: `${PLAN_URL}#k-1`,
    },
  ],
};
const CITES_BOTH = [
  "## Requirements",
  "",
  `- FR-001: Members pay in their currency. ([from plan](${PLAN_URL}#b-why))`,
  `- SC-001: Drop-off stays under 5%. ([from plan](${PLAN_URL}#k-1))`,
].join("\n");
const CITES_ONE = CITES_BOTH.split("\n").slice(0, 3).join("\n");
const HANDLER_PATH = "libs/shared/src/work/backlog/label-dispatch.ts";
const HANDLER =
  "const working = await deps.activeTaskByIssue(repo, issue.number);";
const NAMES_A_GONE_GUARD = [
  CITES_BOTH,
  `- FR-002: Checked before the \`alreadyWorkingOnIssue\` guard in \`${HANDLER_PATH}\`. ([from plan](${PLAN_URL}#b-why))`,
].join("\n");

const NEEDS = {
  target: "https://github.com/re-cinq/lore@lore/feature-planning/p1",
  spec_plan: "blob://spec-plan",
  plan_blocks: "blob://plan-blocks",
};

const handback = (): RunVisit => ({
  nodeId: "spec-coverage",
  report: { outcome: "changes_requested" },
});

const PLAN_PATH = "specs/checkout/plan.md";
const PLAN_ADDS_TICK =
  "Files touched:\n- `apps/stations/src/work/issue-triage-tick/` — the sweep";
const NAMES_THE_TICK = [
  CITES_BOTH,
  `- FR-003: A sweep under \`apps/stations/src/work/issue-triage-tick/\` picks the oldest. ([from plan](${PLAN_URL}#b-why))`,
].join("\n");

function scene(spec: string, visits: RunVisit[] = [], plan?: string) {
  const produced: Record<string, string> = {};
  const reads: string[] = [];
  const files: Record<string, string> = {
    spec_plan: JSON.stringify({
      creates: [{ path: SPEC_PATH }, ...(plan ? [{ path: PLAN_PATH }] : [])],
    }),
    plan_blocks: JSON.stringify(CITABLE),
  };
  const tools: Tools = {
    read: async (need) => Buffer.from(files[need] ?? ""),
    produce: async (name, bytes) => {
      produced[name] = bytes.toString();
    },
    modelCall: async () => {},
    signal: new AbortController().signal,
  };
  const deps: CoverageDeps = {
    readSpec: async (repo, path, ref) => {
      reads.push(`${repo}:${path}@${ref}`);

      const onBranch: Record<string, string> = {
        [SPEC_PATH]: spec,
        [HANDLER_PATH]: HANDLER,
        ...(plan ? { [PLAN_PATH]: plan } : {}),
      };

      return onBranch[path] ?? null;
    },
    listTree: async () => [SPEC_PATH, HANDLER_PATH],
    visitsOf: async () => [
      ...visits,
      { nodeId: "spec-coverage", report: null },
    ],
  };

  return { handle: specCoverageHandle(deps), tools, produced, reads };
}

function brief(needs: Record<string, string> = NEEDS) {
  return { visitId: "visit-coverage", iteration: 1, needs };
}

describe("specCoverageHandle", () => {
  it("reports success with 2 of 2 cited when the spec on the branch cites every plan block", async () => {
    const { handle, tools, produced, reads } = scene(CITES_BOTH);

    const report = await handle(brief(), tools);

    expect({ report, produced, reads }).toEqual({
      report: { outcome: "success" },
      produced: {
        plan_coverage:
          "## Plan coverage\n\n2 of 2 plan blocks are cited by a spec statement.\n",
      },
      reads: [`re-cinq/lore:${SPEC_PATH}@lore/feature-planning/p1`],
    });
  });

  it("sends the writer back with the uncited KPI when no coverage round was spent yet", async () => {
    const { handle, tools, produced } = scene(CITES_ONE);

    const report = await handle(brief(), tools);

    expect({
      report,
      namesKpi: produced.plan_coverage?.includes(`cite ${PLAN_URL}#k-1`),
    }).toEqual({ report: { outcome: "changes_requested" }, namesKpi: true });
  });

  it("reports success with the gap listed once three coverage rounds were spent", async () => {
    const { handle, tools, produced } = scene(CITES_ONE, [
      handback(),
      handback(),
      handback(),
    ]);

    const report = await handle(brief(), tools);

    expect({
      report,
      namesKpi: produced.plan_coverage?.includes(`cite ${PLAN_URL}#k-1`),
    }).toEqual({ report: { outcome: "success" }, namesKpi: true });
  });

  it("sends the writer back naming alreadyWorkingOnIssue, absent from the file its statement names, with activeTaskByIssue as the hint", async () => {
    const { handle, tools, produced } = scene(NAMES_A_GONE_GUARD);

    const report = await handle(brief(), tools);

    expect({
      report,
      namesGuard: produced.plan_coverage?.includes(
        "`alreadyWorkingOnIssue` (line 5) is not in the files the line names; closest: `activeTaskByIssue`",
      ),
    }).toEqual({ report: { outcome: "changes_requested" }, namesGuard: true });
  });

  it("reports success when the spec names a folder its plan.md's files-touched list adds", async () => {
    const { handle, tools } = scene(NAMES_THE_TICK, [], PLAN_ADDS_TICK);

    const report = await handle(brief(), tools);

    expect(report).toEqual({ outcome: "success" });
  });

  it("reports success and produces nothing when the run carries no citable blocks", async () => {
    const { handle, tools, produced } = scene(CITES_ONE);
    const { plan_blocks: _none, ...withoutBlocks } = NEEDS;

    const report = await handle(brief(withoutBlocks), tools);

    expect({ report, produced }).toEqual({
      report: { outcome: "success" },
      produced: {},
    });
  });
});
