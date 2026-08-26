import { describe, it, expect } from "vitest";
import { parseAssemblyLine } from "./loader.js";
import { snapshotGraph } from "./snapshot-graph.js";

const YAML = `
name: demo
description: a demo line
version: 1
entry: implement
exit: done
nodes:
  - id: implement
    type: agent
    prompt_ref: implementation
    model: claude-sonnet-4-6
    required_tags: ["gpu"]
    description: write the code
  - id: check
    type: validate
    station_ref: custom-validate
    timeout_minutes: 5
    job_ref: quick-checks
  - id: done
    type: retrospective
edges:
  - from: implement
    to: check
    on: success
  - from: check
    to: implement
    on: failed
    iteration_max: 2
  - from: check
    to: done
    on: success
  - from: implement
    to: done
    on: failed
  - from: implement
    to: done
    on: changes_requested
`;

const graph = () => snapshotGraph(parseAssemblyLine(YAML), "demo");

describe("snapshotGraph", () => {
  it("carries the blueprint's identity and its entry and exit", () => {
    expect(graph()).toMatchObject({
      name: "demo",
      entry: "implement",
      exit: "done",
    });
  });

  it("resolves an inherited station at clone time, flagged as inherited", () => {
    // The whole point: an agent node with no station_ref runs the recipe named
    // after its LINE, and re-deriving that on every read is what let three nodes
    // silently run the planning prompt.
    expect(graph().nodes[0]).toMatchObject({
      id: "implement",
      type: "agent",
      station: "demo",
      station_inherited: true,
    });
  });

  it("keeps a node's own station_ref and marks it not inherited", () => {
    expect(graph().nodes[1]).toMatchObject({
      id: "check",
      station: "custom-validate",
      station_inherited: false,
    });
  });

  it("gives a retrospective node the builtin station for its type", () => {
    expect(graph().nodes[2]).toMatchObject({
      id: "done",
      station: "def-retrospective",
      station_inherited: true,
    });
  });

  it("carries the fields a run needs to dispatch a node", () => {
    expect(graph().nodes[0]).toMatchObject({
      prompt_ref: "implementation",
      model: "claude-sonnet-4-6",
    });
    expect(graph().nodes[1]).toMatchObject({ timeout_minutes: 5 });
  });

  it("carries a node's required_tags into the clone so the enqueue can read them", () => {
    expect(graph().nodes[0]).toMatchObject({ required_tags: ["gpu"] });
    expect(graph().nodes[1].required_tags).toBeUndefined();
  });

  it("carries the knobs a station pod receives as params", () => {
    // The Floor reads job_ref / condition_ref straight off the node into the pod's
    // params, so a clone that dropped them would dispatch a station with no input.
    // (`validator` used to be one of these and was removed in #1051 — nothing ever
    // read it.)
    expect(graph().nodes[1]).toMatchObject({ job_ref: "quick-checks" });
  });

  it("carries every edge with its condition and iteration budget", () => {
    expect(graph().edges).toContainEqual({
      from: "check",
      to: "implement",
      on: "failed",
      iteration_max: 2,
    });
    expect(graph().edges).toContainEqual({
      from: "implement",
      to: "check",
      on: "success",
    });
  });

  it("round-trips through JSON, since the clone is stored as jsonb", () => {
    expect(JSON.parse(JSON.stringify(graph()))).toEqual(graph());
  });
});
