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

const NEEDS = {
  target: "github.com/re-cinq/lore@lore/feature-planning/p1",
  spec_plan: "blob://spec-plan",
  plan_blocks: "blob://plan-blocks",
};

const handback = (): RunVisit => ({
  nodeId: "spec-coverage",
  report: { outcome: "changes_requested" },
});

function scene(spec: string, visits: RunVisit[] = []) {
  const produced: Record<string, string> = {};
  const reads: string[] = [];
  const files: Record<string, string> = {
    spec_plan: JSON.stringify({ creates: [{ path: SPEC_PATH }] }),
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

      return path === SPEC_PATH ? spec : null;
    },
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
