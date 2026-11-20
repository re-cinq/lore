import { describe, expect, it } from "vitest";
import { InMemorySettings } from "../project/settings/settings-memory.js";
import { gitItem, valueItem } from "./floor-items.js";
import { MirrorRefusal, withMirrorRefusal } from "./mirror-refusal.js";
import { recordedFloor } from "./recorded-floor.js";

const PRIVATE_REPO = "re-cinq/lore-security";
const MIRROR = "re-cinq/lore";
const PR_URL = "https://github.com/re-cinq/lore/pull/7";
const REFUSAL = new MirrorRefusal(
  "re-cinq/lore is the public mirror of re-cinq/lore-security: the floor starts nothing for it",
);
const STARTED = { run: { id: "run-1" }, joined: false };

function guardedFloor(settings: InMemorySettings = settingsMirroring()) {
  const recorded = recordedFloor(() => STARTED);

  return {
    ...recorded,
    guarded: withMirrorRefusal(recorded.floor, (repo) =>
      settings.mirrorOwner(repo),
    ),
  };
}

function settingsMirroring(): InMemorySettings {
  const settings = new InMemorySettings();

  settings.repos.push(
    { full_name: PRIVATE_REPO, settings: { public_mirror: MIRROR } },
    { full_name: "re-cinq/otto", settings: {} },
  );

  return settings;
}

const startsOf = (requests: { method: string; path: string }[]) =>
  requests
    .filter((request) => request.method === "POST")
    .map((request) => request.path);

function reviewStart(repo: string) {
  return {
    repo: `github.com/${repo}`,
    startItems: {
      repo: gitItem(repo, "fix/login"),
      pr_url: valueItem(`https://github.com/${repo}/pull/7`),
    },
  };
}

describe("withMirrorRefusal", () => {
  it("refuses code-review for re-cinq/lore, a mirror of re-cinq/lore-security, and the floor holds no start", async () => {
    const { guarded, requests } = guardedFloor();

    await expect(
      guarded.lines.start("code-review", reviewStart(MIRROR)),
    ).rejects.toThrow(REFUSAL);
    expect(startsOf(requests)).toEqual([]);
  });

  it("starts code-review for re-cinq/lore-security, the private repo of the mirror", async () => {
    const { guarded, requests } = guardedFloor();

    await guarded.lines.start("code-review", reviewStart(PRIVATE_REPO));

    expect(startsOf(requests)).toEqual(["/assembly-lines/code-review/start"]);
  });

  it("starts code-review for re-cinq/otto, which nobody mirrors", async () => {
    const { guarded, requests } = guardedFloor();

    await guarded.lines.start("code-review", reviewStart("re-cinq/otto"));

    expect(startsOf(requests)).toEqual(["/assembly-lines/code-review/start"]);
  });

  it("sends the same start to the floor as an unwrapped client when no repo names a mirror", async () => {
    const bare = recordedFloor(() => STARTED);
    const { guarded, requests } = guardedFloor(new InMemorySettings());

    await bare.floor.lines.start("code-review", reviewStart(MIRROR));
    await guarded.lines.start("code-review", reviewStart(MIRROR));

    expect(requests).toEqual(bare.requests);
  });

  it("refuses a start whose only mention of re-cinq/lore is its git item", async () => {
    const { guarded, requests } = guardedFloor();

    await expect(
      guarded.lines.start("spec-upkeep", {
        startItems: { repo: gitItem(MIRROR, "main") },
      }),
    ).rejects.toThrow(REFUSAL);
    expect(startsOf(requests)).toEqual([]);
  });

  it("refuses a start whose only mention of re-cinq/lore is its pr_url", async () => {
    const { guarded, requests } = guardedFloor();

    await expect(
      guarded.lines.start("auto-merge", {
        startItems: { pr_url: valueItem(PR_URL) },
      }),
    ).rejects.toThrow(REFUSAL);
    expect(startsOf(requests)).toEqual([]);
  });

  it("refuses a start whose only mention of re-cinq/lore is its changelog_repo value", async () => {
    const { guarded, requests } = guardedFloor();

    await expect(
      guarded.lines.start("weekly-changelog", {
        startItems: { changelog_repo: valueItem(MIRROR) },
      }),
    ).rejects.toThrow(REFUSAL);
    expect(startsOf(requests)).toEqual([]);
  });

  it("refuses re-cinq/Lore spelled in capitals", async () => {
    const { guarded } = guardedFloor();

    await expect(
      guarded.lines.start("code-review", reviewStart("re-cinq/Lore")),
    ).rejects.toThrow(
      new MirrorRefusal(
        "re-cinq/Lore is the public mirror of re-cinq/lore-security: the floor starts nothing for it",
      ),
    );
  });

  it("starts a line whose start names no repository at all", async () => {
    const { guarded, requests } = guardedFloor();

    await guarded.lines.start("digest", { startItems: {} });

    expect(startsOf(requests)).toEqual(["/assembly-lines/digest/start"]);
  });

  it("answers the run list of re-cinq/lore, since only starts are refused", async () => {
    const { guarded, requests } = guardedFloor();

    await guarded.runs.list({ repo: `github.com/${MIRROR}` });

    expect(requests).toMatchObject([
      { method: "GET", path: /^\/assembly-runs/ },
    ]);
  });

  it("carries a retry budget of 1 on the refusal, so the bus does not start the same refusal again", async () => {
    const { guarded } = guardedFloor();

    await expect(
      guarded.lines.start("code-review", reviewStart(MIRROR)),
    ).rejects.toMatchObject({ maxAttempts: 1 });
  });

  it("starts nothing when the lookup of the mirror fails", async () => {
    const recorded = recordedFloor(() => STARTED);
    const guarded = withMirrorRefusal(recorded.floor, async () => {
      throw new Error("database unavailable");
    });

    await expect(
      guarded.lines.start("code-review", reviewStart(MIRROR)),
    ).rejects.toThrow(new Error("database unavailable"));
    expect(startsOf(recorded.requests)).toEqual([]);
  });
});
