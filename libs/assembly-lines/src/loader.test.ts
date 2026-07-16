import { describe, it, expect } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  parseAssemblyLine,
  loadAssemblyLineDir,
  AssemblyLineLoadError,
} from "./loader.js";

const linearAssemblyLine = `
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

describe("parseAssemblyLine", () => {
  it("accepts a valid linear assembly line", () => {
    const wf = parseAssemblyLine(linearAssemblyLine);

    expect(wf.name).toBe("gap-fill");
    expect(wf.nodes).toHaveLength(3);
    expect(wf.entry).toBe("a");
    expect(wf.exit).toBe("c");
  });

  it("rejects malformed YAML", () => {
    expect(() => parseAssemblyLine("name: x\n  - this: is: bad")).toThrow(
      AssemblyLineLoadError,
    );
  });

  it("rejects schema violations", () => {
    expect(() =>
      parseAssemblyLine(`
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
      parseAssemblyLine(`
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
      parseAssemblyLine(`
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
      parseAssemblyLine(`
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
      parseAssemblyLine(`
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
      parseAssemblyLine(`
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
    const wf = parseAssemblyLine(`
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

    expect(
      wf.edges.find((e) => e.from === "b" && e.to === "a")?.iteration_max,
    ).toBe(2);
  });

  it("accepts a detect node carrying job_ref", () => {
    const wf = parseAssemblyLine(`
name: spec-drift
description: d
version: 1
entry: detect
exit: done
nodes:
  - id: detect
    type: detect
    job_ref: spec_drift
  - id: done
    type: retrospective
edges:
  - from: detect
    to: done
    on: success
`);

    expect(wf.nodes.find((n) => n.id === "detect")).toMatchObject({
      type: "detect",
      job_ref: "spec_drift",
    });
  });

  it("accepts station_ref and timeout_minutes on a node", () => {
    const wf = parseAssemblyLine(`
name: custom-line
description: d
version: 1
entry: check
exit: done
nodes:
  - id: check
    type: detect
    job_ref: my_check
    station_ref: acme-scanner
    timeout_minutes: 45
  - id: done
    type: retrospective
edges:
  - from: check
    to: done
    on: success
`);

    expect(wf.nodes.find((n) => n.id === "check")).toMatchObject({
      station_ref: "acme-scanner",
      timeout_minutes: 45,
    });
  });

  it("rejects a non-positive timeout_minutes", () => {
    expect(() =>
      parseAssemblyLine(`
name: x
description: d
version: 1
entry: a
exit: a
nodes:
  - id: a
    type: validate
    timeout_minutes: 0
edges: []
`),
    ).toThrow(/Schema violation/);
  });

  it("rejects a detect node without job_ref", () => {
    expect(() =>
      parseAssemblyLine(`
name: spec-drift
description: d
version: 1
entry: detect
exit: done
nodes:
  - id: detect
    type: detect
  - id: done
    type: retrospective
edges:
  - from: detect
    to: done
    on: success
`),
    ).toThrow(/detect node "detect" requires job_ref/);
  });

  it("rejects invalid node id format", () => {
    expect(() =>
      parseAssemblyLine(`
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

describe("loadAssemblyLineDir — bundled assemblyLines", () => {
  // The bundled YAML files live next to the loader. Resolve the
  // assembly lines directory relative to this test file so this works in
  // both source-tree and dist-tree runs.
  const here = new URL(".", import.meta.url).pathname;
  // The bundled YAMLs are a sibling of this file (src/assembly-lines/), and the
  // build copies them to dist/assembly-lines/ — same relative position either way.
  const assemblyLinesDir = path.resolve(here, "assembly-lines");

  it("loads all bundled assembly lines without error", async () => {
    const map = await loadAssemblyLineDir(assemblyLinesDir);
    const names = Array.from(map.keys()).sort();

    expect(names).toEqual([
      "code-review",
      "code-review-reply",
      "comment-triage",
      "feature-finalize",
      "feature-planning",
      "gap-detect",
      "gap-fill",
      "general",
      "implementation",
      "spec-coverage-backfill",
      "spec-coverage-validate",
      "spec-drift",
    ]);
  });

  it("code-review is a suggestion-only review→done graph (no refine/auto-commit)", async () => {
    const map = await loadAssemblyLineDir(assemblyLinesDir);
    const wf = map.get("code-review");

    expect(wf?.entry).toBe("review");
    expect(wf?.exit).toBe("done");
    expect(wf?.nodes.find((n) => n.id === "review")?.type).toBe("agent");
    expect(wf?.nodes.find((n) => n.id === "refine")).toBeUndefined();
    expect(
      wf?.edges.find((e) => e.from === "review" && e.to === "done")?.on,
    ).toBe("success");
    expect(
      wf?.edges.find((e) => e.from === "review" && e.on === "changes_requested")
        ?.to,
    ).toBe("done");
  });

  it("comment-triage is a triage(station)→done graph", async () => {
    const map = await loadAssemblyLineDir(assemblyLinesDir);
    const wf = map.get("comment-triage");

    expect(wf?.entry).toBe("triage");
    expect(wf?.nodes.find((n) => n.id === "triage")?.type).toBe(
      "comment-triage",
    );
  });

  it("detection lines are two-node detect → done graphs keyed to their historic job names", async () => {
    const map = await loadAssemblyLineDir(assemblyLinesDir);
    const expected: Record<string, string> = {
      "spec-drift": "spec_drift",
      "gap-detect": "gap_detection",
      "spec-coverage-validate": "spec_coverage_validate",
      "spec-coverage-backfill": "spec_coverage_backfill",
    };

    for (const [name, jobRef] of Object.entries(expected)) {
      const wf = map.get(name);

      expect(wf?.entry).toBe("detect");
      expect(wf?.exit).toBe("done");
      expect(wf?.nodes.find((n) => n.id === "detect")).toMatchObject({
        type: "detect",
        job_ref: jobRef,
      });
    }
  });

  it("gap-fill is a linear flow with retrospective + done as exit pair", async () => {
    const map = await loadAssemblyLineDir(assemblyLinesDir);
    const wf = map.get("gap-fill");

    expect(wf?.entry).toBe("draft");
    expect(wf?.exit).toBe("done");
    expect(wf?.nodes.find((n) => n.id === "draft")?.type).toBe("agent");
  });

  it("implementation has a back-edge with iteration_max=2 (review→address)", async () => {
    const map = await loadAssemblyLineDir(assemblyLinesDir);
    const wf = map.get("implementation");
    const reviewToAddress = wf?.edges.find(
      (e) => e.from === "review" && e.to === "address",
    );

    expect(reviewToAddress?.iteration_max).toBe(2);
    expect(reviewToAddress?.on).toBe("changes_requested");
  });

  it("general has a single review node with success/changes/failed all routing to retrospective", async () => {
    const map = await loadAssemblyLineDir(assemblyLinesDir);
    const wf = map.get("general");
    const reviewEdges = wf?.edges.filter((e) => e.from === "review") ?? [];
    const conditions = reviewEdges.map((e) => e.on).sort();

    expect(conditions).toEqual(["changes_requested", "failed", "success"]);

    for (const e of reviewEdges) {
      expect(e.to).toBe("retrospective");
    }
  });

  it("assemblyLinesDir actually exists on disk (sanity check)", async () => {
    const stat = await fs.stat(assemblyLinesDir);

    expect(stat.isDirectory()).toBe(true);
  });
});
