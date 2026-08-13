// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import GapSections, { emptyFeedback } from "./GapSections";
import type { GapResult } from "@re-cinq/lore-shared/feature-planning/gap-result.js";

const noop = () => {};

function renderGap(gap: GapResult) {
  return render(
    <GapSections
      gap={gap}
      feedback={emptyFeedback()}
      onChange={noop}
      onCreateDraft={noop}
    />,
  );
}

describe("GapSections", () => {
  it("renders each section's title and content", () => {
    renderGap({
      sections: [{ title: "Data model", content: "A table per round." }],
      draft_spec_markdown: "# spec",
    } as GapResult);

    expect(screen.getByText("Data model")).toBeTruthy();
    expect(screen.getByText("A table per round.")).toBeTruthy();
  });

  it("falls back to the draft spec when the round produced no sections", () => {
    // A GapResult with an empty sections list is structurally valid — sanitizeGapResult
    // accepts it — and one round produced exactly that beside an 8KB draft. Rendering
    // nothing over a result that exists is the worst of both worlds.
    renderGap({
      sections: [],
      draft_spec_markdown: "# Assembly lines live view\n\nThe whole plan.",
    } as GapResult);

    expect(screen.getByText("The whole plan.")).toBeTruthy();
  });

  it("prefers sections over the draft when both are present", () => {
    renderGap({
      sections: [{ title: "Overview", content: "Section content." }],
      draft_spec_markdown: "# draft heading\n\nDraft body.",
    } as GapResult);

    expect(screen.getByText("Section content.")).toBeTruthy();
    expect(screen.queryByText("Draft body.")).toBeNull();
  });

  it("renders nothing to review when the round produced neither", () => {
    const { container } = renderGap({
      sections: [],
      draft_spec_markdown: "",
    } as GapResult);

    expect(container.textContent).toContain("produced no reviewable analysis");
  });
});
