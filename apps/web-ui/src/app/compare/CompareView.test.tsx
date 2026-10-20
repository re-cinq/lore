// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AssemblyRun, AssemblyRunNode } from "@/lib/assembly-run-rows";
import CompareView, { type CompareSide } from "./CompareView";

vi.mock("@/components/Icon", () => ({
  default: ({ name }: { name: string }) => <i data-testid={`icon-${name}`} />,
}));

const NOW = Date.parse("2026-10-20T12:00:00.000Z");

const run = (id: string, over: Partial<AssemblyRun> = {}): AssemblyRun => ({
  id,
  blueprintName: "implementation-loop",
  graph: null,
  taskId: null,
  repo: "re-cinq/lore",
  branch: "lore/loop/42",
  status: "finished",
  outcome: "pr_created",
  reason: null,
  createdAt: "2026-10-20T10:00:00.000Z",
  startedAt: null,
  durationSeconds: 600,
  prUrl: null,
  prNumber: 42,
  issueUrl: null,
  issueNumber: null,
  createdBy: "muemich",
  costUsd: null,
  ...over,
});

const visit = (nodeId: string, durationSeconds: number): AssemblyRunNode => ({
  nodeId,
  iteration: 1,
  outcome: "success",
  agentCrName: null,
  commitSha: null,
  durationSeconds,
});

const side = (id: string, seconds: number): CompareSide => ({
  run: run(id),
  nodes: [visit("tdd-round", seconds)],
  tokens: { input: 1000, output: 500, total: 1500 },
});

const A = side("aaaaaaaa-1", 300);
const B = side("bbbbbbbb-2", 120);

describe("CompareView", () => {
  it("points to the run list when no run is chosen", () => {
    render(<CompareView a={null} b={null} candidates={[]} nowMs={NOW} />);

    expect(
      screen.getByRole("link", { name: "Browse assembly runs" }),
    ).toHaveAttribute("href", "/assembly-runs");
  });

  it("offers the other runs of A's line as chips that keep A", () => {
    render(
      <CompareView
        a={A}
        b={null}
        candidates={[run("cccccccc-3")]}
        nowMs={NOW}
      />,
    );

    expect(screen.getByRole("link", { name: "#cccccccc" })).toHaveAttribute(
      "href",
      "/compare?a=aaaaaaaa-1&b=cccccccc-3",
    );
  });

  it("keeps the picked B as the active chip when it is not among the candidates", () => {
    render(
      <CompareView
        a={A}
        b={B}
        candidates={[run("cccccccc-3")]}
        nowMs={NOW}
      />,
    );

    expect(
      screen.getByRole("link", { name: `#${B.run.id.slice(0, 8)}` }),
    ).toHaveAttribute("href", `/compare?a=aaaaaaaa-1&b=${B.run.id}`);
  });

  it("draws the time per station for both runs with the difference A − B", () => {
    render(<CompareView a={A} b={B} candidates={[]} nowMs={NOW} />);

    expect(screen.getByTestId("station-tdd-round")).toHaveTextContent("+3m 0s");
    expect(
      screen.getByText(/A spent 3m 0s longer at tdd-round/),
    ).toBeInTheDocument();
  });

  it("sets the two runs' token counts side by side", () => {
    render(<CompareView a={A} b={B} candidates={[]} nowMs={NOW} />);

    expect(screen.getByRole("row", { name: /Tokens/ })).toHaveTextContent(
      "Tokens1.5k1.5k",
    );
  });
});
