// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { AssemblyRunNode } from "@/lib/assembly-runs";
import RunBagFacts from "./RunBagFacts";
import { RunFocusContext } from "./run-focus-context";

const draft2: AssemblyRunNode = {
  nodeId: "draft",
  iteration: 2,
  outcome: "success",
  agentCrName: "floor-visit-9",
  commitSha: null,
  durationSeconds: 30,
  stationRunId: "visit-9",
};

const BAG = {
  plan: { kind: "value", ref: "plan-7", by: "visit-9" },
  task_id: { kind: "value", ref: "task-1", by: "hook" },
  target: {
    kind: "git",
    ref: "github.com/re-cinq/lore@fix/login",
    by: "lore",
    sha: "9f2c1d4e5a",
  },
} as const;

describe("RunBagFacts", () => {
  it("names visit-9 as draft · attempt 2 and focuses that attempt when it is clicked", () => {
    const focusAttempt = vi.fn();

    render(
      <RunFocusContext.Provider value={focusAttempt}>
        <RunBagFacts runId="run-1" bag={BAG} nodes={[draft2]} />
      </RunFocusContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "draft · attempt 2" }));

    expect(focusAttempt).toHaveBeenCalledWith("draft", 2);
  });

  it("keeps hook, which is no visit, as hook", () => {
    render(<RunBagFacts runId="run-1" bag={BAG} nodes={[draft2]} />);

    expect(screen.getByText("task_id").nextElementSibling).toHaveTextContent(
      "value · hook",
    );
  });

  it("links the git item's commit 9f2c1d4 to that commit on GitHub", () => {
    render(<RunBagFacts runId="run-1" bag={BAG} nodes={[draft2]} />);

    expect(screen.getByRole("link", { name: "9f2c1d4" })).toHaveAttribute(
      "href",
      "https://github.com/re-cinq/lore/commit/9f2c1d4e5a",
    );
  });
});
