// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AssemblyRunView, { RunFacts } from "./AssemblyRunView";
import type { AssemblyRun } from "@/lib/assembly-runs";

const run = (over: Partial<AssemblyRun> = {}): AssemblyRun => ({
  id: "al-1",
  blueprintName: "code-review",
  graph: null,
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
  issueUrl: "https://github.com/re-cinq/lore/issues/5",
  issueNumber: 5,
  createdBy: null,
  costUsd: null,
  ...over,
});

describe("AssemblyRunView", () => {
  it("renders the run header with its line name and outcome", () => {
    render(<AssemblyRunView run={run()} />);

    expect(
      screen.getByRole("heading", { name: "code-review", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  it("leaves the facts card out of the header", () => {
    const { container } = render(<AssemblyRunView run={run()} />);

    expect(container.querySelector(".spec-card")).toBeNull();
  });

  it("names the repo once, in the trail, rather than repeating it as a fact", () => {
    render(
      <>
        <AssemblyRunView run={run()} />
        <RunFacts run={run()} />
      </>,
    );

    expect(screen.getAllByRole("link", { name: "re-cinq/lore" })).toHaveLength(
      1,
    );
  });

  it("shows the reason on a failed run", () => {
    render(
      <RunFacts
        run={run({ status: "failed", outcome: "error", reason: "no edge" })}
      />,
    );

    expect(screen.getByText("no edge")).toBeInTheDocument();
  });

  it("offers to cancel the task of a running run", () => {
    render(<RunFacts run={run({ taskId: "task-9", status: "running" })} />);

    expect(
      screen.getByRole("button", { name: "Cancel Task" }),
    ).toBeInTheDocument();
  });

  it.each([
    ["a finished run", { taskId: "task-9", status: "finished" }],
    ["a running run with no task", { taskId: null, status: "running" }],
  ] as const)("offers no cancel on %s", (_name, over) => {
    render(<RunFacts run={run(over)} />);

    expect(screen.queryByRole("button", { name: "Cancel Task" })).toBeNull();
  });

  it("links to no task page", () => {
    render(<RunFacts run={run({ taskId: "task-9" })} />);

    expect(screen.queryByRole("link", { name: "View task →" })).toBeNull();
  });

  it("builds the PR link for a code-review run with no task", () => {
    render(<RunFacts run={run()} />);

    expect(screen.getByRole("link", { name: "#7" })).toHaveAttribute(
      "href",
      "https://github.com/re-cinq/lore/pull/7",
    );
  });

  it("shows an em dash for branch and outcome when both are null", () => {
    render(<RunFacts run={run({ branch: null, outcome: null })} />);

    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  it("omits the PR link when the run carries no PR", () => {
    render(<RunFacts run={run({ prUrl: null, prNumber: null })} />);

    expect(screen.queryByRole("link", { name: "#7" })).not.toBeInTheDocument();
  });
  it("renders the run facts as an open collapsible card titled Run facts", () => {
    const { container } = render(<RunFacts run={run()} />);

    expect(screen.getByText("Run facts")).toBeInTheDocument();
    expect(container.querySelector("details[open] dl")).toBeInTheDocument();
  });

  const BAG = {
    task_id: { kind: "value", ref: "task-1", by: "lore" },
    issue: { kind: "file", ref: `sha256-${"ab12".repeat(16)}`, by: "lore" },
    target: {
      kind: "git",
      ref: "github.com/re-cinq/lore@fix/login",
      by: "lore",
      sha: "9f2c1d4e5a",
    },
  } as const;

  it("lists the bag's three items by name under the facts, with their kind and author", () => {
    render(<RunFacts run={run()} bag={BAG} />);

    expect(screen.getByText("Bag (3)")).toBeInTheDocument();
    expect(screen.getByText("task_id").nextElementSibling).toHaveTextContent(
      "task-1value · lore",
    );
  });

  it("shows a git item's commit as its first seven characters", () => {
    render(<RunFacts run={run()} bag={BAG} />);

    expect(screen.getByText("target").nextElementSibling).toHaveTextContent(
      "git · lore · 9f2c1d4",
    );
  });

  it("links a git item to its branch on GitHub and a file item to the run's blob page", () => {
    render(<RunFacts run={run({ id: "run-1" })} bag={BAG} />);

    expect(
      screen.getByRole("link", { name: "github.com/re-cinq/lore@fix/login" }),
    ).toHaveAttribute("href", "https://github.com/re-cinq/lore/tree/fix/login");
    expect(
      screen.getByRole("link", { name: /^sha256-ab12ab12ab12/ }),
    ).toHaveAttribute(
      "href",
      `/assembly-runs/run-1/blobs/sha256-${"ab12".repeat(16)}`,
    );
  });

  it.each([
    ["a run with no bag read", null],
    ["a run whose bag is empty", {}],
  ] as const)("leaves the Bag section out for %s", (_name, bag) => {
    render(<RunFacts run={run()} bag={bag} />);

    expect(screen.queryByText(/^Bag \(/)).toBeNull();
  });

  it("links the backing task's GitHub issue under the PR", () => {
    render(<RunFacts run={run()} />);

    expect(screen.getByRole("link", { name: "#5" })).toHaveAttribute(
      "href",
      "https://github.com/re-cinq/lore/issues/5",
    );
  });

  it("omits the issue link when the run carries no issue", () => {
    render(<RunFacts run={run({ issueUrl: null, issueNumber: null })} />);

    expect(screen.queryByRole("link", { name: "#5" })).not.toBeInTheDocument();
  });

  it("trails the run back to the runs list and its repo above the title", () => {
    const { container } = render(<AssemblyRunView run={run()} />);
    const trail = container.querySelector(".breadcrumb");

    expect(
      Array.from(trail?.querySelectorAll("a") ?? []).map((a) =>
        a.getAttribute("href"),
      ),
    ).toEqual(["/assembly-runs", "/repos/re-cinq/lore"]);
  });

  it("ends the trail with the run's own line name", () => {
    const { container } = render(<AssemblyRunView run={run()} />);

    expect(container.querySelector(".breadcrumb")).toHaveTextContent(
      "Assembly Runs / re-cinq/lore / code-review",
    );
  });
  it("steps through the repo's backlog for a run the implementation loop started", () => {
    const { container } = render(
      <AssemblyRunView run={run({ blueprintName: "implementation-loop" })} />,
    );
    const trail = container.querySelector(".breadcrumb");

    expect(
      Array.from(trail?.querySelectorAll("a") ?? []).map((a) =>
        a.getAttribute("href"),
      ),
    ).toEqual([
      "/assembly-runs",
      "/repos/re-cinq/lore",
      "/repos/re-cinq/lore/implementation-loop",
    ]);
  });

  it("reads the backlog step by name between the repo and the line", () => {
    const { container } = render(
      <AssemblyRunView run={run({ blueprintName: "implementation-loop" })} />,
    );

    expect(container.querySelector(".breadcrumb")).toHaveTextContent(
      "Assembly Runs / re-cinq/lore / Backlog / implementation-loop",
    );
  });

  it("leaves the backlog out of a run no backlog started", () => {
    const { container } = render(<AssemblyRunView run={run()} />);

    expect(
      container.querySelector(
        'a[href="/repos/re-cinq/lore/implementation-loop"]',
      ),
    ).toBeNull();
  });
});
