import { describe, it, expect } from "vitest";
import { sectionsOf as mirrorSectionsOf } from "./feature-types";
import type { GapResult } from "./feature-types";
// web-ui can't import the @re-cinq/lore-shared PACKAGE (workspace + Docker isolation,
// heavy deps), so sectionsOf is hand-duplicated. This CI-only test (runs in a full
// checkout) imports shared's PURE gap-result.ts by file path — never the package — to
// keep the two in lockstep for the shape they both actually serve: the new `sections[]`
// result. The legacy architecture/user_flows branch is a best-effort compat shim for
// pre-refactor rows and is intentionally NOT asserted (shared renders it richer:
// component touchpoints + an orphan-mockup "Diagrams" section).
import { sectionsOf as canonicalSectionsOf } from "../../../../libs/shared/src/feature-planning/gap-result";

// shared's sectionsOf is intentionally permissive (GapResult | Record | null); widen its
// param to `unknown` so the same fixtures feed both implementations without a nominal clash
// between the two GapResult declarations.
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
