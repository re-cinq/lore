import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import { InMemoryChangelogReleases } from "@re-cinq/lore-shared/project/changelog-releases/changelog-releases-memory.js";
import { releaseStoreHandle } from "./station.js";

const SOURCE = "re-cinq/lore-security";

function scene(files: Record<string, string>) {
  const releases = new InMemoryChangelogReleases(
    () => new Date("2026-11-20T09:05:00Z"),
  );
  const tools: Tools = {
    read: (need) => Promise.resolve(Buffer.from(files[need] ?? "")),
    produce: () => Promise.resolve(),
    modelCall: () => Promise.resolve(),
    signal: new AbortController().signal,
  };

  return { releases, tools, handle: releaseStoreHandle(releases) };
}

const FILES = {
  release_changes: JSON.stringify({ changes: [] }),
  release_notes: "Adds the release line.\n",
};

const brief = (needs: Record<string, string> = {}) => ({
  visitId: "0b0e6b1e-0000-4000-8000-000000000012",
  iteration: 1,
  needs: {
    release_repo: SOURCE,
    release_version: "v1.3.0",
    release_sha: "bbb222",
    release_bump_kind: "minor",
    range_to: "2026-11-20T09:00:00.000Z",
    release_changes: "https://floor.test/blobs/changes",
    release_notes: "https://floor.test/blobs/notes",
    ...needs,
  },
});

describe("the release-store station", () => {
  it("stores v1.3.0 of re-cinq/lore-security with the summary and the published values and succeeds", async () => {
    const { releases, tools, handle } = scene(FILES);
    const report = await handle(
      brief({ published_to: "re-cinq/lore", previous_tag: "v1.2.4" }),
      tools,
    );

    expect({
      report,
      rows: await releases.page(SOURCE, { limit: 5 }),
    }).toMatchObject({
      report: { outcome: "success" },
      rows: [
        {
          version: "v1.3.0",
          bump: "minor",
          previousTag: "v1.2.4",
          publishedTo: "re-cinq/lore",
          summary: "Adds the release line.",
          changes: [],
        },
      ],
    });
  });

  it("leaves one row for v1.3.0 when the visit is retried", async () => {
    const { releases, tools, handle } = scene(FILES);

    await handle(brief(), tools);
    await handle(brief(), tools);

    expect(
      (await releases.page(SOURCE, { limit: 5 })).map((row) => row.version),
    ).toEqual(["v1.3.0"]);
  });

  it("fails naming release_bump_kind and release_changes when the run lacks them, and stores nothing", async () => {
    const { releases, tools, handle } = scene(FILES);
    const {
      release_bump_kind: _bump,
      release_changes: _changes,
      ...needs
    } = brief().needs;

    expect({
      report: await handle({ ...brief(), needs }, tools),
      rows: releases.rows,
    }).toEqual({
      report: {
        outcome: "failed",
        error: "the run lacks release_bump_kind, release_changes",
      },
      rows: [],
    });
  });

  it("fails and stores nothing when the changes file is not JSON", async () => {
    const { releases, tools, handle } = scene({
      ...FILES,
      release_changes: "not json",
    });

    expect({
      outcome: (await handle(brief(), tools)).outcome,
      rows: releases.rows,
    }).toEqual({ outcome: "failed", rows: [] });
  });
});
