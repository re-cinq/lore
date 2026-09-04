// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RunGraphView from "./RunGraphView";
import {
  codeReviewDefinition,
  implementationDefinition,
} from "@/lib/definition-fixtures";
import { deriveVisibleGraph, type RunData } from "@/lib/graph-view-model";

const runData = (over: Partial<RunData> = {}): RunData => ({
  executed: new Set<string>(),
  verdicts: {},
  statuses: {},
  taken: new Set<string>(),
  result: null,
  ...over,
});

const failedReviewRun = runData({
  executed: new Set(["review", "done"]),
  verdicts: { review: "failed" },
  taken: new Set(["review-done-failed"]),
  result: "failed",
});

const nodeEl = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-node="${id}"]`) as SVGGElement;

const renderGraph = (
  definition = codeReviewDefinition,
  run: RunData | null = null,
  mode: "run" | "definition" = "definition",
) =>
  render(
    <RunGraphView
      graph={deriveVisibleGraph(definition, run, mode)}
      definition={definition}
    />,
  );

describe("RunGraphView run mode", () => {
  it("draws both steps and a single connector for a failed review run", () => {
    const { container } = renderGraph(
      codeReviewDefinition,
      failedReviewRun,
      "run",
    );

    expect(container.querySelectorAll("[data-node]")).toHaveLength(2);
    expect(container.querySelectorAll("[data-edge]")).toHaveLength(1);
    expect(nodeEl(container, "review")).toBeTruthy();
    expect(nodeEl(container, "done")).toBeTruthy();
  });

  it("shows the verdict on the review node and the result on the terminal", () => {
    const { container } = renderGraph(
      codeReviewDefinition,
      failedReviewRun,
      "run",
    );

    expect(nodeEl(container, "review").getAttribute("data-tone")).toBe("err");
    expect(nodeEl(container, "review")).toHaveTextContent("Failed");
    expect(nodeEl(container, "done").getAttribute("data-tone")).toBe("err");
    expect(nodeEl(container, "done")).toHaveTextContent("Failed");
  });

  it("uses a neutral connector with no label in run mode", () => {
    const { container } = renderGraph(
      codeReviewDefinition,
      failedReviewRun,
      "run",
    );
    const edge = container.querySelector("[data-edge]");

    expect(edge?.getAttribute("data-tone")).toBe("neutral");
    expect(container.querySelectorAll("text").length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain("success");
    expect(container.textContent).not.toContain("changes_requested");
  });

  it("does not draw the unused success or changes_requested paths", () => {
    const successRun = runData({
      executed: new Set(["review", "done"]),
      verdicts: { review: "success" },
      taken: new Set(["review-done-success"]),
      result: "completed",
    });
    const { container } = renderGraph(codeReviewDefinition, successRun, "run");

    expect(container.querySelectorAll("[data-edge]")).toHaveLength(1);
    expect(nodeEl(container, "review")).toHaveTextContent("Succeeded");
    expect(nodeEl(container, "done")).toHaveTextContent("Completed");
  });

  it("shows the changes_requested verdict in the review node", () => {
    const changesRun = runData({
      executed: new Set(["review", "done"]),
      verdicts: { review: "changes_requested" },
      taken: new Set(["review-done-changes_requested"]),
      result: "completed",
    });
    const { container } = renderGraph(codeReviewDefinition, changesRun, "run");

    expect(nodeEl(container, "review").getAttribute("data-tone")).toBe("warn");
    expect(nodeEl(container, "review")).toHaveTextContent("Changes requested");
  });

  it("names each node with its status so meaning does not rest on color", () => {
    const { container } = renderGraph(
      codeReviewDefinition,
      failedReviewRun,
      "run",
    );

    expect(nodeEl(container, "review").getAttribute("aria-label")).toBe(
      "review — Failed",
    );
  });
});

describe("RunGraphView definition mode", () => {
  it("renders one connector and lists outcomes inside the source node", () => {
    const { container } = renderGraph(codeReviewDefinition, null, "definition");

    expect(container.querySelectorAll("[data-edge]")).toHaveLength(1);
    const outcomes = [...container.querySelectorAll("[data-outcome]")].map(
      (el) => el.getAttribute("data-outcome"),
    );

    expect(outcomes).toEqual(["success", "changes_requested", "failed"]);
  });

  it("renders separate branches when outcomes lead to different nodes", () => {
    const { container } = renderGraph(
      implementationDefinition,
      null,
      "definition",
    );
    const reviewEdges = [...container.querySelectorAll("[data-edge]")]
      .map((el) => el.getAttribute("data-edge"))
      .filter((k) => k?.startsWith("review->"));

    expect(new Set(reviewEdges)).toEqual(
      new Set(["review->retrospective", "review->address"]),
    );
  });

  it("does not label the collapsed same-target connector", () => {
    const { container } = renderGraph(codeReviewDefinition, null, "definition");

    expect(container.textContent).not.toContain("review->done");
    const edge = container.querySelector('[data-edge="review->done"]');

    expect(edge?.getAttribute("data-tone")).toBe("neutral");
  });
});

describe("RunGraphView interaction", () => {
  it("calls onSelectNode when a node is clicked", async () => {
    const onSelect = vi.fn();

    render(
      <RunGraphView
        graph={deriveVisibleGraph(codeReviewDefinition, failedReviewRun, "run")}
        definition={codeReviewDefinition}
        onSelectNode={onSelect}
      />,
    );

    await userEvent.click(
      document.querySelector('[data-node="review"]') as Element,
    );

    expect(onSelect).toHaveBeenCalledWith("review");
  });

  it("calls onSelectNode when a node is focused and Enter is pressed", async () => {
    const onSelect = vi.fn();

    render(
      <RunGraphView
        graph={deriveVisibleGraph(codeReviewDefinition, failedReviewRun, "run")}
        definition={codeReviewDefinition}
        onSelectNode={onSelect}
      />,
    );

    (document.querySelector('[data-node="review"]') as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");

    expect(onSelect).toHaveBeenCalledWith("review");
  });

  it("does not call onSelectNode for a key other than Enter or Space", async () => {
    const onSelect = vi.fn();

    render(
      <RunGraphView
        graph={deriveVisibleGraph(codeReviewDefinition, failedReviewRun, "run")}
        definition={codeReviewDefinition}
        onSelectNode={onSelect}
      />,
    );

    (document.querySelector('[data-node="review"]') as HTMLElement).focus();
    await userEvent.keyboard("{a}");

    expect(onSelect).not.toHaveBeenCalled();
  });

  it("renders an empty-state message for a graph with no nodes", () => {
    const { getByText } = render(
      <RunGraphView
        graph={{ mode: "run", nodes: [], edges: [] }}
        definition={null}
      />,
    );

    expect(getByText(/no assembly-line graph/i)).toBeInTheDocument();
  });
});

describe("RunGraphView current state", () => {
  const startedRun = runData({
    executed: new Set(["implement"]),
    statuses: { implement: "running" },
  });

  it("draws every step of the line, the unreached ones as Pending", () => {
    const { container } = renderGraph(
      implementationDefinition,
      startedRun,
      "run",
    );

    expect(container.querySelectorAll("[data-node]")).toHaveLength(7);
    expect(nodeEl(container, "implement")).toHaveTextContent("Running");
    expect(nodeEl(container, "push")).toHaveTextContent("Pending");
  });

  it("names the step and its status, never its possible outcomes", () => {
    const { container } = renderGraph(
      implementationDefinition,
      startedRun,
      "run",
    );

    expect(container.querySelectorAll("[data-outcome]")).toHaveLength(0);
    expect(container.textContent).not.toContain("Possible outcomes");
  });

  it("marks the untraversed connectors so they can fade back", () => {
    const { container } = renderGraph(
      implementationDefinition,
      startedRun,
      "run",
    );
    const takenOf = (pair: string) =>
      container
        .querySelector(`[data-edge="${pair}"]`)
        ?.getAttribute("data-taken");

    expect(takenOf("push->review")).toBe("false");
  });
});
