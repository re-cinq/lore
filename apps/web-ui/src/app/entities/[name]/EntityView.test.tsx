// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { EntityDetail } from "@/lib/api/entities";
import EntityView from "./EntityView";

vi.mock("@/components/Icon", () => ({
  default: ({ name }: { name: string }) => <i data-testid={`icon-${name}`} />,
}));

const ENTITY: EntityDetail = {
  name: "postgres",
  type: "technology",
  repo: "re-cinq/lore",
  activeCount: 1,
  relationships: [
    {
      relation: "uses",
      direction: "in",
      other: "lore-api",
      otherType: "service",
      since: "2026-09-01T00:00:00.000Z",
      until: null,
      from: "episode",
    },
    {
      relation: "replaces",
      direction: "out",
      other: "alloydb",
      otherType: "technology",
      since: "2026-08-01T00:00:00.000Z",
      until: "2026-08-20T00:00:00.000Z",
      from: "memory",
    },
  ],
  facts: [
    {
      key: "db-notes",
      text: "pgvector holds the embeddings",
      source: "fact",
      agentId: "agent-123456789",
    },
  ],
};

describe("EntityView", () => {
  it("heads the page with the entity's type, repo, active count and a link back to the graph", () => {
    render(<EntityView name="postgres" entity={ENTITY} />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "postgres",
    );
    expect(
      screen.getByText("re-cinq/lore · 1 active relationships"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open in graph/ })).toHaveAttribute(
      "href",
      "/graph?entity=postgres",
    );
  });

  it("marks a relationship that stopped holding as ended and links every other end to its own page", () => {
    render(<EntityView name="postgres" entity={ENTITY} />);

    expect(screen.getByText("ended")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "alloydb" })).toHaveAttribute(
      "href",
      "/entities/alloydb",
    );
  });

  it("lists what memory holds about the entity", () => {
    render(<EntityView name="postgres" entity={ENTITY} />);

    expect(
      screen.getByText("pgvector holds the embeddings"),
    ).toBeInTheDocument();
  });

  it("says the graph has no such entity instead of failing", () => {
    render(<EntityView name="ghost" entity={null} />);

    expect(
      screen.getByText('The graph holds no entity called "ghost"'),
    ).toBeInTheDocument();
  });
});
