import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import { InMemoryDigestPosts } from "@re-cinq/lore-shared/project/digest-posts/digest-posts-memory.js";
import { InMemorySlackPoster } from "@re-cinq/lore-shared/project/notify/slack-poster-memory.js";
import { encodeDigestRepos } from "@re-cinq/lore-shared/digest/codec.js";
import { digestPostHandle } from "./station.js";

const NOW = new Date("2026-10-01T07:05:00Z");

const NEEDS = {
  channel: "C123",
  week_key: "2026-W40",
  digest_date: "2026-10-01",
  digest_repos: encodeDigestRepos([
    {
      repo: "re-cinq/lore",
      since: "2026-09-30T07:00:00.000Z",
      sections: ["implemented"],
      group_by: "area",
    },
  ]),
  digest_draft: "https://floor.test/blobs/draft",
};

const DRAFT = "*re-cinq/lore*\n• one thing merged\n";

function scene(
  files: Record<string, string>,
  poster = new InMemorySlackPoster(),
) {
  const posts = new InMemoryDigestPosts(() => NOW);
  const tools: Tools = {
    read: (need) => Promise.resolve(Buffer.from(files[need] ?? "")),
    produce: () => Promise.resolve(),
    modelCall: () => Promise.resolve(),
    signal: new AbortController().signal,
  };

  return { handle: digestPostHandle({ posts, poster }), tools, posts, poster };
}

const brief = (
  needs: Record<string, string>,
  visitId = "0b0e6b1e-0000-4000-8000-000000000001",
) => ({ visitId, iteration: 1, needs });

describe("the digest-post station", () => {
  it("posts the refined message into channel C123 and records re-cinq/lore as posted", async () => {
    const { handle, tools, posts, poster } = scene({
      digest_draft: DRAFT,
      digest_message: "A good day.\n\n*re-cinq/lore*\n• one thing merged\n",
    });
    const report = await handle(
      brief({ ...NEEDS, digest_message: "https://floor.test/blobs/message" }),
      tools,
    );

    expect(report).toEqual({ outcome: "success" });
    expect(poster.posts.at(-1)).toMatchObject({
      channel: "C123",
      text: expect.stringContaining("A good day."),
    });
    expect(await posts.lastPostedAt("re-cinq/lore")).toEqual(NOW);
  });

  it("posts the draft when the refine agent left no message", async () => {
    const { handle, tools, poster } = scene({ digest_draft: DRAFT });
    const report = await handle(brief(NEEDS), tools);

    expect(report).toEqual({ outcome: "success" });
    expect(poster.posts.at(-1)?.text).toContain("one thing merged");
  });

  it("posts the draft when the refine agent's message is empty", async () => {
    const { handle, tools, poster } = scene({
      digest_draft: DRAFT,
      digest_message: "  \n",
    });

    await handle(
      brief({ ...NEEDS, digest_message: "https://floor.test/blobs/message" }),
      tools,
    );

    expect(poster.posts.at(-1)?.text).toContain("one thing merged");
  });

  it("reports failed with Slack's reason and leaves re-cinq/lore without a posted digest when Slack refuses", async () => {
    const { handle, tools, posts } = scene(
      { digest_draft: DRAFT },
      new InMemorySlackPoster("channel_not_found"),
    );
    const report = await handle(brief(NEEDS), tools);

    expect(report).toEqual({
      outcome: "failed",
      error: "slack chat.postMessage: channel_not_found",
    });
    expect(await posts.lastPostedAt("re-cinq/lore")).toBeNull();
  });

  it("posts on a second visit after a visit Slack refused, because each visit claims under its own id", async () => {
    const files = { digest_draft: DRAFT };
    const refused = scene(files, new InMemorySlackPoster("channel_not_found"));

    await refused.handle(brief(NEEDS), refused.tools);
    const retry = digestPostHandle({
      posts: refused.posts,
      poster: new InMemorySlackPoster(),
    });
    const report = await retry(
      brief(NEEDS, "0b0e6b1e-0000-4000-8000-000000000002"),
      refused.tools,
    );

    expect(report).toEqual({ outcome: "success" });
    expect(await refused.posts.lastPostedAt("re-cinq/lore")).toEqual(NOW);
  });

  it("reports failed when the run carries no channel", async () => {
    const { channel: _dropped, ...incomplete } = NEEDS;
    const { handle, tools } = scene({ digest_draft: DRAFT });

    expect((await handle(brief(incomplete), tools)).outcome).toBe("failed");
  });
});
