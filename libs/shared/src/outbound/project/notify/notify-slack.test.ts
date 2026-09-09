import { describe, it, expect } from "vitest";
import { NotifySlack } from "./notify-slack.js";
import type { PgPool } from "../../memory-store.js";

function fakePool(rows: unknown[]): PgPool {
  return { query: async <T>() => ({ rows: rows as T[] }) };
}

describe("NotifySlack", () => {
  it("fires an escalation using the repo's resolved channels", async () => {
    const slack = new NotifySlack(
      fakePool([{ settings: { dark_factory: { notify: ["watched"] } } }]),
      {},
    );

    expect(
      await slack.notify("re-cinq/lore", "escalation", "pod died"),
    ).toEqual({
      fire: true,
      matchedChannels: ["escalation"],
    });
  });

  it("suppresses a pr_open when the repo's channels do not include all", async () => {
    const slack = new NotifySlack(
      fakePool([{ settings: { dark_factory: { notify: ["watched"] } } }]),
      {},
    );

    expect(await slack.notify("re-cinq/lore", "pr_open", "PR #1")).toEqual({
      fire: false,
      matchedChannels: [],
    });
  });
});

describe("a task that arrived from Slack", () => {
  it("posts to the task's own channel while the repo's list still decides whether to post", async () => {
    const posts: Array<{ channel: string; text: string }> = [];
    const slack = new NotifySlack(
      fakePool([
        {
          settings: {
            dark_factory: { notify: ["all"] },
            slack_channel_id: "C-repo-default",
          },
        },
      ]),
      { LORE_SLACK_BOT_TOKEN: "xoxb-test" },
    );

    globalThis.fetch = (async (_url: string, init: { body: string }) => {
      posts.push(JSON.parse(init.body));

      return { ok: true };
    }) as unknown as typeof fetch;

    const result = await slack.notify("re-cinq/lore", "pr_open", "PR ready", {
      channel: "C-from-slash-command",
    });

    expect(result.fire).toBe(true);
    expect(posts).toEqual([
      {
        channel: "C-from-slash-command",
        text: "PR ready",
        unfurl_links: true,
      },
    ]);
  });

  it("posts nothing when the repo's channel list suppresses the level, override or not", async () => {
    const slack = new NotifySlack(
      fakePool([{ settings: { dark_factory: { notify: ["escalation"] } } }]),
      { LORE_SLACK_BOT_TOKEN: "xoxb-test" },
    );
    let called = false;

    globalThis.fetch = (async () => {
      called = true;

      return { ok: true };
    }) as unknown as typeof fetch;

    const result = await slack.notify("re-cinq/lore", "completion", "done", {
      channel: "C-from-slash-command",
    });

    expect(result.fire).toBe(false);
    expect(called).toBe(false);
  });
});
