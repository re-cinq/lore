// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import NodeNeedsCard from "./NodeNeedsCard";

const HASH = `sha256-${"ab12".repeat(16)}`;

describe("NodeNeedsCard", () => {
  it("lists target and pr_url with their refs for attempt 3", () => {
    render(
      <NodeNeedsCard
        runId="run-1"
        iteration={3}
        needs={{
          target: "github.com/re-cinq/lore@main",
          pr_url: "https://github.com/re-cinq/lore/pull/412",
        }}
      />,
    );

    expect(screen.getByText("Needs")).toBeInTheDocument();
    expect(screen.getByText("attempt 3")).toBeInTheDocument();
    expect(screen.getByText("target").nextElementSibling).toHaveTextContent(
      "github.com/re-cinq/lore@main",
    );
  });

  it("links a git need to its branch on GitHub, opening a new tab", () => {
    render(
      <NodeNeedsCard
        runId="run-1"
        iteration={1}
        needs={{ target: "github.com/re-cinq/lore@fix/login" }}
      />,
    );

    expect(
      screen.getByRole("link", { name: "github.com/re-cinq/lore@fix/login" }),
    ).toMatchObject({
      href: "https://github.com/re-cinq/lore/tree/fix/login",
      target: "_blank",
      rel: "noreferrer",
    });
  });

  it("links a file need to the run's blob page in the same tab", () => {
    render(
      <NodeNeedsCard runId="run-1" iteration={1} needs={{ issue: HASH }} />,
    );

    const link = screen.getByRole("link", { name: /^sha256-ab12ab12ab12/ });

    expect(link.getAttribute("href")).toBe(
      `/assembly-runs/run-1/blobs/${HASH}`,
    );
    expect(link.getAttribute("target")).toBeNull();
  });

  it("shows a plain value as text, not a link", () => {
    render(
      <NodeNeedsCard
        runId="run-1"
        iteration={1}
        needs={{ task_id: "task-1" }}
      />,
    );

    expect(screen.getByText("task-1")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("says an attempt handed nothing was handed nothing", () => {
    render(<NodeNeedsCard runId="run-1" iteration={1} needs={{}} />);

    expect(
      screen.getByText("This attempt was handed nothing."),
    ).toBeInTheDocument();
  });

  it("renders no card for a visit that recorded no needs", () => {
    const { container } = render(
      <NodeNeedsCard runId="run-1" iteration={1} needs={null} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
