// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { entityOf } = await import("./entities");

const edge = (over: Record<string, unknown>) => ({
  source_name: "lore-api",
  source_type: "service",
  relation_type: "uses",
  target_name: "postgres",
  target_type: "technology",
  valid_from: "2026-09-01T00:00:00.000Z",
  valid_to: null,
  source_label: "episode",
  ...over,
});

describe("entityOf", () => {
  it("answers null when neither an entity row nor an edge names it", () => {
    expect(entityOf("ghost", { entities: [], edges: [] }, [])).toBeNull();
  });

  it("reads each edge from the entity's side, newest first, counting only the ones that still hold", () => {
    const edges = [
      edge({ valid_to: "2026-09-10T00:00:00.000Z" }),
      edge({
        source_name: "stations",
        target_name: "postgres",
        valid_from: "2026-10-01T00:00:00.000Z",
      }),
    ];
    const entity = entityOf("postgres", { entities: [], edges }, []);

    expect(entity?.relationships.map((r) => [r.direction, r.other])).toEqual([
      ["in", "stations"],
      ["in", "lore-api"],
    ]);
    expect(entity?.activeCount).toBe(1);
  });

  it("takes the type from an edge when the browse page did not carry the entity row", () => {
    const entity = entityOf(
      "lore-api",
      { entities: [], edges: [edge({})] },
      [],
    );

    expect(entity?.type).toBe("service");
  });

  it("turns each memory hit into a fact with its source and agent", () => {
    const hits = [
      {
        key: "k1",
        value: "lore-api owns the SQL",
        source: "fact",
        agent_id: "agent-1",
      },
    ];
    const entity = entityOf(
      "lore-api",
      { entities: [], edges: [edge({})] },
      hits,
    );

    expect(entity?.facts).toEqual([
      {
        key: "k1",
        text: "lore-api owns the SQL",
        source: "fact",
        agentId: "agent-1",
      },
    ]);
  });
});
