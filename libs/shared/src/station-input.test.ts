import { describe, it, expect } from "vitest";
import {
  parseStationInput,
  serializeStationInput,
  type StationInput,
} from "./station-input.js";

// This used to live beside the pod entrypoint, next to a SECOND declaration of the
// shape, with a comment asking whoever edited it to keep two fixtures "in
// lockstep" by hand. One module owns the shape now, so lockstep is the type
// system's job rather than a reader's.
const floorEmitted = JSON.stringify({
  assembly_run_id: "a1b2c3d4e5f6a7b8",
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
      assembly_run_id: "a1b2c3d4e5f6a7b8",
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

describe("serializeStationInput", () => {
  const input: StationInput = {
    assembly_run_id: "a1b2c3d4e5f6a7b8",
    node_id: "validate",
    node_type: "validate",
    repo: "re-cinq/lore",
    branch: "lore/impl-abcdef12",
    task_id: null,
    params: { validator: "all" },
  };

  it("round-trips through the reader, which is what makes the two sides one", () => {
    // The drift this replaces: the Floor spelled the shape in an object literal
    // and the pod re-spelled it in a schema, so a rename on one side passed both
    // suites and failed every station run. Writing and reading through the same
    // module makes that a compile error.
    expect(parseStationInput(serializeStationInput(input))).toEqual(input);
  });

  it("rejects an input the contract forbids, at DISPATCH rather than inside a pod", () => {
    // An empty repo is a Floor bug. Learning it here beats learning it from a
    // pod's logs after the run has already been dispatched and charged for.
    expect(() => serializeStationInput({ ...input, repo: "" })).toThrow();
  });
});

describe("the run-id dual-key window (FR6.41 readers-first)", () => {
  it("parses a pre-flip pod input carrying only assembly_line_id", () => {
    const legacy = JSON.stringify({
      assembly_line_id: "al-legacy",
      node_id: "validate",
      node_type: "validate",
      repo: "re-cinq/lore",
      branch: "b",
      task_id: null,
    });

    expect(parseStationInput(legacy)).toMatchObject({
      assembly_run_id: "al-legacy",
    });
  });

  it("serializes both spellings so the neighbouring release parses either", () => {
    const wire = JSON.parse(
      serializeStationInput({
        assembly_run_id: "al-9",
        node_id: "n",
        node_type: "validate",
        repo: "o/r",
        branch: "b",
        task_id: null,
        params: {},
      }),
    ) as Record<string, unknown>;

    expect(wire).toMatchObject({
      assembly_run_id: "al-9",
      assembly_line_id: "al-9",
    });
  });

  it("refuses an input naming the run under neither spelling", () => {
    expect(() =>
      parseStationInput(
        JSON.stringify({
          node_id: "n",
          node_type: "validate",
          repo: "o/r",
          branch: "b",
          task_id: null,
        }),
      ),
    ).toThrow();
  });
});
