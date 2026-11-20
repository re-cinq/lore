import { describe, expect, it } from "vitest";
import {
  MirrorRefusal,
  withMirrorRefusal,
} from "@re-cinq/lore-shared/floor/mirror-refusal.js";
import {
  recordedFloor,
  type FloorRequest,
} from "@re-cinq/lore-shared/floor/recorded-floor.js";
import { InMemorySettings } from "@re-cinq/lore-shared/project/settings/settings-memory.js";
import { FLOOR_RUN } from "./floor-run.fixtures.js";
import { upgradeRun } from "./upgrade-run.js";

function upgradingWith(mirrors: Record<string, string>) {
  const settings = new InMemorySettings();

  settings.repos.push({
    full_name: "re-cinq/lore-security",
    settings: { public_mirror: mirrors.public },
  });
  const { floor, requests } = recordedFloor(answer);

  return {
    requests,
    floor: withMirrorRefusal(floor, (repo) => settings.mirrorOwner(repo)),
  };
}

function answer(request: FloorRequest): unknown {
  const answers: Record<string, unknown> = {
    "GET /assembly-runs/run-1": { run: FLOOR_RUN },
    "GET /assembly-lines/code-review": { hash: "hash-2" },
    "POST /assembly-runs/run-1/cancel": { id: "run-1" },
    "POST /assembly-lines/code-review/start": {
      run: { id: "run-2", lineHash: "hash-2" },
      joined: false,
    },
  };

  return answers[`${request.method} ${request.path}`];
}

describe("upgradeRun of a run on a mirror", () => {
  it("refuses to upgrade run-1 of re-cinq/lore, the mirror of re-cinq/lore-security, and starts no line", async () => {
    const { floor, requests } = upgradingWith({ public: "re-cinq/lore" });

    await expect(upgradeRun(floor, "run-1")).rejects.toThrow(
      new MirrorRefusal(
        "re-cinq/lore is the public mirror of re-cinq/lore-security: the floor starts nothing for it",
      ),
    );
    expect(requests.map(({ path }) => path)).not.toContain(
      "/assembly-lines/code-review/start",
    );
  });

  it("upgrades run-1 of re-cinq/lore to run-2 when re-cinq/lore-security mirrors another repo", async () => {
    const { floor } = upgradingWith({ public: "re-cinq/other" });

    expect(await upgradeRun(floor, "run-1")).toEqual({ runId: "run-2" });
  });
});
