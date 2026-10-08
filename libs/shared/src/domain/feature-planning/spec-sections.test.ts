import { describe, expect, it } from "vitest";
import type { CitablePlan } from "./plan-coverage.js";
import { INTEGRATED_SLOTS, nextSection } from "./spec-sections.js";

const PLAN: CitablePlan = {
  plan_url: "https://lore.example/plans/p1",
  blocks: [
    {
      id: "b1",
      slot: "intent",
      kind: "paragraph",
      text: "Pay in your currency.",
      link: "https://lore.example/plans/p1#b1",
    },
    {
      id: "b2",
      slot: "risk",
      kind: "paragraph",
      text: "Rates may lag.",
      link: "https://lore.example/plans/p1#b2",
    },
    {
      id: "b3",
      slot: "scope",
      kind: "paragraph",
      text: "Billing is out.",
      link: "https://lore.example/plans/p1#b3",
    },
    {
      id: "b4",
      slot: "scope",
      kind: "paragraph",
      text: "Refunds are in.",
      link: "https://lore.example/plans/p1#b4",
    },
  ],
};

describe("nextSection", () => {
  it("returns the first section in line order, leaving intent to the draft", () => {
    expect(nextSection(PLAN, [])).toEqual({
      slot: "scope",
      text: "## scope\n\n- Billing is out. ([plan](https://lore.example/plans/p1#b3))\n- Refunds are in. ([plan](https://lore.example/plans/p1#b4))\n",
      done: ["scope"],
    });
  });

  it("returns the next section that is not done yet", () => {
    expect(nextSection(PLAN, ["scope"])).toMatchObject({
      slot: "risk",
      done: ["scope", "risk"],
    });
  });

  it("returns null once every section with blocks is done", () => {
    expect(nextSection(PLAN, ["scope", "risk"])).toBeNull();
  });

  it("returns null for a plan that has only an intent", () => {
    expect(nextSection({ ...PLAN, blocks: [PLAN.blocks[0]!] }, [])).toBeNull();
  });

  it("orders sections by line order, not by block order", () => {
    expect(INTEGRATED_SLOTS.indexOf("scope")).toBeLessThan(
      INTEGRATED_SLOTS.indexOf("risk"),
    );
  });
});
