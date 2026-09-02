// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
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

  it("renders string labels beside the title", () => {
    render(
      <CollapsibleCard title="node-a" labels={["claude_code", "validate"]}>
        <p>x</p>
      </CollapsibleCard>,
    );

    expect(screen.getByText("node-a")).toBeTruthy();
    expect(screen.getByText("claude_code")).toBeTruthy();
    expect(screen.getByText("validate")).toBeTruthy();
  });

  it("drops empty labels, so callers pass them unfiltered", () => {
    const { container } = render(
      <CollapsibleCard title="node-a" labels={[null, undefined, "", "detect"]}>
        <p>x</p>
      </CollapsibleCard>,
    );

    expect(screen.getByText("detect")).toBeTruthy();
    expect(container.querySelectorAll("summary .meta")).toHaveLength(1);
  });

  it("renders a toned status pill in the header from string data", () => {
    render(
      <CollapsibleCard
        title="node-a"
        status={{ label: "succeeded", tone: "ok" }}
      >
        <p>x</p>
      </CollapsibleCard>,
    );

    expect(screen.getByText("succeeded").className).toContain("ok");
  });

  it("renders the actions slot inside the header row", () => {
    const { container } = render(
      <CollapsibleCard
        title="open-pr"
        actions={<button type="button">Retry from this node</button>}
      >
        <p>body</p>
      </CollapsibleCard>,
    );

    expect(container.querySelector("summary button")?.textContent).toBe(
      "Retry from this node",
    );
  });

  it("reports true through onToggle when opened", () => {
    const onToggle = vi.fn();
    const { container } = render(
      <CollapsibleCard title="Pod logs" onToggle={onToggle}>
        <p>x</p>
      </CollapsibleCard>,
    );

    const details = container.querySelector("details");

    if (!details) {
      throw new Error("details not rendered");
    }
    details.open = true;
    fireEvent(details, new Event("toggle"));

    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("shows the empty-state note when it has no content", () => {
    render(
      <CollapsibleCard title="Attempts" emptyState="No attempts recorded." />,
    );

    expect(screen.getByText("No attempts recorded.")).toBeInTheDocument();
  });

  it("shows the content, not the empty-state note, when content is present", () => {
    render(
      <CollapsibleCard title="Attempts" emptyState="No attempts recorded.">
        <p>attempt 1</p>
      </CollapsibleCard>,
    );

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("attempt 1")).toBeTruthy();
  });
});
