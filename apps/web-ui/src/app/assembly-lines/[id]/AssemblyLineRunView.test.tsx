// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import AssemblyLineRunView from "./AssemblyLineRunView";
import { implementationDefinition } from "@/lib/builtin-definitions";
import type {
  AssemblyLineRun,
  AssemblyLineRunNode,
} from "@/lib/assembly-line-runs";

const run = (over: Partial<AssemblyLineRun> = {}): AssemblyLineRun => ({
  id: "al-1",
  definitionName: "code-review",
  taskId: null,
  repo: "re-cinq/lore",
  branch: "feat/x",
  status: "finished",
  outcome: "completed",
  reason: null,
  createdAt: "2026-07-14T10:00:00Z",
  startedAt: "2026-07-14T10:00:05Z",
  durationSeconds: 120,
  prUrl: "https://github.com/re-cinq/lore/pull/7",
  prNumber: 7,
  createdBy: null,
  costUsd: null,
  resumedFromLineId: null,
  resumedFromNodeId: null,
  inheritedNodeCount: 0,
  ...over,
});

const node = (
  over: Partial<AssemblyLineRunNode> = {},
): AssemblyLineRunNode => ({
  nodeId: "review",
  iteration: 1,
  outcome: "success",
  agentCrName: "a1b2c3d4-review",
  commitSha: "deadbeefcafe",
  durationSeconds: 60,
  ...over,
});

describe("AssemblyLineRunView", () => {
  it("renders the run header with definition, repo link and outcome", () => {
    render(
      <AssemblyLineRunView
        run={run()}
        nodes={[node()]}
        definition={implementationDefinition}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "code-review", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "re-cinq/lore" })).toHaveAttribute(
      "href",
      "/repos/re-cinq/lore",
    );
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  it("shows the reason on a failed run", () => {
    render(
      <AssemblyLineRunView
        run={run({ status: "failed", outcome: "error", reason: "no edge" })}
        nodes={[]}
        definition={implementationDefinition}
      />,
    );

    expect(screen.getByText("no edge")).toBeInTheDocument();
  });

  it("links the backing task when task_id is set, omits it otherwise", () => {
    const { rerender } = render(
      <AssemblyLineRunView
        run={run({ taskId: "task-9" })}
        nodes={[]}
        definition={implementationDefinition}
      />,
    );

    expect(screen.getByRole("link", { name: "View task →" })).toHaveAttribute(
      "href",
      "/tasks/task-9",
    );

    rerender(
      <AssemblyLineRunView
        run={run({ taskId: null })}
        nodes={[]}
        definition={implementationDefinition}
      />,
    );
    expect(
      screen.queryByRole("link", { name: "View task →" }),
    ).not.toBeInTheDocument();
  });

  it("renders one row per node with a shortened commit link", () => {
    render(
      <AssemblyLineRunView
        run={run()}
        nodes={[
          node(),
          node({ nodeId: "refine", iteration: 2, commitSha: "abc1234def" }),
        ]}
        definition={implementationDefinition}
      />,
    );

    expect(screen.getByText("refine")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "deadbee" })).toHaveAttribute(
      "href",
      "https://github.com/re-cinq/lore/commit/deadbeefcafe",
    );
    expect(screen.getByRole("link", { name: "abc1234" })).toHaveAttribute(
      "href",
      "https://github.com/re-cinq/lore/commit/abc1234def",
    );
  });

  it("shows a status pill and the forward branch a step took", () => {
    render(
      <AssemblyLineRunView
        run={run()}
        nodes={[node({ nodeId: "implement", outcome: "success" })]}
        definition={implementationDefinition}
      />,
    );

    expect(screen.getByText("Succeeded")).toBeInTheDocument();
    expect(screen.getByText("success → validate")).toBeInTheDocument();
  });

  it("annotates a retry with a back arrow to the loop target", () => {
    render(
      <AssemblyLineRunView
        run={run()}
        nodes={[node({ nodeId: "validate", outcome: "failed" })]}
        definition={implementationDefinition}
      />,
    );

    expect(screen.getByText("failed ↩ implement")).toBeInTheDocument();
  });

  it("renders the no-node-executions note for a zero-node run", () => {
    render(
      <AssemblyLineRunView
        run={run()}
        nodes={[]}
        definition={implementationDefinition}
      />,
    );

    expect(
      screen.getByText("No node executions recorded."),
    ).toBeInTheDocument();
  });

  it("links the fork's source run and names the resumed-from node", () => {
    render(
      <AssemblyLineRunView
        run={run({
          resumedFromLineId: "al-0",
          resumedFromNodeId: "review",
          inheritedNodeCount: 1,
        })}
        nodes={[node()]}
        definition={implementationDefinition}
      />,
    );

    expect(
      screen.getByRole("link", { name: "source run (through review) →" }),
    ).toHaveAttribute("href", "/assembly-lines/al-0");
  });

  it("marks the first inheritedNodeCount steps as inherited, later steps not", () => {
    render(
      <AssemblyLineRunView
        run={run({
          resumedFromLineId: "al-0",
          resumedFromNodeId: "implement",
          inheritedNodeCount: 1,
        })}
        nodes={[
          node({ nodeId: "implement", agentCrName: null }),
          node({ nodeId: "validate" }),
        ]}
        definition={implementationDefinition}
      />,
    );

    const steps = screen.getAllByRole("listitem");

    expect(within(steps[0]).getByText("Inherited")).toBeInTheDocument();
    expect(within(steps[1]).queryByText("Inherited")).not.toBeInTheDocument();
  });

  it("omits the inherited marker on a plain run", () => {
    render(
      <AssemblyLineRunView
        run={run()}
        nodes={[node()]}
        definition={implementationDefinition}
      />,
    );

    expect(screen.queryByText("Inherited")).not.toBeInTheDocument();
  });

  it("offers Rerun from here on the latest row per completed node of a terminal forkable run", () => {
    render(
      <AssemblyLineRunView
        run={run({ status: "failed", outcome: "error" })}
        nodes={[
          node({ nodeId: "implement", iteration: 1 }),
          node({ nodeId: "validate", iteration: 1, outcome: "failed" }),
          node({ nodeId: "implement", iteration: 2 }),
        ]}
        definition={implementationDefinition}
        forkable
      />,
    );

    const steps = screen.getAllByRole("listitem");
    const buttonIn = (step: HTMLElement) =>
      within(step).queryByRole("button", { name: "Rerun from here" });

    expect(buttonIn(steps[0])).not.toBeInTheDocument();
    expect(buttonIn(steps[1])).toBeInTheDocument();
    expect(buttonIn(steps[2])).toBeInTheDocument();
  });

  it("offers no rerun on a running run even when forkable", () => {
    render(
      <AssemblyLineRunView
        run={run({ status: "running", outcome: null })}
        nodes={[node()]}
        definition={implementationDefinition}
        forkable
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Rerun from here" }),
    ).not.toBeInTheDocument();
  });

  it("offers no rerun when the run is not forkable (synthetic definition)", () => {
    render(
      <AssemblyLineRunView
        run={run({ status: "failed", outcome: "error" })}
        nodes={[node()]}
        definition={implementationDefinition}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Rerun from here" }),
    ).not.toBeInTheDocument();
  });

  it("offers no rerun for a node that never completed a row", () => {
    render(
      <AssemblyLineRunView
        run={run({ status: "failed", outcome: "error" })}
        nodes={[node({ outcome: null })]}
        definition={implementationDefinition}
        forkable
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Rerun from here" }),
    ).not.toBeInTheDocument();
  });

  it("offers the rerun on a node's latest completed row when its final row is still open", () => {
    const { container } = render(
      <AssemblyLineRunView
        run={run({ status: "failed", outcome: "error" })}
        nodes={[
          node({ nodeId: "implement", iteration: 1 }),
          node({ nodeId: "implement", iteration: 2, outcome: null }),
        ]}
        definition={implementationDefinition}
        forkable
      />,
    );

    expect(
      screen.getAllByRole("button", { name: "Rerun from here" }),
    ).toHaveLength(1);
    const steps = container.querySelectorAll("li");

    expect(
      within(steps[0] as HTMLElement).getByRole("button", {
        name: "Rerun from here",
      }),
    ).toBeInTheDocument();
  });

  it("builds the PR link for a code-review run with no task", () => {
    render(
      <AssemblyLineRunView
        run={run()}
        nodes={[]}
        definition={implementationDefinition}
      />,
    );

    expect(screen.getByRole("link", { name: "#7" })).toHaveAttribute(
      "href",
      "https://github.com/re-cinq/lore/pull/7",
    );
  });
});
