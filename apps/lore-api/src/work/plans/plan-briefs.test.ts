import { describe, it, expect } from "vitest";
import { approvedBrief, draftBrief, refineBrief } from "./plan-briefs.js";

const PLAN = { title: "Faster checkout" };

describe("plan briefs", () => {
  it("asks for a draft of Faster checkout in plan.md with what the author knows", () => {
    expect(draftBrief(PLAN, "Mobile users drop off.")).toEqual(
      [
        'Draft the plan "Faster checkout" in plan.md.',
        "",
        "What the author already knows:",
        "Mobile users drop off.",
      ].join("\n"),
    );
  });

  it("asks to refine only the Intent section of plan.md, by its slot marker", () => {
    const request = {
      slot: "intent",
      title: "Intent",
      baseHash: "3f9a",
      inputs: { answered: [] },
      uses: { questions: [], comments: [] },
    };

    expect(refineBrief(PLAN, request)).toEqual(
      'Refine only the section "Intent" (<!-- slot:intent -->) of plan.md for "Faster checkout". Build on its answered questions and resolved comments, and leave every other section as it is.',
    );
  });

  it("hands the approved plan to the spec work as the settled plan.md", () => {
    expect(approvedBrief(PLAN)).toEqual(
      'The approved plan "Faster checkout" is in plan.md. It is settled: map it onto this repository\'s specs; do not re-open it.',
    );
  });
});
