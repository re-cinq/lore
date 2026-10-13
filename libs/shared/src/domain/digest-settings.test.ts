import { describe, it, expect } from "vitest";
import { DIGEST_DEFAULTS, resolveDigestSettings } from "./digest-settings.js";

describe("resolveDigestSettings", () => {
  it("returns every default when the block is absent", () => {
    expect(resolveDigestSettings(undefined)).toEqual({
      enabled: false,
      time: "09:00",
      days: [1, 2, 3, 4, 5],
      timezone: "Europe/Berlin",
      sections: ["implemented", "roadmap", "summary", "morale"],
      group_by: "person",
      voice: "",
    });
  });

  it("keeps a partial block's values and fills the rest", () => {
    expect(
      resolveDigestSettings({ enabled: true, time: "17:30", days: [1, 3] }),
    ).toEqual({
      ...DIGEST_DEFAULTS,
      enabled: true,
      time: "17:30",
      days: [1, 3],
    });
  });

  it("returns disabled when enabled is absent", () => {
    expect(resolveDigestSettings({ sections: ["roadmap"] }).enabled).toBe(
      false,
    );
  });
});
