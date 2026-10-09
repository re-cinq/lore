import { describe, expect, it } from "vitest";
import { decideScaffoldCommit } from "./onboard-scaffold.js";

describe("decideScaffoldCommit", () => {
  it("returns false when current !== null and current !== file.content ([validated by FR-5.4: The onboarding PR commits static scaffolding verbatim](specs/4-ux-repo-onboarding/spec.md#L449))", () => {
    expect(
      decideScaffoldCommit(
        { owner: "lore", content: "canonical" },
        "divergent content",
      ),
    ).toBe(false);
  });
});
