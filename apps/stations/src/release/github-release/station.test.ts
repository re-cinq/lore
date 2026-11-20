import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import { InMemoryGitHubReleases } from "@re-cinq/lore-shared/project/lib/github-release-memory.js";
import { releaseGithubReleaseHandle } from "./station.js";

const SOURCE = "re-cinq/lore-security";
const MIRROR = "re-cinq/lore";
const VERSION = "v1.3.0";
const SUMMARY = "Adds the release line.";

function scene(notes = `${SUMMARY}\n`) {
  const releases = new InMemoryGitHubReleases();
  const tools: Tools = {
    read: () => Promise.resolve(Buffer.from(notes)),
    produce: () => Promise.resolve(),
    modelCall: () => Promise.resolve(),
    signal: new AbortController().signal,
  };

  return { releases, tools, handle: releaseGithubReleaseHandle(releases) };
}

const brief = (needs: Record<string, string> = {}) => ({
  visitId: "0b0e6b1e-0000-4000-8000-000000000011",
  iteration: 1,
  needs: {
    release_repo: SOURCE,
    release_version: VERSION,
    release_sha: "bbb222",
    release_notes: "https://floor.test/blobs/notes",
    ...needs,
  },
});

const urlOn = (repo: string) =>
  `https://github.com/${repo}/releases/tag/${VERSION}`;

describe("the release-github-release station", () => {
  it("creates the release v1.3.0 on the mirror with the summary as its body and produces its url", async () => {
    const { releases, tools, handle } = scene();
    const report = await handle(brief({ published_to: MIRROR }), tools);

    expect({
      report,
      onMirror: await releases.releaseByTag(MIRROR, VERSION),
      onSource: await releases.releaseByTag(SOURCE, VERSION),
    }).toMatchObject({
      report: { outcome: "success", produced: { release_url: urlOn(MIRROR) } },
      onMirror: { name: VERSION, body: SUMMARY },
      onSource: null,
    });
  });

  it("creates the release on re-cinq/lore-security when the run was not published anywhere", async () => {
    const { releases, tools, handle } = scene();

    await handle(brief(), tools);

    expect(await releases.releaseByTag(SOURCE, VERSION)).toMatchObject({
      body: SUMMARY,
    });
  });

  it("puts the summary ahead of the existing body when the release v1.3.0 lacks it", async () => {
    const { releases, tools, handle } = scene();

    await releases.createRelease(SOURCE, {
      tag: VERSION,
      name: VERSION,
      body: "* a generated note",
    });
    const report = await handle(brief(), tools);

    expect({
      report,
      body: (await releases.releaseByTag(SOURCE, VERSION))?.body,
    }).toEqual({
      report: { outcome: "success", produced: { release_url: urlOn(SOURCE) } },
      body: `${SUMMARY}\n\n* a generated note`,
    });
  });

  it("leaves the release untouched when its body already has the summary, and a retried visit changes nothing", async () => {
    const { releases, tools, handle } = scene();

    await handle(brief(), tools);
    const first = await releases.releaseByTag(SOURCE, VERSION);
    const report = await handle(brief(), tools);

    expect({
      report,
      release: await releases.releaseByTag(SOURCE, VERSION),
    }).toEqual({
      report: { outcome: "success", produced: { release_url: urlOn(SOURCE) } },
      release: first,
    });
  });

  it("fails naming release_notes when the run carries no release_notes", async () => {
    const { tools, handle } = scene();
    const { release_notes: _notes, ...needs } = brief().needs;

    expect(await handle({ ...brief(), needs }, tools)).toEqual({
      outcome: "failed",
      error: "the run lacks release_notes",
    });
  });
});
