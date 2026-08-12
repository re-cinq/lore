// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import CollapsibleCard from "./CollapsibleCard";

afterEach(cleanup);

describe("CollapsibleCard", () => {
  it("shows its title as the control that opens it", () => {
    render(
      <CollapsibleCard title="Draft spec">
        <p>the whole spec</p>
      </CollapsibleCard>,
    );

    expect(screen.getByText("Draft spec")).toBeTruthy();
  });

  it("starts closed, so a long document does not own the page", () => {
    const { container } = render(
      <CollapsibleCard title="Draft spec">
        <p>the whole spec</p>
      </CollapsibleCard>,
    );

    expect(container.querySelector("details")?.open).toBe(false);
  });

  it("starts open when the caller says the content is the point", () => {
    const { container } = render(
      <CollapsibleCard title="Your input" defaultOpen>
        <p>kept</p>
      </CollapsibleCard>,
    );

    expect(container.querySelector("details")?.open).toBe(true);
  });

  it("keeps the content in the DOM while closed, so find-in-page and screen readers still reach it", () => {
    // A closed <details> hides its content without unmounting it. Rendering the
    // children conditionally would have been the easy version and would break both.
    render(
      <CollapsibleCard title="Draft spec">
        <p>the whole spec</p>
      </CollapsibleCard>,
    );

    expect(screen.getByText("the whole spec")).toBeTruthy();
  });

  it("can say how much it is hiding without being opened", () => {
    render(
      <CollapsibleCard title="Draft spec" hint="412 lines">
        <p>x</p>
      </CollapsibleCard>,
    );

    expect(screen.getByText(/412 lines/)).toBeTruthy();
  });
});
