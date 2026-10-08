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
  handed: [],
  done: [],
  failed: [],
  attempts: {},
  redo: [],
  redoRound: 0,
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

const entriesOf = (report: { produced?: Record<string, string> }): string[] =>
  JSON.parse(report.produced?.sections ?? "[]") as string[];

const slotsOf = (report: { produced?: Record<string, string> }): string[] =>
  entriesOf(report).map(
    (entry) => (JSON.parse(entry) as { slot: string }).slot,
  );

const stateOf = (produced: Record<string, string>) =>
  JSON.parse(produced.section_state ?? "null");

describe("splitSectionsHandle", () => {
  it("lists every section with blocks as one entry each, in line order, and remembers what it handed out", async () => {
    const { tools, produced } = withBlocks();

    const report = await splitSectionsHandle()(brief, tools);

    expect({
      outcome: report.outcome,
      slots: slotsOf(report),
      handed: stateOf(produced).handed,
    }).toEqual({
      outcome: "success",
      slots: ["scope", "risk"],
      handed: ["scope", "risk"],
    });
  });

  it("gives each entry the section's text with the technical rule", async () => {
    const { tools } = withBlocks();

    const [scope] = entriesOf(await splitSectionsHandle()(brief, tools));

    expect(JSON.parse(scope!)).toEqual({
      slot: "scope",
      text: `## scope\n\nTechnical additions: required.\n\n- Billing is out. ([plan](${PLAN_URL}#b1))\n`,
    });
  });

  it("lists only the sections not yet done when a section had to be tried again", async () => {
    const { tools } = withBlocks({
      section_state: {
        ...EMPTY_STATE,
        done: ["risk"],
        attempts: { scope: 1 },
      },
    });

    const report = await splitSectionsHandle()(brief, tools);

    expect(slotsOf(report)).toEqual(["scope"]);
  });

  it("lists only the sections the gate sent back, and remembers its round", async () => {
    const { tools, produced } = withBlocks({
      section_state: { ...EMPTY_STATE, done: ["scope", "risk"] },
      redo_sections: { round: 1, sections: ["risk"] },
    });

    const report = await splitSectionsHandle()(brief, tools);

    expect({
      slots: slotsOf(report),
      round: stateOf(produced).redoRound,
    }).toEqual({
      slots: ["risk"],
      round: 1,
    });
  });

  it("lists nothing when every section is settled", async () => {
    const { tools } = withBlocks({
      section_state: { ...EMPTY_STATE, done: ["scope", "risk"] },
    });

    const report = await splitSectionsHandle()(brief, tools);

    expect(report).toEqual({
      outcome: "success",
      produced: { sections: "[]" },
    });
  });

  it("lists nothing when the deployment hands the run no plan blocks", async () => {
    const { tools } = sceneOf({});

    const report = await splitSectionsHandle()(brief, tools);

    expect(report).toEqual({
      outcome: "success",
      produced: { sections: "[]" },
    });
  });
});
