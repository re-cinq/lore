import { describe, it, expect } from "vitest";
import { approvedBrief, draftBrief, refineBrief } from "./plan-briefs.js";

const PLAN = {
  title: "Faster checkout",
  sections: [{ slot: "intent", text: "Checkout is slow." }],
};

describe("plan briefs", () => {
  it("asks for a draft of Faster checkout with the plan as it stands and what the author knows", () => {
    expect(draftBrief(PLAN, "Mobile users drop off.")).toEqual(
      [
        'Draft the plan "Faster checkout".',
        "",
        "What the author already knows:",
        "Mobile users drop off.",
        "",
        "The plan as it stands:",
        "```json",
        JSON.stringify(PLAN, null, 2),
        "```",
      ].join("\n"),
    );
  });

  it("asks to refine only the intent section, handing over its settled inputs and hash", () => {
    const request = {
      slot: "intent",
      title: "Intent",
      baseHash: "3f9a",
      inputs: { answered: [] },
      uses: { questions: [], comments: [] },
    };

    expect(refineBrief(PLAN, request)).toContain(
      'Refine only the section intent (Intent) of "Faster checkout" and answer with a proposal.',
    );
  });

  it("carries the refine request as JSON so the agent can copy its baseHash and uses", () => {
    const request = {
      slot: "intent",
      title: "Intent",
      baseHash: "3f9a",
      inputs: {},
      uses: { questions: ["q1"], comments: [] },
    };

    expect(refineBrief(PLAN, request)).toContain(
      JSON.stringify(request, null, 2),
    );
  });

  it("hands the approved plan to the spec work as the settled input", () => {
    expect(approvedBrief(PLAN)).toEqual(
      [
        'The approved plan "Faster checkout". It is settled: map it onto this repository\'s specs; do not re-open it.',
        "",
        "```json",
        JSON.stringify(PLAN, null, 2),
        "```",
      ].join("\n"),
    );
  });
});
