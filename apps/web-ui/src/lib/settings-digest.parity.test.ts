import { describe, it, expect } from "vitest";
import { DIGEST_DEFAULTS as canonical } from "../../../../libs/shared/src/domain/digest-settings";
import { DIGEST_DEFAULTS } from "./settings-digest";

describe("digest defaults parity", () => {
  it("shows the same defaults the library resolves", () => {
    expect(DIGEST_DEFAULTS).toEqual(canonical);
  });
});
