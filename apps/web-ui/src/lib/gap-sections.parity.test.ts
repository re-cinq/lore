import { describe, it, expect } from "vitest";
import { sectionsOf as mirrorSectionsOf } from "./gap-sections";
import type { GapResult } from "./feature-types";
import { sectionsOf as canonicalSectionsOf } from "../../../../libs/shared/src/feature-planning/gap-result";

const canonical = canonicalSectionsOf as (
  gap: unknown,
) => ReturnType<typeof canonicalSectionsOf>;

describe("sectionsOf parity (web-ui mirror vs shared canonical)", () => {
  const newShape: GapResult = {
    sections: [
      { title: "Overview", content: "A planning surface." },
      {
        title: "Data model",
        content: "features + iterations",
        mockups: [{ title: "schema", format: "svg", markup: "<svg/>" }],
        questions: [
          { id: "q1", question: "Which repos?", why: "scope", kind: "text" },
        ],
      },
    ],
    draft_spec_markdown: "# Spec",
  };

  it("returns identical sections for a new-shape result", () => {
    expect(mirrorSectionsOf(newShape)).toEqual(canonical(newShape));
  });

  it("both return [] for null", () => {
    expect(mirrorSectionsOf(null)).toEqual([]);
    expect(canonical(null)).toEqual([]);
  });

  it("both return [] for an empty sections array", () => {
    const empty: GapResult = { sections: [], draft_spec_markdown: "x" };

    expect(mirrorSectionsOf(empty)).toEqual([]);
    expect(canonical(empty)).toEqual([]);
  });
});
