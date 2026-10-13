import { describe, it, expect } from "vitest";
import { attemptSections } from "./attempt-sections";

const bare = { produced: null, needs: null, input: null };

describe("attemptSections", () => {
  it.each([
    [
      "an agent attempt shows the Show select, its transcript, model calls, events, Needs and Input",
      "agent",
      bare,
      ["showSelect", "transcript", "modelCalls", "events", "needs", "input"],
    ],
    [
      "a service attempt shows its outcome, Needs, model calls, timing, events and Input, and no Show select",
      "service",
      bare,
      ["outcome", "modelCalls", "timing", "events", "needs", "input"],
    ],
    [
      "a person attempt shows the waiting card, events and Needs only",
      "person",
      bare,
      ["human", "events", "needs"],
    ],
    [
      "a marker attempt with nothing handed in shows its outcome, timing and events",
      "marker",
      bare,
      ["outcome", "timing", "events"],
    ],
    [
      "a marker handed a need also shows Needs",
      "marker",
      { ...bare, needs: { plan_id: "plan-7" } },
      ["outcome", "timing", "events", "needs"],
    ],
    [
      "an agent that produced plan also shows Produced",
      "agent",
      { ...bare, produced: { plan: "sha256-abc" } },
      [
        "showSelect",
        "transcript",
        "produced",
        "modelCalls",
        "events",
        "needs",
        "input",
      ],
    ],
  ] as const)("%s", (_name, family, attempt, shown) => {
    const sections = attemptSections(family, attempt);

    expect(
      Object.entries(sections)
        .filter(([, on]) => on)
        .map(([section]) => section),
    ).toEqual(shown);
  });
});
