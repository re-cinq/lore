import { describe, it, expect } from "vitest";
import { loadBuiltinAssemblyLines } from "@re-cinq/lore-assembly-lines";

// specs/issue-triage/spec.md#User Story 1 - Automated Bug Reproduction in Sandbox (Priority: P1)
describe("issue-triage: reproduce station wiring (T008)", () => {
  it("reproduce station has timeout_minutes of 15 [validated by specs/issue-triage/spec.md#User Story 1 - Automated Bug Reproduction in Sandbox (Priority: P1)]", async () => {
    const lines = await loadBuiltinAssemblyLines();
    const line = lines.get("issue-triage")!;
    const reproduce = line.nodes.find((n) => n.id === "reproduce");
    expect(reproduce).toBeDefined();
    expect(reproduce?.timeout_minutes).toBe(15);
  });

  it("reproduce station declares custom outcomes [unable-to-reproduce, needs-reproduction, skipped] [validated by specs/issue-triage/spec.md#User Story 1 - Automated Bug Reproduction in Sandbox (Priority: P1)]", async () => {
    const lines = await loadBuiltinAssemblyLines();
    const line = lines.get("issue-triage")!;
    const reproduce = line.nodes.find((n) => n.id === "reproduce");
    expect(reproduce).toBeDefined();
    const outcomes = (reproduce as Record<string, unknown>)[
      "outcomes"
    ] as string[];
    expect(outcomes).toContain("unable-to-reproduce");
    expect(outcomes).toContain("needs-reproduction");
    expect(outcomes).toContain("skipped");
  });

  it("all edges from reproduce route to triage-label [validated by specs/issue-triage/spec.md#User Story 1 - Automated Bug Reproduction in Sandbox (Priority: P1)]", async () => {
    const lines = await loadBuiltinAssemblyLines();
    const line = lines.get("issue-triage")!;
    const reproEdges = line.edges.filter((e) => e.from === "reproduce");
    expect(reproEdges.length).toBeGreaterThan(0);
    expect(reproEdges.every((e) => e.to === "triage-label")).toBe(true);
  });
});
