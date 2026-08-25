import { describe, it, expect } from "vitest";
import { nodeTimeoutMinutes } from "./node-timeout.js";

describe("nodeTimeoutMinutes", () => {
  it("takes the station's 5 minutes when the YAML declares no budget", () => {
    expect(nodeTimeoutMinutes({ yaml: undefined, manifest: 5 })).toBe(5);
  });

  it("takes the YAML's 30 over the station's 5, so a line can extend a step", () => {
    expect(nodeTimeoutMinutes({ yaml: 30, manifest: 5 })).toBe(30);
  });

  it("undefined when neither speaks, leaving the caller's global default", () => {
    expect(
      nodeTimeoutMinutes({ yaml: undefined, manifest: undefined }),
    ).toBeUndefined();
  });
});
