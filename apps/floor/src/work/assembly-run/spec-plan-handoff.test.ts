import { describe, it, expect } from "vitest";
import {
  renderSpecPlan,
  specPlanOf,
  withSpecPlan,
  type SpecPlan,
} from "./spec-plan-handoff.js";

const PLAN: SpecPlan = {
  standard: "FR-nnn statements with issue tags.",
  updates: [
    {
      path: "specs/support-agent-tms-tools/spec.md",
      reason: "The tool renders a card.",
      statements: ["FR-043: tools MUST NOT carry clientMessages", "FR-055"],
      guidance: "Amend FR-043; replace FR-055.",
    },
  ],
  creates: [
    {
      path: "specs/delivery-card/spec.md",
      title: "Delivery card",
      outline: ["Problem", "Requirements"],
    },
  ],
  adrs: [{ path: "adrs/ADR-002-cards.md", decision: "Cards bypass the model" }],
  considered: [
    {
      path: "specs/support-agent-evaluation/spec.md",
      why_not: "already covered",
    },
  ],
  summary: "Two specs change, one is born.",
};

describe("specPlanOf", () => {
  it("reads the spec plan the analysis delivered as JSON text into the run's args", () => {
    expect(specPlanOf({ spec_plan: JSON.stringify(PLAN) })).toEqual(PLAN);
  });

  it("takes a spec plan already stored as an object, and answers null for none or for text that is not JSON", () => {
    expect([
      specPlanOf({ spec_plan: PLAN }),
      specPlanOf({}),
      specPlanOf({ spec_plan: "not json" }),
    ]).toEqual([PLAN, null, null]);
  });
});

describe("withSpecPlan", () => {
  it("leaves a recipe without the {spec_plan} slot untouched, plan or no plan", () => {
    expect([
      withSpecPlan("Write the specs.", PLAN),
      withSpecPlan("Write the specs.", null),
    ]).toEqual(["Write the specs.", "Write the specs."]);
  });

  it("refuses to launch a recipe that expects the analysis on a run whose args carry none", () => {
    expect(() => withSpecPlan("Edit these:\n{spec_plan}", null)).toThrow(
      /carry no spec_plan/,
    );
  });

  it("renders the analysis into the slot: each file to update with its statements and guidance, the files to create, the ADRs, the files left alone, and the summary", () => {
    const prompt = withSpecPlan("Edit these:\n{spec_plan}\nThen push.", PLAN);

    expect(prompt).toBe(`Edit these:
${renderSpecPlan(PLAN)}
Then push.`);
    expect(renderSpecPlan(PLAN)).toBe(`### Standard

FR-nnn statements with issue tags.

### Update \`specs/support-agent-tms-tools/spec.md\`

Why: The tool renders a card.
Statements that change:
- FR-043: tools MUST NOT carry clientMessages
- FR-055
Guidance: Amend FR-043; replace FR-055.

### Create \`specs/delivery-card/spec.md\` — Delivery card

Outline:
- Problem
- Requirements

### ADR \`adrs/ADR-002-cards.md\`

Decision: Cards bypass the model

### Left alone on purpose — do not touch these

- \`specs/support-agent-evaluation/spec.md\`: already covered

### Summary

Two specs change, one is born.`);
  });
});
