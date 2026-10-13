import { enforceTrue } from "../../../lib/enforce.js";
import type { SlackDirectoryPort } from "./slack-directory-port.js";

interface SlackUserAnswer {
  ok: boolean;
  error?: string;
  user?: {
    id: string;
    profile?: { display_name?: string; real_name?: string };
  };
}

/** Slack's users.lookupByEmail and users.info over fetch. "Not found" is an answer (null); any other refusal, such as a missing scope, throws with Slack's own error. */
export class SlackDirectoryHttp implements SlackDirectoryPort {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async idByEmail(email: string): Promise<string | null> {
    const answer = await this.get("users.lookupByEmail", { email });

    return answer.user?.id ?? null;
  }

  async displayName(slackUserId: string): Promise<string | null> {
    const answer = await this.get("users.info", { user: slackUserId });
    const profile = answer.user?.profile;

    return profile?.display_name || profile?.real_name || null;
  }

  private async get(
    method: string,
    params: Record<string, string>,
  ): Promise<SlackUserAnswer> {
    const token = this.env.LORE_SLACK_BOT_TOKEN;

    enforceTrue(token, Error, "LORE_SLACK_BOT_TOKEN is not set");
    const answer = await callSlack(token, method, params);

    enforceTrue(
      answer.ok || NOT_FOUND.has(answer.error ?? ""),
      Error,
      `slack ${method}: ${answer.error ?? "not ok"}`,
    );

    return answer;
  }
}

/** Slack's "nobody by that email or id" — an answer, not a failure. */
const NOT_FOUND = new Set(["users_not_found", "user_not_found"]);

async function callSlack(
  token: string,
  method: string,
  params: Record<string, string>,
): Promise<SlackUserAnswer> {
  const url = `https://slack.com/api/${method}?${new URLSearchParams(params)}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${token}` },
  });

  return (await response.json()) as SlackUserAnswer;
}
