import { describe, it, expect } from "vitest";
import { ReleaseSettingsSchema, RepoSettingsSchema } from "./repo-settings.js";

describe("ReleaseSettingsSchema", () => {
  it("accepts enabled, Friday 08:30 in Europe/Berlin", () => {
    expect(
      ReleaseSettingsSchema.safeParse({
        enabled: true,
        days: [5],
        time: "08:30",
        timezone: "Europe/Berlin",
      }).success,
    ).toBe(true);
  });

  it("refuses a weekday of 7, a time of 9am and the timezone Mars/Olympus_Mons", () => {
    expect(
      [
        { days: [7] },
        { time: "9am" },
        { timezone: "Mars/Olympus_Mons" },
        { enabled: "yes" },
      ].map((block) => ReleaseSettingsSchema.safeParse(block).success),
    ).toEqual([false, false, false, false]);
  });
});

describe("RepoSettingsSchema public_mirror", () => {
  it("accepts re-cinq/lore as the mirror", () => {
    expect(
      RepoSettingsSchema.safeParse({ public_mirror: "re-cinq/lore" }).success,
    ).toBe(true);
  });

  it("refuses the mirrors lore, re-cinq/, /lore, a/b/c and re-cinq/lo re", () => {
    expect(
      ["lore", "re-cinq/", "/lore", "a/b/c", "re-cinq/lo re"].map(
        (mirror) =>
          RepoSettingsSchema.safeParse({ public_mirror: mirror }).success,
      ),
    ).toEqual([false, false, false, false, false]);
  });

  it("accepts public_mirror and release cleared to null", () => {
    expect(
      RepoSettingsSchema.safeParse({ public_mirror: null, release: null })
        .success,
    ).toBe(true);
  });
});
