// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import AgentDetailView, { MemoryViewRow } from "./AgentDetailView";

const fullMemory: MemoryViewRow = {
  id: "mem-1",
  key: "deployment-gotchas-2026",
  value: "always set the env var",
  version: 3,
  created_at: "2026-06-01T10:00:00.000Z",
  ttl_seconds: 3600,
  has_facts: true,
  versions: [
    {
      version: 3,
      value: "always set the env var",
      created_at: "2026-06-01T10:00:00.000Z",
    },
    {
      version: 2,
      value: "maybe set the env var",
      created_at: "2026-05-30T10:00:00.000Z",
    },
    {
      version: 1,
      value: "env var unknown",
      created_at: "2026-05-29T10:00:00.000Z",
    },
  ],
  facts: [
    {
      fact_text: "The agent runs on GKE",
      created_at: "2026-06-01T10:00:00.000Z",
    },
    { fact_text: "The DB is Postgres", created_at: "2026-06-01T10:00:00.000Z" },
  ],
};

const minimalMemory: MemoryViewRow = {
  id: "mem-2",
  key: "one-off-note",
  value: "transient observation",
  version: 1,
  created_at: "2026-06-02T12:00:00.000Z",
  ttl_seconds: null,
  has_facts: false,
  versions: [
    {
      version: 1,
      value: "transient observation",
      created_at: "2026-06-02T12:00:00.000Z",
    },
  ],
  facts: [],
};

describe("AgentDetailView", () => {
  it("renders truncated agent id and memory count", () => {
    render(
      <AgentDetailView
        agentId="abcdefghijklmnopqrstuvwxyz"
        memoryCount={2}
        memories={[fullMemory, minimalMemory]}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Agent: abcdefghijkl...",
    );
    expect(screen.getByText("2 memories")).toBeInTheDocument();
  });

  it("renders key, version meta, facts badge and TTL badge for a full memory", () => {
    render(
      <AgentDetailView
        agentId="agent-x"
        memoryCount={1}
        memories={[fullMemory]}
      />,
    );
    expect(screen.getByText("deployment-gotchas-2026")).toBeInTheDocument();
    expect(screen.getByText("facts")).toBeInTheDocument();
    expect(screen.getByText("TTL: 3600s")).toBeInTheDocument();
    expect(screen.getByText(/^v3 ·/)).toBeInTheDocument();
  });

  it("renders current value and version history when more than one version", () => {
    render(
      <AgentDetailView
        agentId="agent-x"
        memoryCount={1}
        memories={[fullMemory]}
      />,
    );
    expect(screen.getByText("Current Value")).toBeInTheDocument();
    expect(screen.getByText("Version History (3)")).toBeInTheDocument();
    expect(screen.getByText(/^v2 —/)).toBeInTheDocument();
    expect(screen.getByText(/^v1 —/)).toBeInTheDocument();
    expect(screen.getByText("maybe set the env var")).toBeInTheDocument();
  });

  it("renders extracted facts list when facts present", () => {
    render(
      <AgentDetailView
        agentId="agent-x"
        memoryCount={1}
        memories={[fullMemory]}
      />,
    );
    expect(screen.getByText("Extracted Facts (2)")).toBeInTheDocument();
    const list = screen.getByRole("list");
    expect(within(list).getByText("The agent runs on GKE")).toBeInTheDocument();
    expect(within(list).getByText("The DB is Postgres")).toBeInTheDocument();
  });

  it("omits version history, facts badge, TTL badge and facts section for a minimal memory", () => {
    render(
      <AgentDetailView
        agentId="agent-x"
        memoryCount={1}
        memories={[minimalMemory]}
      />,
    );
    expect(screen.getByText("one-off-note")).toBeInTheDocument();
    expect(screen.getByText("Current Value")).toBeInTheDocument();
    expect(screen.queryByText("facts")).not.toBeInTheDocument();
    expect(screen.queryByText(/^TTL:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Version History/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Extracted Facts/)).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("renders empty state with zero memories and no cards", () => {
    render(
      <AgentDetailView agentId="agent-empty" memoryCount={0} memories={[]} />,
    );
    expect(screen.getByText("0 memories")).toBeInTheDocument();
    expect(screen.queryByText("Current Value")).not.toBeInTheDocument();
  });
});
