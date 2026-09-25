import { describe, it, expect, afterEach } from "vitest";
import { SlackPosterHttp } from "./slack-poster-http.js";

const originalFetch = globalThis.fetch;

function slackAnswers(answer: unknown) {
  const sent: Array<Record<string, unknown>> = [];

  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    sent.push(JSON.parse(init.body));

    return { json: async () => answer };
  }) as unknown as typeof fetch;

  return sent;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("SlackPosterHttp", () => {
  const poster = () => new SlackPosterHttp({ LORE_SLACK_BOT_TOKEN: "xoxb" });

  it("sends thread_ts and reply_broadcast when replying", async () => {
    const sent = slackAnswers({ ok: true, ts: "2.000" });

    await poster().post({
      channel: "C1",
      text: "hi",
      threadTs: "1.000",
      replyBroadcast: true,
    });

    expect(sent).toEqual([
      {
        channel: "C1",
        text: "hi",
        unfurl_links: true,
        thread_ts: "1.000",
        reply_broadcast: true,
      },
    ]);
  });

  it("returns the message ts on ok", async () => {
    slackAnswers({ ok: true, ts: "2.000" });

    expect(await poster().post({ channel: "C1", text: "hi" })).toEqual({
      ts: "2.000",
    });
  });

  it("throws with slack's error when ok is false", async () => {
    slackAnswers({ ok: false, error: "not_in_channel" });

    await expect(poster().post({ channel: "C1", text: "hi" })).rejects.toThrow(
      new Error("slack chat.postMessage: not_in_channel"),
    );
  });

  it("throws before calling slack when the token is unset", async () => {
    const sent = slackAnswers({ ok: true });

    await expect(
      new SlackPosterHttp({}).post({ channel: "C1", text: "hi" }),
    ).rejects.toThrow(new Error("LORE_SLACK_BOT_TOKEN is not set"));
    expect(sent).toEqual([]);
  });
});
