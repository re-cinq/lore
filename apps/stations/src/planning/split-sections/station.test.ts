import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import { splitSectionsHandle } from "./station.js";

const PLAN_URL = "https://lore.example/plans/p1";
const CITABLE = {
  plan_url: PLAN_URL,
  blocks: [
    {
      id: "b1",
      slot: "scope",
      kind: "paragraph",
      text: "Billing is out.",
      link: `${PLAN_URL}#b1`,
    },
    {
      id: "b2",
      slot: "risk",
      kind: "paragraph",
      text: "Rates may lag.",
      link: `${PLAN_URL}#b2`,
    },
  ],
};
const EMPTY_STATE = {
  handed: null,
  done: [],
  failed: [],
  attempts: {},
  redo: [],
  redoRound: 0,
};
const INTEGRATED_SCOPE = {
  section: "scope",
  status: "integrated",
  technical_additions: [
    { claim: "Refunds use lore.refunds.", source: "db/0001.sql#L4" },
  ],
};

function sceneOf(files: Record<string, unknown>) {
  const produced: Record<string, string> = {};
  const text = (value: unknown) =>
    typeof value === "string" ? value : JSON.stringify(value);
  const tools: Tools = {
    read: async (need) => Buffer.from(need in files ? text(files[need]) : ""),
    produce: async (name, bytes) => {
      produced[name] = bytes.toString();
    },
    modelCall: async () => {},
    signal: new AbortController().signal,
  };

  return { tools, produced };
}

const withBlocks = (files: Record<string, unknown> = {}) =>
  sceneOf({ plan_blocks: CITABLE, ...files });

const brief = {
  visitId: "visit-split",
  iteration: 1,
  needs: { plan_blocks: "blob://plan-blocks" },
};

const stateOf = (produced: Record<string, string>) =>
  JSON.parse(produced.section_state ?? "null");

describe("splitSectionsHandle", () => {
  it("reports more and hands over the scope section on the first visit", async () => {
    const { tools, produced } = withBlocks();

    const report = await splitSectionsHandle()(brief, tools);

    expect({
      report,
      section: produced.current_section,
      state: stateOf(produced),
    }).toEqual({
      report: { outcome: "more" },
      section: `## scope\n\nTechnical additions: required.\n\n- Billing is out. ([plan](${PLAN_URL}#b1))\n`,
      state: { ...EMPTY_STATE, handed: "scope" },
    });
  });

  it("clears section_result on every visit, so a pod that writes none is not read as the last one's", async () => {
    const { tools, produced } = withBlocks();

    await splitSectionsHandle()(brief, tools);

    expect(produced.section_result).toBe("");
  });

  it("settles the returned result and hands the risk section next", async () => {
    const { tools, produced } = withBlocks({
      section_state: { ...EMPTY_STATE, handed: "scope" },
      section_result: INTEGRATED_SCOPE,
    });

    const report = await splitSectionsHandle()(brief, tools);

    expect({ report, state: stateOf(produced) }).toEqual({
      report: { outcome: "more" },
      state: { ...EMPTY_STATE, done: ["scope"], handed: "risk" },
    });
  });

  it("hands the same section again when the pod returned no result", async () => {
    const { tools, produced } = withBlocks({
      section_state: { ...EMPTY_STATE, handed: "scope" },
    });

    const report = await splitSectionsHandle()(brief, tools);

    expect({ report, state: stateOf(produced) }).toEqual({
      report: { outcome: "more" },
      state: { ...EMPTY_STATE, handed: "scope", attempts: { scope: 1 } },
    });
  });

  it("reports done once every section is settled", async () => {
    const { tools, produced } = withBlocks({
      section_state: { ...EMPTY_STATE, handed: "risk", done: ["scope"] },
      section_result: { section: "risk", status: "nothing_relevant" },
    });

    const report = await splitSectionsHandle()(brief, tools);

    expect({ report, state: stateOf(produced) }).toEqual({
      report: { outcome: "done" },
      state: { ...EMPTY_STATE, done: ["scope", "risk"] },
    });
  });

  it("reports redo with the section the gate sent back", async () => {
    const { tools, produced } = withBlocks({
      section_state: { ...EMPTY_STATE, done: ["scope", "risk"] },
      redo_sections: { round: 1, sections: ["scope"] },
    });

    const report = await splitSectionsHandle()(brief, tools);

    expect({
      report,
      section: produced.current_section?.startsWith("## scope"),
      state: stateOf(produced),
    }).toEqual({
      report: { outcome: "redo" },
      section: true,
      state: {
        ...EMPTY_STATE,
        done: ["scope", "risk"],
        redo: ["scope"],
        redoRound: 1,
        handed: "scope",
      },
    });
  });

  it("reports done and produces nothing when the deployment hands the run no plan blocks", async () => {
    const { tools, produced } = sceneOf({});

    const report = await splitSectionsHandle()(brief, tools);

    expect({ report, produced }).toEqual({
      report: { outcome: "done" },
      produced: {},
    });
  });
});
