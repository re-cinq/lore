import { describe, it, expect } from "vitest";
import {
  approvedBrief,
  draftBrief,
  openPrBrief,
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

  it("asks to refine the Intent section of the live plan by its slot marker, to add the sections a settled answer asks for, to follow one into the sections it makes wrong, and to contradict nothing, since its edits land unreviewed", () => {
    const request = {
      slot: "intent",
      title: "Intent",
      baseHash: "3f9a",
      inputs: { answered: [], resolved: [] },
      uses: { questions: [], comments: [] },
    };

    expect(refineBrief(PLAN, request)).toEqual(
      'Refine the section "Intent" (<!-- slot:intent -->) of the live plan "Faster checkout", building on its answered questions and resolved comments. Where a settled answer asks for structure the plan lacks — a section per item, say — add those sections with `add-section`, placed after this one, rather than writing them into this section. Change another existing section ONLY where one of those settled answers makes what it says wrong. Your edits land in the live plan as you make them, and nobody accepts them first: never write a claim that another section or a settled answer contradicts, and ask with `add-question` where you disagree with one. Leave every other section exactly as it is.',
    );
  });

  it("lists answered question q-target and resolved thread c1 by id, each on one line, to write into Intent or ask about", () => {
    const request = {
      slot: "intent",
      title: "Intent",
      baseHash: "3f9a",
      inputs: {
        answered: [
          {
            questionId: "q-target",
            question: "Which number do we stop at?",
            answer: "300 ms",
          },
        ],
        resolved: [
          {
            commentId: "c1",
            said: [
              { author: "Ben", text: "Keep the cache\n- under a minute." },
            ],
          },
        ],
      },
      uses: { questions: ["q-target"], comments: ["c1"] },
    };

    expect(refineBrief(PLAN, request).split("\n\n").slice(1)).toEqual([
      [
        "Write each of these into the section. One you cannot use, ask about with `add-question` rather than leave out: a refine that ends without them still marks them used.",
        '- Answered q-target: "Which number do we stop at?" — 300 ms',
        '- Resolved thread c1: Ben: "Keep the cache - under a minute."',
      ].join("\n"),
    ]);
  });

  it("briefs a spec pass after spec PR #7 merged as an amendment of what is on main", () => {
    expect(revisedBrief(PLAN, 7)).toEqual(
      'The approved plan "Faster checkout" is in plan.md. It is settled: map it onto this repository\'s specs; do not re-open it. The specs on main were written from an earlier version of this plan (spec PR #7); amend them to say what the plan says now, and leave what still holds alone.',
    );
  });

  it("briefs a spec pass while spec PR #7 is still open as an amendment of the specs on its branch", () => {
    expect(openPrBrief(PLAN, 7)).toEqual(
      'The approved plan "Faster checkout" is in plan.md. It is settled: map it onto this repository\'s specs; do not re-open it. Spec PR #7 is open on this branch with the specs an earlier pass wrote; amend them to say what the plan says now, and leave what still holds alone.',
    );
  });

  it("hands the approved plan to the spec work as the settled plan.md", () => {
    expect(approvedBrief(PLAN)).toEqual(
      'The approved plan "Faster checkout" is in plan.md. It is settled: map it onto this repository\'s specs; do not re-open it.',
    );
  });
});
