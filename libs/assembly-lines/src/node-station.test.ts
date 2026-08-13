import { describe, it, expect } from "vitest";
import { resolveNodeStation } from "./node-station.js";

const node = (over: Record<string, unknown> = {}) =>
  ({ id: "n", type: "agent", ...over }) as never;

describe("resolveNodeStation", () => {
  it("names the node's own station when it declares one", () => {
    expect(
      resolveNodeStation(
        node({ station_ref: "spec-analysis" }),
        "feature-planning",
      ),
    ).toEqual({ station: "spec-analysis", inherited: false });
  });

  it("falls back to the LINE's task type for an agent node that declares none", () => {
    // The rule that cost an evening: an agent node without station_ref runs the
    // recipe named after the line, so on a merged line every node ran the planning
    // prompt and reported success for it. Reporting `inherited` makes that visible
    // instead of leaving it to be inferred from YAML.
    expect(resolveNodeStation(node(), "feature-planning")).toEqual({
      station: "feature-planning",
      inherited: true,
    });
  });

  it("names the builtin station for a non-agent node", () => {
    expect(
      resolveNodeStation(node({ type: "validate" }), "implementation"),
    ).toEqual({ station: "def-validate", inherited: true });
  });

  it("dashes an underscored node type, as an RFC-1123 name requires", () => {
    expect(
      resolveNodeStation(node({ type: "github_action" }), "implementation"),
    ).toMatchObject({ station: "def-github-action" });
  });

  it("reports no station for a wait node, whose worker is a person", () => {
    expect(
      resolveNodeStation(node({ type: "wait" }), "feature-planning"),
    ).toEqual({
      station: null,
      inherited: false,
    });
  });
});
