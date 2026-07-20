// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RunGraphView from "./RunGraphView";
import { implementationDefinition } from "@/lib/builtin-definitions";
import { initialRunState } from "@/lib/run-event-reducer";
import type { AssemblyLineRunNode } from "@/lib/assembly-line-runs";
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";

const row = (
  nodeId: string,
  over: Partial<AssemblyLineRunNode> = {},
): AssemblyLineRunNode => ({
  nodeId,
  iteration: 1,
  outcome: "success",
  agentCrName: null,
  commitSha: null,
  durationSeconds: null,
  ...over,
});

const states = (rows: AssemblyLineRunNode[] = []) =>
  initialRunState(implementationDefinition, rows).nodeStates;

const nodeEl = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-node="${id}"]`) as SVGGElement;

describe("RunGraphView structure", () => {
  it("renders one node for each of the 7 implementation-definition nodes", () => {
    const { container } = render(
      <RunGraphView
        definition={implementationDefinition}
        nodeStates={states()}
      />,
    );

    expect(container.querySelectorAll("[data-node]")).toHaveLength(7);
  });

  it("shows no attempt badge on a pending node whose edge declares iteration_max", () => {
    const { container } = render(
      <RunGraphView
        definition={implementationDefinition}
        nodeStates={states()}
      />,
    );

    expect(nodeEl(container, "implement").textContent).not.toContain("0/");
  });

  it("renders one path for each of the 10 implementation-definition edges", () => {
    const { container } = render(
      <RunGraphView
        definition={implementationDefinition}
        nodeStates={states()}
      />,
    );

    expect(container.querySelectorAll("path[data-edge]")).toHaveLength(10);
  });

  it("renders both review-to-retrospective edges when success and failed share a path", () => {
    const { container } = render(
      <RunGraphView
        definition={implementationDefinition}
        nodeStates={states()}
      />,
    );

    expect(
      container.querySelectorAll('[data-edge^="review-retrospective-"]'),
    ).toHaveLength(2);
  });

  it("renders the implement self-loop with edge kind self", () => {
    const { container } = render(
      <RunGraphView
        definition={implementationDefinition}
        nodeStates={states()}
      />,
    );

    expect(
      container
        .querySelector('[data-edge="implement-implement-failed"]')
        ?.getAttribute("data-kind"),
    ).toBe("self");
  });

  it("renders the validate-to-implement back edge with edge kind back", () => {
    const { container } = render(
      <RunGraphView
        definition={implementationDefinition}
        nodeStates={states()}
      />,
    );

    expect(
      container
        .querySelector('[data-edge="validate-implement-failed"]')
        ?.getAttribute("data-kind"),
    ).toBe("back");
  });

  it("renders a title naming the definition", () => {
    render(
      <RunGraphView
        definition={implementationDefinition}
        nodeStates={states()}
      />,
    );

    expect(
      screen.getByRole("img", { name: /implementation/ }),
    ).toBeInTheDocument();
  });

  it("renders a finite viewBox rather than a degenerate one", () => {
    const { container } = render(
      <RunGraphView
        definition={implementationDefinition}
        nodeStates={states()}
      />,
    );

    const viewBox = container.querySelector("svg")?.getAttribute("viewBox");

    expect(viewBox?.split(" ").every((n) => Number.isFinite(Number(n)))).toBe(
      true,
    );
  });
});

describe("RunGraphView edge labels", () => {
  it("renders the on-condition as the edge label when showEdgeLabels is true", () => {
    render(
      <RunGraphView
        definition={implementationDefinition}
        nodeStates={states()}
        showEdgeLabels
      />,
    );

    expect(screen.getByText("changes_requested")).toBeInTheDocument();
  });

  it("renders no edge labels when showEdgeLabels is false", () => {
    render(
      <RunGraphView
        definition={implementationDefinition}
        nodeStates={states()}
        showEdgeLabels={false}
      />,
    );

    expect(screen.queryByText("changes_requested")).not.toBeInTheDocument();
  });
});

describe("RunGraphView node status", () => {
  it("renders a node with a null outcome as Running with tone running", () => {
    const { container } = render(
      <RunGraphView
        definition={implementationDefinition}
        nodeStates={states([row("implement", { outcome: null })])}
      />,
    );

    expect(nodeEl(container, "implement").getAttribute("data-tone")).toBe(
      "running",
    );
    expect(nodeEl(container, "implement")).toHaveTextContent("Running");
  });

  it("renders a node with outcome success as Succeeded with tone ok", () => {
    const { container } = render(
      <RunGraphView
        definition={implementationDefinition}
        nodeStates={states([row("validate")])}
      />,
    );

    expect(nodeEl(container, "validate").getAttribute("data-tone")).toBe("ok");
    expect(nodeEl(container, "validate")).toHaveTextContent("Succeeded");
  });

  it("renders a node with outcome implement-failed as Failed with tone err", () => {
    const { container } = render(
      <RunGraphView
        definition={implementationDefinition}
        nodeStates={states([row("implement", { outcome: "implement-failed" })])}
      />,
    );

    expect(nodeEl(container, "implement").getAttribute("data-tone")).toBe(
      "err",
    );
    expect(nodeEl(container, "implement")).toHaveTextContent("Failed");
  });

  it("renders a definition node with no visit row as Pending with tone idle", () => {
    const { container } = render(
      <RunGraphView
        definition={implementationDefinition}
        nodeStates={states([row("implement")])}
      />,
    );

    expect(nodeEl(container, "review").getAttribute("data-tone")).toBe("idle");
    expect(nodeEl(container, "review")).toHaveTextContent("Pending");
  });

  it("names each node with its id and status label so tone is never the only signal", () => {
    const { container } = render(
      <RunGraphView
        definition={implementationDefinition}
        nodeStates={states([row("push")])}
      />,
    );

    expect(nodeEl(container, "push").getAttribute("aria-label")).toBe(
      "push — Succeeded",
    );
  });

  it("renders 2 of 3 as the attempt badge for iteration 2 on an iteration_max 2 edge", () => {
    const { container } = render(
      <RunGraphView
        definition={implementationDefinition}
        nodeStates={states([row("address", { iteration: 2 })])}
      />,
    );

    expect(nodeEl(container, "address")).toHaveTextContent("2/3");
  });

  it("renders no attempt badge for a node whose inbound edges carry no iteration_max", () => {
    const { container } = render(
      <RunGraphView
        definition={implementationDefinition}
        nodeStates={states([row("push", { iteration: 2 })])}
      />,
    );

    expect(nodeEl(container, "push")).not.toHaveTextContent("2/");
  });
});

describe("RunGraphView interaction", () => {
  it("focuses a node by keyboard tab when onSelectNode is supplied", async () => {
    const { container } = render(
      <RunGraphView
        definition={implementationDefinition}
        nodeStates={states()}
        onSelectNode={vi.fn()}
      />,
    );

    await userEvent.tab();

    expect(document.activeElement).toBe(nodeEl(container, "implement"));
  });

  it("calls onSelectNode with the node id when Enter is pressed on a focused node", async () => {
    const onSelectNode = vi.fn();

    render(
      <RunGraphView
        definition={implementationDefinition}
        nodeStates={states()}
        onSelectNode={onSelectNode}
      />,
    );

    await userEvent.tab();

    await userEvent.keyboard("{Enter}");

    expect(onSelectNode).toHaveBeenCalledWith("implement");
  });

  it("calls onSelectNode with the node id when Space is pressed on a focused node", async () => {
    const onSelectNode = vi.fn();

    render(
      <RunGraphView
        definition={implementationDefinition}
        nodeStates={states()}
        onSelectNode={onSelectNode}
      />,
    );

    await userEvent.tab();

    await userEvent.keyboard(" ");

    expect(onSelectNode).toHaveBeenCalledWith("implement");
  });

  it("ignores keys other than Enter and Space on a focused node", async () => {
    const onSelectNode = vi.fn();

    render(
      <RunGraphView
        definition={implementationDefinition}
        nodeStates={states()}
        onSelectNode={onSelectNode}
      />,
    );

    await userEvent.tab();

    await userEvent.keyboard("x");

    expect(onSelectNode).not.toHaveBeenCalled();
  });

  it("calls onSelectNode with the node id when a node is clicked", async () => {
    const onSelectNode = vi.fn();
    const { container } = render(
      <RunGraphView
        definition={implementationDefinition}
        nodeStates={states()}
        onSelectNode={onSelectNode}
      />,
    );

    await userEvent.click(nodeEl(container, "review"));

    expect(onSelectNode).toHaveBeenCalledWith("review");
  });

  it("renders no tabbable node when onSelectNode is omitted", () => {
    const { container } = render(
      <RunGraphView
        definition={implementationDefinition}
        nodeStates={states()}
      />,
    );

    expect(container.querySelectorAll("[tabindex]")).toHaveLength(0);
  });

  it("does not call onSelectNode on click when onSelectNode is omitted", async () => {
    const { container } = render(
      <RunGraphView
        definition={implementationDefinition}
        nodeStates={states()}
      />,
    );

    await userEvent.click(nodeEl(container, "review"));

    expect(nodeEl(container, "review").getAttribute("role")).toBe("group");
  });
});

describe("RunGraphView empty states", () => {
  it("renders an empty-state message for a null definition", () => {
    render(<RunGraphView definition={null} nodeStates={{}} />);

    expect(screen.getByText(/no assembly-line graph/i)).toBeInTheDocument();
  });

  it("renders an empty-state message for a definition with zero nodes", () => {
    const empty: AssemblyLineDefinition = {
      name: "empty",
      description: "",
      version: 1,
      entry: "",
      exit: "",
      nodes: [],
      edges: [],
    };

    render(<RunGraphView definition={empty} nodeStates={{}} />);

    expect(screen.getByText(/no assembly-line graph/i)).toBeInTheDocument();
  });
});
