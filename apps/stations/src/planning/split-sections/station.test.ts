import { describe, expect, it } from "vitest";
import { visitBag } from "../visit-bag.fixtures.js";
import type { RunVisit } from "../coverage-deps.js";
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

const AFTER_DRAFT: RunVisit[] = [
  { nodeId: "draft", report: { outcome: "success" } },
  { nodeId: "split-sections", report: null },
];

function sceneOf(files: Record<string, unknown>, visits: RunVisit[] = []) {
  const text = (value: unknown) =>
    typeof value === "string" ? value : JSON.stringify(value);
  const bag = visitBag(
    {},
    Object.fromEntries(
      Object.entries(files).map(([name, value]) => [name, text(value)]),
    ),
  );

  const handle = splitSectionsHandle({ visitsOf: async () => visits });

  return { ...bag, handle, brief: bag.given(BRIEF) };
}

const withBlocks = (
  files: Record<string, unknown> = {},
  visits: RunVisit[] = [],
) => sceneOf({ plan_blocks: CITABLE, ...files }, visits);

const BRIEF = { visitId: "visit-split", iteration: 1, needs: {} };

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
    const { tools, produced, brief, handle } = withBlocks();

    const report = await handle(brief, tools);

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
    const { tools, brief, handle } = withBlocks();

    const [scope] = entriesOf(await handle(brief, tools));

    expect(JSON.parse(scope!)).toEqual({
      slot: "scope",
      text: `## scope\n\nTechnical additions: required.\n\n- Billing is out. ([plan](${PLAN_URL}#b1))\n`,
    });
  });

  it("lists only the sections not yet done when a section had to be tried again", async () => {
    const { tools, brief, handle } = withBlocks({
      section_state: {
        ...EMPTY_STATE,
        done: ["risk"],
        attempts: { scope: 1 },
      },
    });

    const report = await handle(brief, tools);

    expect(slotsOf(report)).toEqual(["scope"]);
  });

  it("lists only the sections the gate sent back, and remembers its round", async () => {
    const { tools, produced, brief, handle } = withBlocks({
      section_state: { ...EMPTY_STATE, done: ["scope", "risk"] },
      redo_sections: { round: 1, sections: ["risk"] },
    });

    const report = await handle(brief, tools);

    expect({
      slots: slotsOf(report),
      round: stateOf(produced).redoRound,
    }).toEqual({
      slots: ["risk"],
      round: 1,
    });
  });

  it("lists nothing when every section is settled", async () => {
    const { tools, brief, handle } = withBlocks({
      section_state: { ...EMPTY_STATE, done: ["scope", "risk"] },
    });

    const report = await handle(brief, tools);

    expect(report).toEqual({
      outcome: "success",
      produced: { sections: "[]" },
    });
  });

  it("lists nothing when the deployment hands the run no plan blocks", async () => {
    const { tools, brief, handle } = sceneOf({});

    const report = await handle(brief, tools);

    expect(report).toEqual({
      outcome: "success",
      produced: { sections: "[]" },
    });
  });

  it("lists every section again after a new draft, though the run remembers them all failed", async () => {
    const { tools, produced, brief, handle } = withBlocks(
      {
        section_state: {
          ...EMPTY_STATE,
          failed: ["scope", "risk"],
          redoRound: 2,
        },
      },
      AFTER_DRAFT,
    );

    const report = await handle(brief, tools);

    expect({
      slots: slotsOf(report),
      failed: stateOf(produced).failed,
    }).toEqual({ slots: ["scope", "risk"], failed: [] });
  });

  it("takes no redo request the gate left from before a new draft", async () => {
    const { tools, produced, brief, handle } = withBlocks(
      {
        section_state: { ...EMPTY_STATE, done: ["scope", "risk"] },
        redo_sections: { round: 3, sections: ["risk"] },
      },
      AFTER_DRAFT,
    );

    const report = await handle(brief, tools);

    expect({
      slots: slotsOf(report),
      round: stateOf(produced).redoRound,
    }).toEqual({ slots: ["scope", "risk"], round: 3 });
  });
});
