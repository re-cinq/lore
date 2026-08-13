import { describe, it, expect } from "vitest";
import { decideDecomposeKick } from "./decompose-kick.js";

describe("decideDecomposeKick", () => {
  it("kicks decomposition when a feature-finalize task carries a feature id", () => {
    expect(
      decideDecomposeKick({
        task_type: "feature-finalize",
        context_bundle: { feature_id: "f1", slug: "fav" },
      }),
    ).toEqual({ kick: true, featureId: "f1", slug: "fav" });
  });

  it("does not kick for a non-finalize task type", () => {
    expect(
      decideDecomposeKick({
        task_type: "feature-request",
        context_bundle: { feature_id: "f1" },
      }),
    ).toEqual({
      kick: false,
    });
  });

  it("does not kick a finalize task with no feature id", () => {
    expect(
      decideDecomposeKick({
        task_type: "feature-finalize",
        context_bundle: {},
      }),
    ).toEqual({ kick: false });
  });
});
