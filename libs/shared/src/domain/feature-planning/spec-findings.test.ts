import { describe, expect, it } from "vitest";
import { specFindingsOf, SPEC_FINDING_PREFIX } from "./spec-findings.js";

const FAILURES = [
  {
    id: "q1",
    section: "scope",
    text: "Billing is out of scope.",
    reason: "The spec puts billing in scope.",
  },
  {
    id: "q4",
    section: "*",
    text: "Every image ships a multi-arch manifest.",
    reason: "Not cited yet: k-arm-manifest.",
  },
];

describe("specFindingsOf", () => {
  it("writes one blocker finding per failing check in the section its question is about", () => {
    expect(specFindingsOf([FAILURES[0]!], 3)).toEqual([
      {
        slot: "scope",
        text: "Billing is out of scope. — the spec written from this plan could not uphold it: The spec puts billing in scope.",
        why: "After 3 rounds the spec and this section still disagree. Fix the section, or the plan where it contradicts itself, then approve again.",
        severity: "blocker",
        finding_id: expect.stringMatching(/^f-spec-\w+$/),
      },
    ]);
  });

  it("puts a repair-visit failure, which no section owns, on the intent", () => {
    expect(specFindingsOf([FAILURES[1]!], 1).map((f) => f.slot)).toEqual([
      "intent",
    ]);
  });

  it("gives a finding the same f-spec- id on every round, from its section and text", () => {
    const [first] = specFindingsOf(FAILURES, 1);
    const [again] = specFindingsOf(FAILURES, 5);

    expect({
      same: first?.finding_id === again?.finding_id,
      prefix: SPEC_FINDING_PREFIX,
    }).toEqual({
      same: true,
      prefix: "f-spec-",
    });
  });
});
