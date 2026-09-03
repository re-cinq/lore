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

  it("falls back to the LINE's task type for an agent node that declares none (the rule that cost an evening: every node on a merged line ran the planning prompt and reported success for it)", () => {
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

  it("dashes an underscored node type, as an RFC-1123 name requires (asserted directly on builtinStationName since every surviving underscored type is a HUMAN station, which dispatches nothing)", () => {
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
