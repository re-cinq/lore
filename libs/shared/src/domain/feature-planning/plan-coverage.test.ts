import { describe, expect, it } from "vitest";
import {
  citablePlan,
  coverageBrief,
  coverageRoundsSpent,
  planCoverage,
} from "./plan-coverage.js";

const PLAN_URL = "https://lore.example/repos/re-cinq/lore/plans/p1";

const VIEW = {
  sections: [
    {
      slot: "intent",
      blocks: [
        {
          id: "b-why",
          type: "paragraph",
          text: "Members pay in their currency.",
        },
        { id: "b-head", type: "heading", text: "Why now" },
        { id: "b-blank", type: "paragraph", text: "  " },
      ],
    },
    {
      slot: "kpis",
      blocks: [{ id: "k-1", type: "kpi", text: "Checkout drop-off under 5%" }],
    },
    {
      slot: "prototype",
      blocks: [{ id: "p-1", type: "prototype", text: "Figma board" }],
    },
    {
      slot: "questions",
      blocks: [
        { id: "q-1", type: "question", text: "Which currencies first?" },
        { id: "a-1", type: "answer", text: "EUR and DKK." },
      ],
    },
  ],
};

describe("citablePlan", () => {
  it("lists the prose, KPI and question blocks with text outside the prototype, each with its link", () => {
    expect(citablePlan(VIEW, PLAN_URL)).toEqual({
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
        {
          id: "q-1",
          slot: "questions",
          kind: "question",
          text: "Which currencies first?",
          link: `${PLAN_URL}#q-1`,
        },
      ],
    });
  });
});

describe("planCoverage", () => {
  const { blocks } = citablePlan(VIEW, PLAN_URL);
  const OTHER_PLAN = "https://lore.example/repos/re-cinq/lore/plans/p0";

  it("misses the blocks linked only by another plan or outside a statement's trailing link group", () => {
    const spec = [
      "## Requirements",
      "",
      `- FR-001: Members pay in their currency. ([from plan](${PLAN_URL}#b-why), [validated by pays in EUR](src/pay.test.ts#L4))`,
      `- SC-001: Drop-off stays under 5%. ([from plan](${OTHER_PLAN}#k-1))`,
      `- FR-002: EUR comes first ([from plan](${PLAN_URL}#q-1)) and DKK after.`,
    ].join("\n");

    expect(planCoverage(blocks, [spec])).toEqual({
      total: 3,
      cited: 1,
      missing: [blocks[1], blocks[2]],
    });
  });
});

describe("coverageBrief", () => {
  const { blocks } = citablePlan(VIEW, PLAN_URL);

  it("names each block no statement cites, with its section, text and the link to cite", () => {
    expect(coverageBrief({ total: 3, cited: 2, missing: [blocks[1]] })).toBe(
      [
        "## Plan coverage",
        "",
        "2 of 3 plan blocks are cited by a spec statement. Not cited yet:",
        "",
        `- kpis (kpi): Checkout drop-off under 5% — cite ${PLAN_URL}#k-1`,
        "",
      ].join("\n"),
    );
  });

  it("keeps a block whose text spans two lines on one list line", () => {
    const twoLines = {
      ...blocks[0],
      text: "Members pay\n  in their currency.",
    };

    expect(
      coverageBrief({ total: 1, cited: 0, missing: [twoLines] }).split("\n")[4],
    ).toBe(
      `- intent (paragraph): Members pay in their currency. — cite ${PLAN_URL}#b-why`,
    );
  });

  it("says every block is cited when none is missing", () => {
    expect(coverageBrief({ total: 3, cited: 3, missing: [] })).toBe(
      "## Plan coverage\n\n3 of 3 plan blocks are cited by a spec statement.\n",
    );
  });
});

describe("coverageRoundsSpent", () => {
  const visit = (nodeId: string, outcome: string | null = "success") => ({
    nodeId,
    report: outcome === null ? null : { outcome },
  });

  it("counts the coverage handbacks since the author last acted, not the ones before", () => {
    const visits = [
      visit("spec-coverage", "changes_requested"),
      visit("write"),
      visit("spec-coverage", "changes_requested"),
      visit("merged", "changes_requested"),
      visit("author"),
      visit("analyse-specs"),
      visit("write"),
      visit("spec-coverage", "changes_requested"),
      visit("write"),
      visit("spec-coverage", null),
    ];

    expect(coverageRoundsSpent(visits)).toBe(1);
  });
});
