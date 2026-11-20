import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import { InMemoryChangelogReleases } from "@re-cinq/lore-shared/project/changelog-releases/changelog-releases-memory.js";
import { InMemorySlackPoster } from "@re-cinq/lore-shared/project/notify/slack-poster-memory.js";
import { InMemorySettings } from "@re-cinq/lore-shared/project/settings/settings-memory.js";
import { releaseAnnounceHandle } from "./station.js";

const SOURCE = "re-cinq/lore-security";
const URL = "https://github.com/re-cinq/lore/releases/tag/v1.3.0";

async function scene(options: { channel?: string; refuse?: string } = {}) {
  const settings = new InMemorySettings([
    {
      full_name: SOURCE,
      settings: options.channel ? { slack_channel_id: options.channel } : {},
    },
  ]);
  const releases = new InMemoryChangelogReleases();
  const poster = new InMemorySlackPoster(options.refuse);
  const tools: Tools = {
    read: () => Promise.resolve(Buffer.from("Adds the release line.\n")),
    produce: () => Promise.resolve(),
    modelCall: () => Promise.resolve(),
    signal: new AbortController().signal,
  };

  await releases.upsert({
    repo: SOURCE,
    version: "v1.3.0",
    previousTag: null,
    sha: "bbb222",
    bump: "minor",
    rangeFrom: null,
    rangeTo: new Date("2026-11-20T09:00:00Z"),
    summary: "Adds the release line.",
    changes: [],
    releaseUrl: URL,
    publishedTo: "re-cinq/lore",
  });

  return {
    releases,
    poster,
    tools,
    handle: releaseAnnounceHandle({ settings, releases, poster }),
  };
}

const brief = (needs: Record<string, string> = {}) => ({
  visitId: "0b0e6b1e-0000-4000-8000-000000000013",
  iteration: 1,
  needs: {
    release_repo: SOURCE,
    release_version: "v1.3.0",
    release_notes: "https://floor.test/blobs/notes",
    published_to: "re-cinq/lore",
    release_url: URL,
    ...needs,
  },
});

describe("the release-announce station", () => {
  it("succeeds and posts nothing when the repo has no slack_channel_id", async () => {
    const { handle, tools, poster, releases } = await scene();

    expect({
      report: await handle(brief(), tools),
      posts: poster.posts,
      announced: releases.rows[0].announcedAt,
    }).toEqual({ report: { outcome: "success" }, posts: [], announced: null });
  });

  it("posts one message into C123 led by re-cinq/lore and v1.3.0 linked to its release", async () => {
    const { handle, tools, poster } = await scene({ channel: "C123" });
    const report = await handle(brief(), tools);

    expect({ report, posts: poster.posts }).toMatchObject({
      report: { outcome: "success" },
      posts: [
        {
          channel: "C123",
          text: `*re-cinq/lore* <${URL}|v1.3.0>\n\nAdds the release line.`,
        },
      ],
    });
  });

  it("succeeds and posts nothing more when v1.3.0 was already announced", async () => {
    const { handle, tools, poster } = await scene({ channel: "C123" });

    await handle(brief(), tools);
    const report = await handle(brief(), tools);

    expect({ report, posted: poster.posts.length }).toEqual({
      report: { outcome: "success" },
      posted: 1,
    });
  });

  it("fails with the Slack error and does not post again on a retry when Slack refuses after the claim", async () => {
    const { handle, tools, poster } = await scene({
      channel: "C123",
      refuse: "channel_not_found",
    });
    const first = await handle(brief(), tools);
    const retry = await handle(brief(), tools);

    expect({ first, retry, posts: poster.posts }).toEqual({
      first: {
        outcome: "failed",
        error: "slack chat.postMessage: channel_not_found",
      },
      retry: { outcome: "success" },
      posts: [],
    });
  });

  it("fails naming release_notes when the run carries no release_notes, and posts nothing", async () => {
    const { handle, tools, poster } = await scene({ channel: "C123" });
    const { release_notes: _notes, ...needs } = brief().needs;

    expect({
      report: await handle({ ...brief(), needs }, tools),
      posts: poster.posts,
    }).toEqual({
      report: { outcome: "failed", error: "the run lacks release_notes" },
      posts: [],
    });
  });
});
