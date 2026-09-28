import { enforceTrue } from "../../../lib/enforce.js";
import type {
  SlackPost,
  SlackPosted,
  SlackPosterPort,
} from "./slack-poster-port.js";

const POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage";

/** Slack over fetch. Slack answers HTTP 200 with `ok: false` for every refusal, so the body is what decides. */
export class SlackPosterHttp implements SlackPosterPort {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async post(input: SlackPost): Promise<SlackPosted> {
    const token = this.env.LORE_SLACK_BOT_TOKEN;

    enforceTrue(token, Error, "LORE_SLACK_BOT_TOKEN is not set");
    const answer = await postMessage(token, wireBody(input));

    enforceTrue(
      answer.ok,
      Error,
      `slack chat.postMessage: ${answer.error ?? "not ok"}`,
    );

    return { ts: answer.ts ?? "" };
  }
}

interface SlackAnswer {
  ok: boolean;
  ts?: string;
  error?: string;
}

async function postMessage(
  token: string,
  body: Record<string, unknown>,
): Promise<SlackAnswer> {
  const response = await fetch(POST_MESSAGE_URL, {
    signal: AbortSignal.timeout(10_000),
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return (await response.json()) as SlackAnswer;
}

function wireBody(input: SlackPost): Record<string, unknown> {
  return {
    channel: input.channel,
    text: input.text,
    unfurl_links: input.unfurlLinks ?? true,
    ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
  };
}
