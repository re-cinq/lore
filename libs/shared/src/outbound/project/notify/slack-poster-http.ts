import { enforceTrue } from "../../../lib/enforce.js";
import type { SlackPost, SlackPosted, SlackPosterPort } from "./slack-poster-port.js";

const POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage";

/** Slack over fetch. Slack answers HTTP 200 with `ok: false` for every refusal, so the body is what decides. */
export class SlackPosterHttp implements SlackPosterPort {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async post(input: SlackPost): Promise<SlackPosted> {
    const token = this.env.LORE_SLACK_BOT_TOKEN;

    enforceTrue(token, Error, "LORE_SLACK_BOT_TOKEN is not set");
    const response = await fetch(POST_MESSAGE_URL, {
      signal: AbortSignal.timeout(10_000),
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(wireBody(input)),
    });
    const answer = (await response.json()) as { ok: boolean; ts?: string; error?: string };

    enforceTrue(answer.ok, Error, `slack chat.postMessage: ${answer.error ?? "not ok"}`);

    return { ts: answer.ts ?? "" };
  }
}

function wireBody(input: SlackPost): Record<string, unknown> {
  return {
    channel: input.channel,
    text: input.text,
    unfurl_links: input.unfurlLinks ?? true,
    ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
    ...(input.replyBroadcast ? { reply_broadcast: true } : {}),
  };
}
