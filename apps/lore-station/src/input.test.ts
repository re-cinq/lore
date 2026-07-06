import { describe, it, expect } from "vitest";
import { parseStationInput } from "./input.js";

// Mirrors exactly what the Floor's nodeStationSpec emits (see
// apps/floor/src/jobs/assembly-line/floor-assembly-line.test.ts — the two
// fixtures must stay in lockstep; the contract is station-contract.md).
const floorEmitted = JSON.stringify({
  assembly_line_id: "a1b2c3d4e5f6a7b8",
  node_id: "validate",
  node_type: "validate",
  repo: "re-cinq/lore",
  branch: "lore/impl-abcdef12",
  task_id: "abcdef1234567890",
  params: { validator: "all" },
});

describe("parseStationInput", () => {
  it("parses the Floor's station_input JSON", () => {
    expect(parseStationInput(floorEmitted)).toEqual({
      assembly_line_id: "a1b2c3d4e5f6a7b8",
      node_id: "validate",
      node_type: "validate",
      repo: "re-cinq/lore",
      branch: "lore/impl-abcdef12",
      task_id: "abcdef1234567890",
      params: { validator: "all" },
    });
  });

  it("defaults params to empty and allows a null task_id (detection runs)", () => {
    const input = parseStationInput(
      JSON.stringify({
        assembly_line_id: "al-1",
        node_id: "detect",
        node_type: "detect",
        repo: "re-cinq/lore",
        branch: "detect/spec-drift/re-cinq/lore",
        task_id: null,
      }),
    );
    expect(input).toMatchObject({ task_id: null, params: {} });
  });

  it("throws on malformed JSON or missing required fields", () => {
    expect(() => parseStationInput("{nope")).toThrow();
    expect(() => parseStationInput(JSON.stringify({ node_id: "x" }))).toThrow();
  });
});
