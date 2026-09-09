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

  it("shows the split suggestion with a create-draft control per proposed feature", () => {
    renderGap({
      sections: [{ title: "Overview", content: "Section content." }],
      draft_spec_markdown: "",
      split_suggestion: {
        rationale: "This covers two unrelated workflows.",
        proposed_features: [
          { title: "Search", scope: "Keyword search over context" },
          { title: "Onboarding", scope: "Self-service repo onboarding" },
        ],
      },
    } as GapResult);

    expect(
      screen.getByText("This covers two unrelated workflows."),
    ).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: "Create draft" }),
    ).toHaveLength(2);
  });

  it("renders nothing to review when the round produced neither", () => {
    const { container } = renderGap({
      sections: [],
      draft_spec_markdown: "",
    } as GapResult);

    expect(container.textContent).toContain("produced no reviewable analysis");
  });
});
