import { describe, it, expect } from "vitest";
import { definitionHash } from "./definition-hash.js";
import type { AssemblyLine } from "./loader.js";

function line(overrides: Partial<AssemblyLine> = {}): AssemblyLine {
  return {
    name: "implementation",
    description: "implement a spec",
    version: 1,
    entry: "implement",
    exit: "done",
    nodes: [
      { id: "implement", type: "agent", prompt_ref: "implementation" },
      { id: "done", type: "gate" },
    ],
    edges: [{ from: "implement", to: "done", on: "always" }],
    ...overrides,
  };
}

describe("definitionHash", () => {
  it("returns a 64-character lowercase hex digest", () => {
    expect(definitionHash(line())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns the same digest for two structurally identical definitions", () => {
    expect(definitionHash(line())).toBe(definitionHash(line()));
  });

  it("ignores key ordering, so a reordered parse of the same definition hashes equal", () => {
    const reordered = {
      edges: [{ on: "always", to: "done", from: "implement" }],
      exit: "done",
      entry: "implement",
      nodes: [
        { prompt_ref: "implementation", type: "agent", id: "implement" },
        { type: "gate", id: "done" },
      ],
      version: 1,
      description: "implement a spec",
      name: "implementation",
    } as unknown as AssemblyLine;

    expect(definitionHash(reordered)).toBe(definitionHash(line()));
  });

  it("ignores explicitly-undefined optional fields, which zod may or may not attach", () => {
    const withUndefined = {
      ...line(),
      nodes: [
        {
          id: "implement",
          type: "agent",
          prompt_ref: "implementation",
          model: undefined,
        },
        { id: "done", type: "gate", station_ref: undefined },
      ],
    } as unknown as AssemblyLine;

    expect(definitionHash(withUndefined)).toBe(definitionHash(line()));
  });

  it("changes when a node changes", () => {
    const edited = line({
      nodes: [
        { id: "implement", type: "agent", prompt_ref: "implementation-v2" },
        { id: "done", type: "gate" },
      ],
    });

    expect(definitionHash(edited)).not.toBe(definitionHash(line()));
  });

  it("changes when an edge changes", () => {
    const edited = line({
      edges: [
        { from: "implement", to: "done", on: "success" },
        { from: "implement", to: "implement", on: "failed", iteration_max: 2 },
      ],
    });

    expect(definitionHash(edited)).not.toBe(definitionHash(line()));
  });

  it("changes when the entry or exit node changes", () => {
    expect(definitionHash(line({ entry: "done" }))).not.toBe(
      definitionHash(line()),
    );
    expect(definitionHash(line({ exit: "implement" }))).not.toBe(
      definitionHash(line()),
    );
  });

  it("distinguishes a nested value from the string that spells it", () => {
    const stringified = line({
      nodes: [
        {
          id: "implement",
          type: "agent",
          prompt_ref: '[{"id":"implement","type":"agent"}]',
        },
        { id: "done", type: "gate" },
      ],
    });

    expect(definitionHash(stringified)).not.toBe(definitionHash(line()));
  });
});

describe("definitionHash ignores prose but not order", () => {
  it("ignores a reworded description, at the top level and on a node", () => {
    const reworded = line({
      description: "a completely different sentence",
      nodes: [
        {
          id: "implement",
          type: "agent",
          prompt_ref: "implementation",
          description: "newly documented",
        },
        { id: "done", type: "gate", description: "also new" },
      ],
    });

    expect(definitionHash(reworded)).toBe(definitionHash(line()));
  });

  it("changes when edges are reordered, because the first candidate can win", () => {
    const forward = line({
      edges: [
        { from: "implement", to: "done", on: "always" },
        { from: "implement", to: "implement", on: "always" },
      ],
    });
    const reversed = line({
      edges: [
        { from: "implement", to: "implement", on: "always" },
        { from: "implement", to: "done", on: "always" },
      ],
    });

    expect(definitionHash(forward)).not.toBe(definitionHash(reversed));
  });
});
