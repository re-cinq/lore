import { describe, it, expect } from "vitest";
import { builtinStationName, resolveNodeStation } from "./node-station.js";

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

  // Asserted on `builtinStationName` directly rather than through a node: every
  // surviving underscored node type is a HUMAN station, which dispatches nothing,
  // so there is no node left to reach this through. The rule still holds and
  // still matters — a CR name is RFC-1123 — so it keeps its own test rather than
  // riding on a type that happens to exist.
  it("dashes an underscored node type, as an RFC-1123 name requires", () => {
    expect(builtinStationName("some_underscored_type")).toBe(
      "def-some-underscored-type",
    );
  });

  it("reports no station for a human station, whose worker is a person", () => {
    expect(
      resolveNodeStation(node({ type: "feature_review" }), "feature-planning"),
    ).toEqual({
      station: null,
      inherited: false,
    });
  });
});
