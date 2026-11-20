import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemorySettings } from "../project/settings/settings-memory.js";
import { floorClient, useMirrorOwner } from "./floor-client.js";
import { gitItem } from "./floor-items.js";
import { MirrorRefusal } from "./mirror-refusal.js";

const MIRROR_START = {
  repo: "github.com/re-cinq/lore",
  startItems: { repo: gitItem("re-cinq/lore", "main") },
};

function stubFloorEnv(): void {
  vi.stubEnv("FLOOR_API_URL", "http://floor.invalid");
  vi.stubEnv("FLOOR_SERVICE_TOKEN", "secret");
}

describe("floorClient", () => {
  afterEach(() => {
    useMirrorOwner(null);
    vi.unstubAllEnvs();
  });

  it("refuses a start for re-cinq/lore when the settings name it as the mirror of re-cinq/lore-security", async () => {
    stubFloorEnv();
    const settings = new InMemorySettings();

    settings.repos.push({
      full_name: "re-cinq/lore-security",
      settings: { public_mirror: "re-cinq/lore" },
    });
    useMirrorOwner((repo) => settings.mirrorOwner(repo));

    await expect(
      floorClient().lines.start("code-review", MIRROR_START),
    ).rejects.toThrow(
      new MirrorRefusal(
        "re-cinq/lore is the public mirror of re-cinq/lore-security: the floor starts nothing for it",
      ),
    );
  });

  it("refuses every start while no mirror lookup is given, since it cannot tell a mirror from any other repo", async () => {
    stubFloorEnv();

    await expect(
      floorClient().lines.start("code-review", MIRROR_START),
    ).rejects.toThrow(
      new MirrorRefusal(
        "no mirror lookup was given to this process: the floor starts nothing until it has one",
      ),
    );
  });
});
