import { describe, it, expect } from "vitest";
import {
  approvedBrief,
  draftBrief,
  refineBrief,
  revisedBrief,
} from "./plan-briefs.js";

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

  it("asks to refine the Intent section by its slot marker, to add the sections a settled answer asks for, and to follow one into the sections it makes wrong", () => {
    const request = {
      slot: "intent",
      title: "Intent",
      baseHash: "3f9a",
      inputs: { answered: [] },
      uses: { questions: [], comments: [] },
    };

    expect(refineBrief(PLAN, request)).toEqual(
      'Refine the section "Intent" (<!-- slot:intent -->) of plan.md for "Faster checkout", building on its answered questions and resolved comments. Where a settled answer asks for structure the plan lacks — a section per item, say — add those sections as new `## Title` headings with no marker, placed after this one, rather than writing them into this section. Change another existing section ONLY where one of those settled answers makes what it says wrong. Each section you add or touch is proposed on its own, for a person to accept or refuse. Leave every other section exactly as it is.',
    );
  });

  it("briefs a spec pass after spec PR #7 merged as an amendment of what is on main", () => {
    expect(revisedBrief(PLAN, 7)).toEqual(
      'The approved plan "Faster checkout" is in plan.md. It is settled: map it onto this repository\'s specs; do not re-open it. The specs on main were written from an earlier version of this plan (spec PR #7); amend them to say what the plan says now, and leave what still holds alone.',
    );
  });

  it("hands the approved plan to the spec work as the settled plan.md", () => {
    expect(approvedBrief(PLAN)).toEqual(
      'The approved plan "Faster checkout" is in plan.md. It is settled: map it onto this repository\'s specs; do not re-open it.',
    );
  });
});
