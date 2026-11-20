import { describe, expect, it } from "vitest";
import { InMemorySettings } from "@re-cinq/lore-shared/project/settings/settings-memory.js";
import { enforceNotAMirror } from "./enforce-not-a-mirror.js";

function settingsWithPair(): InMemorySettings {
  return new InMemorySettings([
    {
      full_name: "acme/private",
      onboarding_pr_merged: true,
      settings: { public_mirror: "acme/public" },
    },
    {
      full_name: "acme/public",
      onboarding_pr_merged: true,
      settings: { auto_review: true },
    },
    { full_name: "acme/plain", onboarding_pr_merged: true, settings: {} },
  ]);
}

describe("enforceNotAMirror", () => {
  it("refuses acme/public that acme/private names as its mirror", async () => {
    await expect(
      enforceNotAMirror(settingsWithPair(), "acme/public"),
    ).rejects.toThrow(
      "acme/public is already the public mirror of acme/private",
    );
  });

  it("refuses Acme/Public in another letter case", async () => {
    await expect(
      enforceNotAMirror(settingsWithPair(), "Acme/Public"),
    ).rejects.toThrow(
      "Acme/Public is already the public mirror of acme/private",
    );
  });

  it("accepts acme/plain that no repo names as its mirror", async () => {
    await expect(
      enforceNotAMirror(settingsWithPair(), "acme/plain"),
    ).resolves.toBeUndefined();
  });

  it("accepts acme/public once acme/private stops naming it", async () => {
    const settings = settingsWithPair();

    await settings.updateSettings("acme/private", {});

    await expect(
      enforceNotAMirror(settings, "acme/public"),
    ).resolves.toBeUndefined();
  });

  it("accepts a repo that no row exists for", async () => {
    await expect(
      enforceNotAMirror(settingsWithPair(), "acme/new"),
    ).resolves.toBeUndefined();
  });
});
