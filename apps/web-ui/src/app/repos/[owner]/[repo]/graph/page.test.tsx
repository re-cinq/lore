// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/trace-api", () => ({
  fetchTraceSpecs: vi.fn(),
  fetchTraceGraph: vi.fn(),
  fetchProjectionCommits: vi.fn(),
}));

vi.mock("./GraphView", () => ({
  default: ({ graph }: { graph: { nodes: unknown[] } }) => (
    <div data-testid="graph-view" data-nodes={graph.nodes.length} />
  ),
}));

import {
  fetchTraceSpecs,
  fetchTraceGraph,
  fetchProjectionCommits,
} from "@/lib/trace-api";
import RepoGraphPage from "./page";

describe("RepoGraphPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchProjectionCommits).mockResolvedValue({
      specs: "abc1234",
      adrs: null,
      testReport: "def5678",
    });
  });

  it("fetches the first spec's bounded graph when no path query param is given", async () => {
    vi.mocked(fetchTraceSpecs).mockResolvedValue([
      "specs/auth/spec.md",
      "specs/pay/spec.md",
    ]);
    vi.mocked(fetchTraceGraph).mockResolvedValue({
      nodes: [{ id: "0x1", type: "Spec", label: "auth" }],
      links: [],
    });

    render(
      await RepoGraphPage({
        params: Promise.resolve({ owner: "o", repo: "r" }),
      }),
    );

    expect(fetchTraceGraph).toHaveBeenCalledWith("o/r", "specs/auth/spec.md");
    expect(screen.getByTestId("graph-view")).toHaveAttribute("data-nodes", "1");
  });

  it("fetches the requested spec's bounded graph when path matches a repo spec", async () => {
    vi.mocked(fetchTraceSpecs).mockResolvedValue([
      "specs/auth/spec.md",
      "specs/pay/spec.md",
    ]);
    vi.mocked(fetchTraceGraph).mockResolvedValue({
      nodes: [{ id: "0x2", type: "Spec", label: "pay" }],
      links: [],
    });

    render(
      await RepoGraphPage({
        params: Promise.resolve({ owner: "o", repo: "r" }),
        searchParams: Promise.resolve({ path: "specs/pay/spec.md" }),
      }),
    );

    expect(fetchTraceGraph).toHaveBeenCalledWith("o/r", "specs/pay/spec.md");
  });

  it("renders the empty state without calling fetchTraceGraph when the repo has no specs", async () => {
    vi.mocked(fetchTraceSpecs).mockResolvedValue([]);

    render(
      await RepoGraphPage({
        params: Promise.resolve({ owner: "o", repo: "r" }),
      }),
    );

    expect(fetchTraceGraph).not.toHaveBeenCalled();
  });
});
