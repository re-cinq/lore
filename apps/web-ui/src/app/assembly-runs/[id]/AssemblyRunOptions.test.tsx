// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AssemblyRunOptions } from "./AssemblyRunOptions";
import type { AssemblyRun } from "@/lib/assembly-runs";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

function buildRun(overrides: Partial<AssemblyRun>): AssemblyRun {
  return {
    id: "5f0c2a1e-9a2b-4a7e-8f3d-1c6b7d8e9f00",
    blueprintName: "code-review",
    graph: null,
    taskId: null,
    repo: "re-cinq/lore",
    branch: null,
    status: "completed",
    outcome: "success",
    reason: null,
    createdAt: "2026-09-01T10:00:00Z",
    startedAt: "2026-09-01T10:00:05Z",
    durationSeconds: 120,
    prUrl: "https://github.com/re-cinq/lore/pull/42",
    prNumber: 42,
    issueUrl: null,
    issueNumber: null,
    createdBy: null,
    costUsd: null,
    ...overrides,
  };
}

describe("AssemblyRunOptions", () => {
  it("renders the trigger-review button for a code-review run with PR 42", () => {
    render(<AssemblyRunOptions run={buildRun({})} />);

    expect(
      screen.getByRole("button", { name: "Trigger review" }),
    ).toBeInTheDocument();
  });

  it("renders nothing for an implementation run", () => {
    const { container } = render(
      <AssemblyRunOptions
        run={buildRun({ blueprintName: "implementation" })}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a code-review run without a PR number", () => {
    const { container } = render(
      <AssemblyRunOptions run={buildRun({ prNumber: null, prUrl: null })} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders the assembly line upgrade action when a newer version exists", () => {
    render(
      <AssemblyRunOptions run={buildRun({ id: "old-run" })} upgradeAvailable />,
    );

    expect(
      screen.getByRole("button", { name: "Upgrade assembly line" }),
    ).toBeInTheDocument();
  });
});
