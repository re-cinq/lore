import { describe, it, expect } from "vitest";
import { loadBuiltinAssemblyLines } from "@re-cinq/lore-assembly-lines";

// specs/issue-triage/spec.md FR4
describe("issue-triage floor pipeline — verify node wiring", () => {
  it("verify node covers every outcome with a matching outgoing edge", async () => {
    const lines = await loadBuiltinAssemblyLines();
    const line = lines.get("issue-triage");

    expect(
      line,
      "issue-triage assembly line must exist in the builtin catalog",
    ).toBeDefined();

    const verify = line!.nodes.find((n) => n.id === "verify");

    expect(
      verify,
      "verify node must be declared in issue-triage",
    ).toBeDefined();
    expect(verify!.station_ref).toBe("triage-verify");
    expect(verify!.timeout_minutes).toBe(10);

    const outgoing = line!.edges.filter((e) => e.from === "verify");
    const covered = new Set(outgoing.map((e) => e.on));
    const allCovered =
      covered.has("always") ||
      (covered.has("success") &&
        covered.has("changes_requested") &&
        covered.has("failed"));

    expect(
      allCovered,
      "every verify outcome (success, changes_requested, failed) must have a matching outgoing edge",
    ).toBe(true);

    expect(outgoing.find((e) => e.on === "success")?.to).toBe("human-gate");
    expect(outgoing.find((e) => e.on === "failed")?.to).toBe("label-failed");
  });
});
