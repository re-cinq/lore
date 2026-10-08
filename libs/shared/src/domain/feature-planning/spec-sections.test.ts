import { describe, expect, it } from "vitest";
import type { CitablePlan } from "./plan-coverage.js";
import {
  INTEGRATED_SLOTS,
  MAX_SECTION_ATTEMPTS,
  TECHNICAL_SLOTS,
  absorbRedo,
  emptySectionState,
  nextStep,
  sectionResultSchema,
  settle,
  type SectionResult,
  type SectionState,
} from "./spec-sections.js";

const block = (id: string, slot: string, text: string) => ({
  id,
  slot,
  kind: "paragraph",
  text,
  link: `https://lore.example/plans/p1#${id}`,
});

const PLAN: CitablePlan = {
  plan_url: "https://lore.example/plans/p1",
  blocks: [
    block("b1", "intent", "Pay in your currency."),
    block("b2", "risk", "Rates may lag."),
    block("b3", "scope", "Billing is out."),
    block("b4", "scope", "Refunds are in."),
  ],
};

const state = (patch: Partial<SectionState> = {}): SectionState => ({
  ...emptySectionState(),
  ...patch,
});

const result = (patch: Partial<SectionResult> = {}): SectionResult => ({
  section: "scope",
  status: "integrated",
  technical_additions: [
    { claim: "Refunds use lore.refunds.", source: "db/0001.sql#L4" },
  ],
  ...patch,
});

describe("sectionResultSchema", () => {
  it("accepts a result with technical additions and defaults them to none", () => {
    expect(
      sectionResultSchema.parse({
        section: "risk",
        status: "nothing_relevant",
      }),
    ).toEqual({
      section: "risk",
      status: "nothing_relevant",
      technical_additions: [],
    });
  });

  it("rejects a status that is not one of the three", () => {
    expect(() =>
      sectionResultSchema.parse({ section: "risk", status: "done" }),
    ).toThrow();
  });
});

describe("nextStep", () => {
  it("hands the first section in line order as more, leaving intent to the draft", () => {
    expect(nextStep(PLAN, state())).toEqual({
      outcome: "more",
      text: "## scope\n\nTechnical additions: required.\n\n- Billing is out. ([plan](https://lore.example/plans/p1#b3))\n- Refunds are in. ([plan](https://lore.example/plans/p1#b4))\n",
      state: state({ handed: "scope" }),
    });
  });

  it("tells a section outside the technical slots to add no filler", () => {
    expect(nextStep(PLAN, state({ done: ["scope"] })).text).toBe(
      "## risk\n\nTechnical additions: none; add no filler.\n\n- Rates may lag. ([plan](https://lore.example/plans/p1#b2))\n",
    );
  });

  it("re-hands the section still handed out, as a retry", () => {
    expect(
      nextStep(PLAN, state({ handed: "scope", attempts: { scope: 1 } })),
    ).toMatchObject({
      outcome: "more",
      state: { handed: "scope", attempts: { scope: 1 } },
    });
  });

  it("returns done once every section with blocks is done or failed", () => {
    expect(
      nextStep(PLAN, state({ done: ["scope"], failed: ["risk"] })),
    ).toEqual({
      outcome: "done",
      text: "",
      state: state({ done: ["scope"], failed: ["risk"] }),
    });
  });

  it("returns done for a plan that has only an intent", () => {
    expect(
      nextStep({ ...PLAN, blocks: [PLAN.blocks[0]!] }, state()).outcome,
    ).toBe("done");
  });

  it("hands a section to redo as redo, once the first pass is over", () => {
    expect(
      nextStep(PLAN, state({ done: ["scope", "risk"], redo: ["risk"] })),
    ).toMatchObject({
      outcome: "redo",
      state: { handed: "risk", redo: ["risk"] },
    });
  });

  it("hands the repair visit, with no plan section, for gaps no question maps to", () => {
    expect(
      nextStep(PLAN, state({ done: ["scope", "risk"], redo: ["*"] })),
    ).toMatchObject({
      outcome: "redo",
      text: "## repair\n\nFix what plan-coverage.md and qa-failures.md list; no plan section is attached to this visit.\n",
    });
  });

  it("orders sections by line order, not by block order", () => {
    expect(INTEGRATED_SLOTS.indexOf("scope")).toBeLessThan(
      INTEGRATED_SLOTS.indexOf("risk"),
    );
  });

  it("requires technical additions for scope, constraints and delivery only", () => {
    expect(TECHNICAL_SLOTS).toEqual(["scope", "constraints", "delivery"]);
  });
});

describe("settle", () => {
  it("marks the handed section done when the pod integrated it with technical additions", () => {
    expect(settle(state({ handed: "scope" }), result())).toEqual(
      state({ done: ["scope"] }),
    );
  });

  it("marks a non-technical section done on integrated with no additions", () => {
    expect(
      settle(
        state({ handed: "risk" }),
        result({ section: "risk", technical_additions: [] }),
      ),
    ).toEqual(state({ done: ["risk"] }));
  });

  it("marks a technical section done when the pod says nothing in it was relevant", () => {
    expect(
      settle(
        state({ handed: "scope" }),
        result({ status: "nothing_relevant", technical_additions: [] }),
      ),
    ).toEqual(state({ done: ["scope"] }));
  });

  it("accepts a redone technical section that adds no new technical fact", () => {
    expect(
      settle(
        state({ handed: "scope", done: ["scope"], redo: ["scope"] }),
        result({ technical_additions: [] }),
      ),
    ).toEqual(state({ done: ["scope"] }));
  });

  it("retries a technical section integrated with no additions", () => {
    expect(
      settle(state({ handed: "scope" }), result({ technical_additions: [] })),
    ).toEqual(state({ handed: "scope", attempts: { scope: 1 } }));
  });

  it("retries on a missing result", () => {
    expect(settle(state({ handed: "scope" }), null)).toEqual(
      state({ handed: "scope", attempts: { scope: 1 } }),
    );
  });

  it("retries on a result for another section", () => {
    expect(
      settle(state({ handed: "scope" }), result({ section: "risk" })),
    ).toEqual(state({ handed: "scope", attempts: { scope: 1 } }));
  });

  it("records the section as failed after the attempts are spent", () => {
    expect(
      settle(
        state({
          handed: "scope",
          attempts: { scope: MAX_SECTION_ATTEMPTS - 1 },
        }),
        result({ status: "failed" }),
      ),
    ).toEqual(state({ failed: ["scope"], attempts: {} }));
  });

  it("takes a redone section out of the redo list", () => {
    expect(
      settle(
        state({ handed: "scope", done: ["scope"], redo: ["scope", "risk"] }),
        result(),
      ),
    ).toEqual(state({ done: ["scope"], redo: ["risk"] }));
  });

  it("leaves the state alone when nothing is handed out", () => {
    expect(settle(state({ done: ["scope"] }), result())).toEqual(
      state({ done: ["scope"] }),
    );
  });
});

describe("absorbRedo", () => {
  it("queues the sections of a newer round for redo and clears their failed mark", () => {
    expect(
      absorbRedo(
        state({ done: ["scope"], failed: ["risk"], attempts: { risk: 1 } }),
        { round: 1, sections: ["risk", "scope"] },
      ),
    ).toEqual(
      state({
        done: ["scope", "risk"],
        redo: ["risk", "scope"],
        redoRound: 1,
        attempts: {},
      }),
    );
  });

  it("ignores a round it has already taken", () => {
    const taken = state({ redo: ["risk"], redoRound: 2 });

    expect(absorbRedo(taken, { round: 2, sections: ["scope"] })).toEqual(taken);
  });

  it("ignores a missing request", () => {
    expect(absorbRedo(state(), null)).toEqual(state());
  });
});
