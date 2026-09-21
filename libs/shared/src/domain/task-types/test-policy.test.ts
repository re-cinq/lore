import { describe, it, expect } from "vitest";
import { testPolicyEnv } from "./test-policy.js";

describe("testPolicyEnv", () => {
  it("maps a declared policy onto the LORE_TEST_POLICY env the pod's guard reads, and an unknown one onto nothing", () => {
    expect(testPolicyEnv("none")).toEqual([
      { name: "LORE_TEST_POLICY", value: "none" },
    ]);
    expect(testPolicyEnv(undefined)).toEqual([]);
    expect(testPolicyEnv("yolo")).toEqual([]);
  });
});
