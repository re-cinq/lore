// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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
