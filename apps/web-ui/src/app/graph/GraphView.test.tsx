// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import GraphView, { type Entity, type Edge, type Stats } from "./GraphView";

const stats: Stats = {
  entity_count: 12,
  active_edge_count: 34,
  invalidated_edge_count: 5,
};

const entityRow = (over: Partial<Entity>): Entity => ({
  id: "e1",
  name: "lore-agent",
  entity_type: "service",
  repo: "re-cinq/lore",
  edge_count: 3,
  updated_at: "2026-06-03T10:00:00Z",
  ...over,
});

const edgeRow = (over: Partial<Edge>): Edge => ({
  source_name: "lore-agent",
  source_type: "service",
  relation_type: "depends_on",
  target_name: "postgres",
  target_type: "technology",
  valid_from: "2026-06-01T10:00:00Z",
  valid_to: null,
  source_label: "episode",
  ...over,
});

describe("GraphView", () => {
  it("renders the three stat cards from the stats view-model", () => {
    render(
      <GraphView
        showInvalid={false}
        stats={stats}
        entityTypes={[]}
        entities={[]}
        edges={[]}
      />,
    );
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("34")).toBeInTheDocument();
    expect(screen.getByText("Active edges")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("Invalidated edges")).toBeInTheDocument();
  });

  it("renders the type filter row with the all badge active when no type is selected", () => {
    render(
      <GraphView
        showInvalid={false}
        stats={stats}
        entityTypes={[{ entity_type: "service", cnt: 7 }]}
        entities={[]}
        edges={[]}
      />,
    );
    expect(screen.getByText("all")).toHaveClass("op-search");
    const serviceBadge = screen.getByText("service (7)");

    expect(serviceBadge).toBeInTheDocument();
    expect(serviceBadge).not.toHaveClass("op-search");
    expect(serviceBadge.getAttribute("href")).toEqual("/graph?type=service");
  });

  it("marks the matching type badge active and the all badge inactive when a type is selected", () => {
    render(
      <GraphView
        type="service"
        showInvalid={false}
        stats={stats}
        entityTypes={[{ entity_type: "service", cnt: 7 }]}
        entities={[]}
        edges={[]}
      />,
    );
    expect(screen.getByText("all")).not.toHaveClass("op-search");
    expect(screen.getByText("service (7)")).toHaveClass("op-search");
  });

  it("hides the type filter row when there are no entity types", () => {
    render(
      <GraphView
        showInvalid={false}
        stats={stats}
        entityTypes={[]}
        entities={[]}
        edges={[]}
      />,
    );
    expect(screen.queryByText("all")).not.toBeInTheDocument();
  });

  it("renders an entity row with name, type badge, repo, edge count and explore link", () => {
    render(
      <GraphView
        type="service"
        showInvalid={false}
        stats={stats}
        entityTypes={[]}
        entities={[entityRow({})]}
        edges={[]}
      />,
    );
    expect(screen.getByText("lore-agent")).toBeInTheDocument();
    expect(screen.getByText("service")).toBeInTheDocument();
    expect(screen.getByText("re-cinq/lore")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    const explore = screen.getByText("explore");

    expect(explore.getAttribute("href")).toEqual(
      "/graph?entity=lore-agent&type=service",
    );
  });

  it("renders an em-dash placeholder when an entity has no repo", () => {
    render(
      <GraphView
        showInvalid={false}
        stats={stats}
        entityTypes={[]}
        entities={[entityRow({ repo: null })]}
        edges={[]}
      />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("omits the type query param from the explore link when no type filter is active", () => {
    render(
      <GraphView
        showInvalid={false}
        stats={stats}
        entityTypes={[]}
        entities={[entityRow({})]}
        edges={[]}
      />,
    );
    expect(screen.getByText("explore").getAttribute("href")).toEqual(
      "/graph?entity=lore-agent",
    );
  });

  it("shows the entities empty state when there are no entities", () => {
    render(
      <GraphView
        showInvalid={false}
        stats={stats}
        entityTypes={[]}
        entities={[]}
        edges={[]}
      />,
    );
    expect(
      screen.getByText(
        "No entities yet. Write episodes to populate the graph.",
      ),
    ).toBeInTheDocument();
  });

  it("does not render the relationships section when no entity is selected", () => {
    render(
      <GraphView
        showInvalid={false}
        stats={stats}
        entityTypes={[]}
        entities={[entityRow({})]}
        edges={[]}
      />,
    );
    expect(screen.queryByText(/Relationships for/)).not.toBeInTheDocument();
  });

  it("renders the relationships section with a Show invalidated toggle when an entity is selected", () => {
    render(
      <GraphView
        entity="lore-agent"
        showInvalid={false}
        stats={stats}
        entityTypes={[]}
        entities={[entityRow({})]}
        edges={[edgeRow({})]}
      />,
    );
    expect(
      screen.getByText('Relationships for "lore-agent"'),
    ).toBeInTheDocument();
    const toggle = screen.getByText("Show invalidated edges");

    expect(toggle.getAttribute("href")).toEqual(
      "/graph?entity=lore-agent&show_invalid=1",
    );
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("depends_on")).toBeInTheDocument();
  });

  it("renders the Hide invalidated toggle and an invalidated badge when showInvalid is true", () => {
    render(
      <GraphView
        entity="lore-agent"
        showInvalid={true}
        stats={stats}
        entityTypes={[]}
        entities={[entityRow({})]}
        edges={[edgeRow({ valid_to: "2026-06-02T10:00:00Z" })]}
      />,
    );
    const toggle = screen.getByText("Hide invalidated");

    expect(toggle.getAttribute("href")).toEqual("/graph?entity=lore-agent");
    expect(screen.getByText(/^invalidated/)).toBeInTheDocument();
  });

  it("shows the relationships empty state when a selected entity has no edges", () => {
    render(
      <GraphView
        entity="lore-agent"
        showInvalid={false}
        stats={stats}
        entityTypes={[]}
        entities={[entityRow({})]}
        edges={[]}
      />,
    );
    expect(
      screen.getByText("No relationships found for this entity."),
    ).toBeInTheDocument();
  });
});
