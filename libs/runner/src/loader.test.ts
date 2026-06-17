import { describe, it, expect } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  parseWorkflow,
  loadWorkflowDir,
  WorkflowLoadError,
} from "./loader.js";

const linearGraph = `
name: gap-fill
description: A linear flow
version: 1
entry: a
exit: c
nodes:
  - id: a
    type: agent
    prompt_ref: gap-fill
  - id: b
    type: validate
    validator: all
  - id: c
    type: retrospective
edges:
  - from: a
    to: b
    on: success
  - from: b
    to: c
    on: always
`;

describe("parseWorkflow", () => {
  it("accepts a valid linear workflow", () => {
    const wf = parseWorkflow(linearGraph);
    expect(wf.name).toBe("gap-fill");
    expect(wf.nodes).toHaveLength(3);
    expect(wf.entry).toBe("a");
    expect(wf.exit).toBe("c");
  });

  it("rejects malformed YAML", () => {
    expect(() => parseWorkflow("name: x\n  - this: is: bad")).toThrow(
      WorkflowLoadError,
    );
  });

  it("rejects schema violations", () => {
    expect(() =>
      parseWorkflow(`
name: x
description: d
version: 1
entry: a
exit: a
nodes:
  - id: a
    type: not-a-real-type
edges: []
`),
    ).toThrow(/Schema violation/);
  });

  it("rejects entry pointing to unknown node", () => {
    expect(() =>
      parseWorkflow(`
name: x
description: d
version: 1
entry: ghost
exit: a
nodes:
  - id: a
    type: retrospective
edges: []
`),
    ).toThrow(/entry "ghost"/);
  });

  it("rejects edges referencing unknown nodes", () => {
    expect(() =>
      parseWorkflow(`
name: x
description: d
version: 1
entry: a
exit: a
nodes:
  - id: a
    type: retrospective
edges:
  - from: a
    to: ghost
    on: always
`),
    ).toThrow(/unknown node "ghost"/);
  });

  it("rejects unreachable nodes", () => {
    expect(() =>
      parseWorkflow(`
name: x
description: d
version: 1
entry: a
exit: c
nodes:
  - id: a
    type: agent
  - id: b
    type: agent
  - id: c
    type: retrospective
edges:
  - from: a
    to: c
    on: success
`),
    ).toThrow(/"b" is not reachable/);
  });

  it("rejects non-exit nodes with no outgoing edges", () => {
    expect(() =>
      parseWorkflow(`
name: x
description: d
version: 1
entry: a
exit: a
nodes:
  - id: a
    type: retrospective
  - id: b
    type: retrospective
edges:
  - from: a
    to: b
    on: always
`),
    ).toThrow(/"b" has no outgoing edges/);
  });

  it("requires iteration_max on cycles", () => {
    expect(() =>
      parseWorkflow(`
name: x
description: d
version: 1
entry: a
exit: c
nodes:
  - id: a
    type: agent
  - id: b
    type: validate
  - id: c
    type: retrospective
edges:
  - from: a
    to: b
    on: success
  - from: b
    to: a
    on: failed
  - from: b
    to: c
    on: success
`),
    ).toThrow(/back-edge b → a requires iteration_max/);
  });

  it("accepts cycles with iteration_max set", () => {
    const wf = parseWorkflow(`
name: x
description: d
version: 1
entry: a
exit: c
nodes:
  - id: a
    type: agent
  - id: b
    type: validate
  - id: c
    type: retrospective
edges:
  - from: a
    to: b
    on: success
  - from: b
    to: a
    on: failed
    iteration_max: 2
  - from: b
    to: c
    on: success
`);
    expect(wf.edges.find((e) => e.from === "b" && e.to === "a")?.iteration_max).toBe(2);
  });

  it("rejects invalid node id format", () => {
    expect(() =>
      parseWorkflow(`
name: x
description: d
version: 1
entry: A
exit: A
nodes:
  - id: A
    type: retrospective
edges: []
`),
    ).toThrow(/Schema violation/);
  });
});

describe("loadWorkflowDir — bundled workflows", () => {
  // The bundled YAML files live next to the loader. Resolve the
  // workflows directory relative to this test file so this works in
  // both source-tree and dist-tree runs.
  const here = new URL(".", import.meta.url).pathname;
  // The bundled YAMLs are a sibling of this file (src/workflows/), and the
  // build copies them to dist/workflows/ — same relative position either way.
  const workflowsDir = path.resolve(here, "workflows");

  it("loads all bundled workflows without error", async () => {
    const map = await loadWorkflowDir(workflowsDir);
    const names = Array.from(map.keys()).sort();
    expect(names).toEqual([
      "feature-finalize",
      "feature-planning",
      "gap-fill",
      "general",
      "implementation",
    ]);
  });

  it("gap-fill is a linear flow with retrospective + done as exit pair", async () => {
    const map = await loadWorkflowDir(workflowsDir);
    const wf = map.get("gap-fill");
    expect(wf?.entry).toBe("draft");
    expect(wf?.exit).toBe("done");
    expect(wf?.nodes.find((n) => n.id === "draft")?.type).toBe("agent");
  });

  it("implementation has a back-edge with iteration_max=2 (review→address)", async () => {
    const map = await loadWorkflowDir(workflowsDir);
    const wf = map.get("implementation");
    const reviewToAddress = wf?.edges.find(
      (e) => e.from === "review" && e.to === "address",
    );
    expect(reviewToAddress?.iteration_max).toBe(2);
    expect(reviewToAddress?.on).toBe("changes_requested");
  });

  it("general has a single review node with success/changes/failed all routing to retrospective", async () => {
    const map = await loadWorkflowDir(workflowsDir);
    const wf = map.get("general");
    const reviewEdges = wf?.edges.filter((e) => e.from === "review") ?? [];
    const conditions = reviewEdges.map((e) => e.on).sort();
    expect(conditions).toEqual(["changes_requested", "failed", "success"]);
    for (const e of reviewEdges) {
      expect(e.to).toBe("retrospective");
    }
  });

  it("workflowsDir actually exists on disk (sanity check)", async () => {
    const stat = await fs.stat(workflowsDir);
    expect(stat.isDirectory()).toBe(true);
  });
});
