import { describe, it, expect } from "vitest";
import { stationUsage } from "./station-usage.js";
import { loadBuiltinAssemblyLines } from "./builtin-assembly-lines.js";
import { parseAssemblyLine } from "./loader.js";

/**
 * The blueprint→catalog usage walk behind the /agents "used by" surface: which
 * station every node resolves to, inherited or explicit, human nodes excluded —
 * run against both a synthetic line and the real builtin catalog so the shape
 * stays honest about what production blueprints actually reference.
 */

const LINE = `
name: demo
description: usage walk fixture
version: 1
entry: implement
exit: done
nodes:
  - id: implement
    type: agent
  - id: refine
    type: agent
    station_ref: code-review-refine
  - id: check
    type: validate
  - id: done
    type: retrospective
edges:
  - from: implement
    to: refine
    on: success
  - from: implement
    to: done
    on: failed
  - from: implement
    to: done
    on: changes_requested
  - from: refine
    to: check
    on: success
  - from: refine
    to: done
    on: failed
  - from: refine
    to: done
    on: changes_requested
  - from: check
    to: done
    on: success
  - from: check
    to: done
    on: failed
`;

describe("stationUsage", () => {
  it("maps inherited agent nodes to the line name, explicit station_refs to their own name, and station nodes to def-<type>", () => {
    const line = parseAssemblyLine(LINE);
    const usage = stationUsage(new Map([["demo", line]]));

    expect(Object.fromEntries(usage)).toEqual({
      demo: [{ blueprint: "demo", nodeId: "implement", inherited: true }],
      "code-review-refine": [
        { blueprint: "demo", nodeId: "refine", inherited: false },
      ],
      "def-validate": [{ blueprint: "demo", nodeId: "check", inherited: true }],
      "def-retrospective": [
        { blueprint: "demo", nodeId: "done", inherited: true },
      ],
    });
  });

  it("the builtin catalog references implementation and def-validate but never runbook", async () => {
    const usage = stationUsage(await loadBuiltinAssemblyLines());

    expect(usage.get("implementation")?.length).toBeGreaterThan(0);
    expect(usage.get("def-validate")?.length).toBeGreaterThan(0);
    // runbook has no blueprint — it runs as a single Agent CR, which is exactly
    // why usage alone cannot define the catalog roster.
    expect(usage.get("runbook")).toBeUndefined();
  });
});
