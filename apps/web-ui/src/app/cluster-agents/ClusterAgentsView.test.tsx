// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ClusterAgentsView, { formatElapsed } from "./ClusterAgentsView";
import type {
  ClusterAgentRow,
  ClusterOfflineEvent,
} from "@/lib/api/cluster-agents";

const agent = (over: Partial<ClusterAgentRow>): ClusterAgentRow => ({
  id: "agent-1",
  name: "minikube",
  tags: ["node:agent"],
  status: "active",
  paused: false,
  last_seen_at: "2026-08-26T10:00:00.000Z",
  running_claims: 0,
  ...over,
});

const offlineEvent = (
  over: Partial<ClusterOfflineEvent>,
): ClusterOfflineEvent => ({
  created_at: "2026-08-26T09:00:00.000Z",
  cluster_agent_id: "agent-1",
  station_run_id: "sr-1",
  assembly_run_id: "0f2b7c1a-0000-4000-8000-000000000001",
  node_id: "implement",
  elapsed_since_claim_ms: 90_000,
  ...over,
});

describe("ClusterAgentsView", () => {
  it("binds each row's Pause button to that row's agent id", async () => {
    // The prop must be BOUND, never wrapped in an inline arrow: this view is a
    // server component, and React refuses to serialize a plain closure to a
    // client component — which took the whole page down in production once.
    // Binding is also what keeps the id server-side.
    const calls: Array<[string, boolean]> = [];

    render(
      <ClusterAgentsView
        installInfo={null}
        togglePaused={async (id, paused) => {
          calls.push([id, paused]);
        }}
        agents={[
          agent({ id: "a", name: "minikube" }),
          agent({ id: "b", name: "eu-west4", paused: true }),
        ]}
        offlineEvents={[]}
      />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Pause" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "Resume" })[0]);
    await waitFor(() => expect(calls).toHaveLength(2));

    expect(calls).toEqual([
      ["a", true],
      ["b", false],
    ]);
  });

  it("renders one row per agent with name, tag chips and claim count", () => {
    render(
      <ClusterAgentsView
        installInfo={null}
        togglePaused={async () => {}}
        agents={[
          agent({ id: "a", name: "minikube", tags: ["node:agent", "gpu"] }),
          agent({
            id: "b",
            name: "eu-west4",
            tags: ["region:eu"],
            running_claims: 3,
          }),
        ]}
        offlineEvents={[]}
      />,
    );

    expect(screen.getByText("minikube")).toBeInTheDocument();
    expect(screen.getByText("node:agent")).toBeInTheDocument();
    expect(screen.getByText("gpu")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "3" })).toHaveAttribute(
      "href",
      "/assembly-runs?cluster_agent_id=b",
    );
  });

  it("marks an offline agent with badge-red and an active one with badge-green", () => {
    render(
      <ClusterAgentsView
        installInfo={null}
        togglePaused={async () => {}}
        agents={[
          agent({ id: "a", name: "alive", status: "active" }),
          agent({ id: "b", name: "dead", status: "offline" }),
        ]}
        offlineEvents={[]}
      />,
    );

    expect(screen.getByText("active")).toHaveClass("badge-green");
    expect(screen.getByText("offline")).toHaveClass("badge-red");
  });

  it("shows the no-clusters empty state when the registry is empty", () => {
    render(
      <ClusterAgentsView
        agents={[]}
        offlineEvents={[]}
        installInfo={null}
        togglePaused={async () => {}}
      />,
    );

    expect(screen.getByText("No clusters registered")).toBeInTheDocument();
    expect(screen.getByText("No offline events recorded.")).toBeInTheDocument();
  });

  it("renders an offline event with resolved cluster name, held-for 1m 30s and a run link", () => {
    render(
      <ClusterAgentsView
        installInfo={null}
        togglePaused={async () => {}}
        agents={[agent({ id: "agent-1", name: "minikube" })]}
        offlineEvents={[offlineEvent({})]}
      />,
    );

    const row = screen.getByRole("link", { name: "0f2b7c1a" });

    expect(row).toHaveAttribute(
      "href",
      "/assembly-runs/0f2b7c1a-0000-4000-8000-000000000001",
    );
    expect(screen.getByText("implement")).toBeInTheDocument();
    expect(screen.getByText("1m 30s")).toBeInTheDocument();
    expect(screen.getAllByText("minikube")).toHaveLength(2);
  });

  it("falls back to the raw agent id when the offline event's cluster left the registry", () => {
    render(
      <ClusterAgentsView
        installInfo={null}
        togglePaused={async () => {}}
        agents={[]}
        offlineEvents={[
          offlineEvent({
            cluster_agent_id: "gone-agent-id",
            assembly_run_id: null,
            node_id: null,
            elapsed_since_claim_ms: null,
          }),
        ]}
      />,
    );

    expect(screen.getByText("gone-agent-id")).toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(3);
  });

  it("renders — for an event with no cluster_agent_id and 0 without a link for an idle agent", () => {
    render(
      <ClusterAgentsView
        installInfo={null}
        togglePaused={async () => {}}
        agents={[agent({ id: "a", name: "idle", tags: [], running_claims: 0 })]}
        offlineEvents={[offlineEvent({ cluster_agent_id: null })]}
      />,
    );

    expect(screen.queryByRole("link", { name: "0" })).toBeNull();
    expect(screen.getByRole("cell", { name: "0" })).toBeInTheDocument();
  });
});

describe("formatElapsed", () => {
  it("returns 45s under a minute", () => {
    expect(formatElapsed(45_000)).toEqual("45s");
  });

  it("returns 12m 5s over a minute", () => {
    expect(formatElapsed(725_000)).toEqual("12m 5s");
  });
});
