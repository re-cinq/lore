import { describe, it, expect } from "vitest";
import { collapsedMarkup, promptMarks } from "./prompt-marks";

describe("promptMarks", () => {
  it("returns a level-2 heading over '## How you work' with its '## ' as markup", () => {
    expect(promptMarks("## How you work")).toEqual([
      {
        kind: "heading",
        level: 2,
        from: 0,
        to: 15,
        markup: [{ from: 0, to: 3 }],
      },
    ]);
  });

  it("returns bold over '**every**' in 'Read **every** line' with both '**' as markup", () => {
    expect(promptMarks("Read **every** line")).toEqual([
      {
        kind: "bold",
        from: 5,
        to: 14,
        markup: [
          { from: 5, to: 7 },
          { from: 12, to: 14 },
        ],
      },
    ]);
  });

  it("returns a placeholder over '{ticket_path}' and a tag over '<instructions>', hiding neither", () => {
    expect(promptMarks("Read {ticket_path} inside <instructions>")).toEqual([
      { kind: "placeholder", from: 5, to: 18, markup: [] },
      { kind: "tag", from: 26, to: 40, markup: [] },
    ]);
  });
});

describe("collapsedMarkup", () => {
  it("hides the first heading's '## ' and shows the second's when the cursor sits on the second line", () => {
    const text = "## Plan\n## Build";

    expect(
      collapsedMarkup(text, promptMarks(text), { from: 12, to: 12 }),
    ).toEqual([{ from: 0, to: 3 }]);
  });

  it("shows the markup of every line a selection spans", () => {
    const text = "## Plan\n**Read** it\n## Build";

    expect(
      collapsedMarkup(text, promptMarks(text), { from: 2, to: 10 }),
    ).toEqual([{ from: 20, to: 23 }]);
  });

  it("hides every heading's '## ' when nothing is being edited", () => {
    const text = "## Plan\n## Build";

    expect(collapsedMarkup(text, promptMarks(text), null)).toEqual([
      { from: 0, to: 3 },
      { from: 8, to: 11 },
    ]);
  });
});
