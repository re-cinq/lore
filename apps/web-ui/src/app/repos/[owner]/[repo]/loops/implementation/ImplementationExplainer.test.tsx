// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import ImplementationExplainer from "./ImplementationExplainer";

const renderView = () => render(<ImplementationExplainer />);

describe("ImplementationExplainer", () => {
  it("explains how to queue a ticket and how the loop works", () => {
    const { getAllByText } = renderView();

    const said = (pattern: RegExp) => getAllByText(pattern).length > 0;

    expect(
      [
        /Label an open issue with exactly one of/,
        /priority:high/,
        /lore:blocked/,
        /never merges/,
        /remove the label to re-queue/i,
      ].every(said),
    ).toBe(true);
  });

  it("explains that a ticket blocked by an open issue waits unlabelled until its last blocker closes", () => {
    const { getAllByText } = renderView();

    expect(
      getAllByText(/waits instead: it gets no label/).length,
    ).toBeGreaterThan(0);
  });
});
