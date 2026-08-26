import { describe, it, expect } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  parseAssemblyLine,
  loadAssemblyLineDir,
  uncoveredOutcomes,
  AssemblyLineLoadError,
  type AssemblyLine,
  type EdgeConditionValue,
} from "./loader.js";
import { definitionHash } from "./definition-hash.js";

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
  - id: c
    type: retrospective
edges:
  - from: a
    to: b
    on: always
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

  it("rejects a mistyped node key instead of discarding it", () => {
    // `timeoutMinutes` is not the field name — `timeout_minutes` is. Without a
    // strict schema the key is dropped in silence and the node runs with no
    // timeout at all, which is the opposite of what the author asked for.
    expect(() =>
      parseAssemblyLine(`
name: x
description: d
version: 1
entry: a
exit: a
nodes:
  - id: a
    type: agent
    timeoutMinutes: 30
edges: []
`),
    ).toThrow(/Schema violation/);
  });

  it("rejects a mistyped top-level key instead of discarding it", () => {
    expect(() =>
      parseAssemblyLine(`
name: x
description: d
version: 1
entry: a
exit: a
nodes:
  - id: a
    type: agent
edges: []
onFailure: escalate
`),
    ).toThrow(/Schema violation/);
  });

  it("rejects a mistyped edge key instead of discarding it", () => {
    // `iterationMax` silently dropped means an unbounded back-edge — the runaway
    // the loader's cycle check exists to prevent.
    expect(() =>
      parseAssemblyLine(`
name: x
description: d
version: 1
entry: a
exit: b
nodes:
  - id: a
    type: agent
  - id: b
    type: retrospective
edges:
  - from: a
    to: b
    on: always
    iterationMax: 3
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

  it("accepts a human station and an unbounded back-edge out of it", () => {
    // A human station's worker is a PERSON. The iteration_max rule exists so two
    // agents cannot argue indefinitely; a person deciding each pass cannot run
    // away, so the refine loop is legitimately unbounded.
    const wf = parseAssemblyLine(`
name: feature
description: plan a feature with the author in the loop
version: 1
entry: analyze
exit: done
nodes:
  - id: analyze
    type: agent
    prompt_ref: feature-planning
  - id: author
    type: feature_review
    route: /repos/{args.repo}/features/{args.feature_id}
  - id: done
    type: retrospective
edges:
  - from: analyze
    to: author
    on: success
  - from: analyze
    to: done
    on: changes_requested
  - from: analyze
    to: done
    on: failed
  - from: author
    to: analyze
    on: changes_requested
  - from: author
    to: done
    on: success
  - from: author
    to: done
    on: failed
`);

    expect(wf.nodes.find((n) => n.id === "author")).toMatchObject({
      type: "feature_review",
      route: "/repos/{args.repo}/features/{args.feature_id}",
    });
  });

  it("still requires iteration_max on a back-edge between two agents", () => {
    // The exemption is keyed strictly on the SOURCE node's type — it must not become
    // a way to write an unbounded agent loop.
    expect(() =>
      parseAssemblyLine(`
name: feature
description: two agents arguing
version: 1
entry: a
exit: done
nodes:
  - id: a
    type: agent
    prompt_ref: x
  - id: b
    type: agent
    prompt_ref: y
  - id: done
    type: retrospective
edges:
  - from: a
    to: b
    on: success
  - from: a
    to: done
    on: changes_requested
  - from: a
    to: done
    on: failed
  - from: b
    to: a
    on: changes_requested
  - from: b
    to: done
    on: success
  - from: b
    to: done
    on: failed
`),
    ).toThrow(/back-edge b → a requires iteration_max/);
  });

  it("rejects a human station with no route", () => {
    // A station whose worker is a person must say WHERE that person works, or the
    // run can park on it with nothing able to tell anyone whose move it is.
    expect(() =>
      parseAssemblyLine(`
name: feature
description: a review nobody can find
version: 1
entry: author
exit: done
nodes:
  - id: author
    type: feature_review
  - id: done
    type: retrospective
edges:
  - from: author
    to: done
    on: always
`),
    ).toThrow(/human station "author" requires route/);
  });

  it("rejects a route placeholder that is not an args reference", () => {
    // Placeholders resolve against the run's args and nothing else — that is what
    // keeps the engine domain-free: it still never learns what a feature is.
    expect(() =>
      parseAssemblyLine(`
name: feature
description: a route reaching outside args
version: 1
entry: author
exit: done
nodes:
  - id: author
    type: feature_review
    route: /repos/{repo}/features/{args.feature_id}
  - id: done
    type: retrospective
edges:
  - from: author
    to: done
    on: always
`),
    ).toThrow(/route placeholder "\{repo\}"/);
  });

  it("accepts an absolute route for a surface this platform does not own", () => {
    // The GitHub PR view is a station like any other; its page simply is not ours.
    const wf = parseAssemblyLine(`
name: feature
description: waiting on a spec PR
version: 1
entry: merged
exit: done
nodes:
  - id: merged
    type: pr_review
    route: "{args.pr_url}"
  - id: done
    type: retrospective
edges:
  - from: merged
    to: done
    on: always
`);

    expect(wf.nodes.find((n) => n.id === "merged")).toMatchObject({
      type: "pr_review",
      route: "{args.pr_url}",
    });
  });

  it("accepts an issues station node", () => {
    // A node type the enum does not know fails at LOAD, which is the point: the YAML
    // is the contract, so a station that has no runner cannot be scheduled.
    const wf = parseAssemblyLine(`
name: feature-decompose
description: decompose a merged spec, then file the issues
version: 1
entry: decompose
exit: done
nodes:
  - id: decompose
    type: agent
    prompt_ref: feature-decompose
  - id: issues
    type: issues
  - id: done
    type: retrospective
edges:
  - from: decompose
    to: issues
    on: success
  - from: issues
    to: done
    on: success
  - from: issues
    to: decompose
    on: changes_requested
    iteration_max: 1
  - from: decompose
    to: done
    on: changes_requested
  - from: decompose
    to: done
    on: failed
  - from: issues
    to: done
    on: failed
`);

    expect(wf.nodes.find((n) => n.id === "issues")?.type).toBe("issues");
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
    on: always
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
    on: always
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
    on: always
`);

    expect(wf.nodes.find((n) => n.id === "detect")).toMatchObject({
      type: "detect",
      job_ref: "spec_drift",
    });
  });

  it("accepts an ingest node type (the ingest-station line)", () => {
    const wf = parseAssemblyLine(`
name: ingest
description: d
version: 1
entry: ingest
exit: done
nodes:
  - id: ingest
    type: ingest
  - id: done
    type: retrospective
edges:
  - from: ingest
    to: done
    on: always
`);

    expect(wf.nodes.find((n) => n.id === "ingest")).toMatchObject({
      type: "ingest",
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
    on: always
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

  it("rejects a merge_step node without job_ref", () => {
    expect(() =>
      parseAssemblyLine(`
name: merge
description: d
version: 1
entry: settle
exit: done
nodes:
  - id: settle
    type: merge_step
  - id: done
    type: retrospective
edges:
  - from: settle
    to: done
    on: success
`),
    ).toThrow(/merge_step node "settle" requires job_ref/);
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
      "code-review-recheck",
      "code-review-reply",
      "comment-triage",
      "escalation",
      "feature-planning",
      "gap-detect",
      "gap-fill",
      "general",
      "implementation",
      "implementation-loop",
      "ingest",
      "merge",
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

describe("parseAssemblyLine outcome coverage", () => {
  it('rejects a detect node with no edge for producible outcome "failed"', () => {
    expect(() =>
      parseAssemblyLine(`
name: gap-detect
description: d
version: 1
entry: detect
exit: done
nodes:
  - id: detect
    type: detect
    job_ref: gap_detection
  - id: done
    type: retrospective
edges:
  - from: detect
    to: done
    on: success
`),
    ).toThrow(
      'node "detect" in assembly line "gap-detect" has no edge for producible outcome(s) "failed"',
    );
  });

  it('rejects an agent node covering only success and failed with a "changes_requested" message', () => {
    expect(() =>
      parseAssemblyLine(`
name: review-line
description: d
version: 1
entry: review
exit: done
nodes:
  - id: review
    type: agent
  - id: done
    type: retrospective
edges:
  - from: review
    to: done
    on: success
  - from: review
    to: done
    on: failed
`),
    ).toThrow(
      'node "review" in assembly line "review-line" has no edge for producible outcome(s) "changes_requested"',
    );
  });

  it("lists every uncovered outcome for an agent node with only a success edge", () => {
    expect(() =>
      parseAssemblyLine(`
name: x
description: d
version: 1
entry: a
exit: done
nodes:
  - id: a
    type: agent
  - id: done
    type: retrospective
edges:
  - from: a
    to: done
    on: success
`),
    ).toThrow(
      'node "a" in assembly line "x" has no edge for producible outcome(s) "changes_requested", "failed"',
    );
  });

  it("accepts a detect node with explicit success and failed edges", () => {
    const wf = parseAssemblyLine(`
name: gap-detect
description: d
version: 1
entry: detect
exit: done
nodes:
  - id: detect
    type: detect
    job_ref: gap_detection
  - id: done
    type: retrospective
edges:
  - from: detect
    to: done
    on: success
  - from: detect
    to: done
    on: failed
`);

    expect(
      wf.edges
        .filter((e) => e.from === "detect")
        .map((e) => e.on)
        .sort(),
    ).toEqual(["failed", "success"]);
  });

  it("accepts an agent node whose outcomes are covered by an always edge", () => {
    const wf = parseAssemblyLine(`
name: x
description: d
version: 1
entry: a
exit: done
nodes:
  - id: a
    type: agent
  - id: done
    type: retrospective
edges:
  - from: a
    to: done
    on: always
`);

    expect(wf.edges).toEqual([{ from: "a", to: "done", on: "always" }]);
  });

  it("requires no coverage on the exit node (terminal, no outgoing edges)", () => {
    const wf = parseAssemblyLine(`
name: x
description: d
version: 1
entry: a
exit: done
nodes:
  - id: a
    type: validate
  - id: done
    type: retrospective
edges:
  - from: a
    to: done
    on: success
  - from: a
    to: done
    on: failed
`);

    expect(wf.exit).toBe("done");
  });
});

describe("uncoveredOutcomes", () => {
  // Handcrafted (not parseAssemblyLine): the partial-coverage case is exactly
  // what the loader now rejects, so the object cannot be built by parsing.
  const agentToExit = (on: EdgeConditionValue): AssemblyLine => ({
    name: "x",
    description: "d",
    version: 1,
    entry: "a",
    exit: "done",
    nodes: [
      { id: "a", type: "agent" },
      { id: "done", type: "retrospective" },
    ],
    edges: [{ from: "a", to: "done", on }],
  });

  it("returns empty for the exit node", () => {
    const wf = agentToExit("always");
    const exit = wf.nodes.find((n) => n.id === wf.exit)!;

    expect(uncoveredOutcomes(wf, exit)).toEqual([]);
  });

  it("returns empty when an always edge covers the node", () => {
    const wf = agentToExit("always");
    const a = wf.nodes.find((n) => n.id === "a")!;

    expect(uncoveredOutcomes(wf, a)).toEqual([]);
  });

  it("returns the missing outcomes for a partially covered agent node", () => {
    const wf = agentToExit("success");
    const a = wf.nodes.find((n) => n.id === "a")!;

    expect(uncoveredOutcomes(wf, a).sort()).toEqual([
      "changes_requested",
      "failed",
    ]);
  });
});

describe("loadAssemblyLineDir — code-review-recheck line", () => {
  const here = new URL(".", import.meta.url).pathname;
  const assemblyLinesDir = path.resolve(here, "assembly-lines");

  it("is a fast Haiku recheck→done graph routing every verdict to done", async () => {
    const map = await loadAssemblyLineDir(assemblyLinesDir);
    const wf = map.get("code-review-recheck");

    expect(wf?.entry).toBe("recheck");
    expect(wf?.exit).toBe("done");
    expect(wf?.nodes.find((n) => n.id === "recheck")).toMatchObject({
      type: "agent",
      prompt_ref: "code-review-recheck",
      model: "claude-haiku-4-5-20251001",
    });
    expect(
      wf?.edges
        .filter((e) => e.from === "recheck")
        .map((e) => e.on)
        .sort(),
    ).toEqual(["changes_requested", "failed", "success"]);
  });
});

describe("parseAssemblyLine — continues", () => {
  const line = (continues: string) => `
name: planning
description: d
version: 1
entry: analyze
exit: done
nodes:
  - id: analyze
    type: agent
${continues}
  - id: done
    type: retrospective
edges:
  - from: analyze
    to: done
    on: always
`;

  it("accepts a node reference keyed by an arg", () => {
    const wf = parseAssemblyLine(
      line("    continues:\n      node: analyze\n      key: args.feature_id"),
    );

    expect(wf.nodes[0].continues).toEqual({
      node: "analyze",
      key: "args.feature_id",
    });
  });

  it("accepts the built-in line and task keys", () => {
    expect(
      parseAssemblyLine(
        line("    continues:\n      node: analyze\n      key: line"),
      ).nodes[0].continues?.key,
    ).toBe("line");
    expect(
      parseAssemblyLine(
        line("    continues:\n      node: analyze\n      key: task"),
      ).nodes[0].continues?.key,
    ).toBe("task");
  });

  it("rejects a reference to a node that does not exist", () => {
    // An unresolvable reference would silently start a fresh conversation at runtime,
    // which is indistinguishable from one that continued and remembered nothing.
    expect(() =>
      parseAssemblyLine(
        line("    continues:\n      node: reviewe\n      key: line"),
      ),
    ).toThrow(/continues unknown node "reviewe"/);
  });

  it("rejects a thread key that resolves to nothing", () => {
    expect(() =>
      parseAssemblyLine(
        line("    continues:\n      node: analyze\n      key: feature"),
      ),
    ).toThrow(/invalid continues.key "feature"/);
  });

  it("leaves a node without continues alone", () => {
    expect(parseAssemblyLine(line("")).nodes[0].continues).toBeUndefined();
  });
});

describe("required_tags on nodes (specs/running-stations-in-any-k8s-cluster FR2)", () => {
  it("accepts a node declaring required_tags and preserves the list", () => {
    const wf = parseAssemblyLine(`
name: tagged
description: A flow with a gpu node
version: 1
entry: a
exit: a
nodes:
  - id: a
    type: agent
    prompt_ref: gap-fill
    required_tags: ["node:agent", "gpu"]
edges: []
`);

    expect(wf.nodes[0].required_tags).toEqual(["node:agent", "gpu"]);
  });

  it("keeps definitionHash identical for a definition that sets no required_tags", () => {
    const before = parseAssemblyLine(linearAssemblyLine);
    const after = parseAssemblyLine(linearAssemblyLine);

    expect(definitionHash(after)).toBe(definitionHash(before));
    expect(before.nodes[0].required_tags).toBeUndefined();
  });

  it("moves definitionHash when a node adds a required_tags value", () => {
    const untagged = parseAssemblyLine(linearAssemblyLine);
    const tagged = parseAssemblyLine(
      linearAssemblyLine.replace(
        "    prompt_ref: gap-fill",
        '    prompt_ref: gap-fill\n    required_tags: ["gpu"]',
      ),
    );

    expect(definitionHash(tagged)).not.toBe(definitionHash(untagged));
  });
});
