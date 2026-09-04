import type { PgPool } from "../../memory-store.js";
import {
  resolveDarkFactorySettings,
  type DarkFactorySettings,
} from "../../dark-factory-settings.js";
import type {
  NotifyPort,
  NotifyLevel,
  NotifyResult,
  NotifyOptions,
} from "./notify-port.js";
import { decideNotify } from "./notify-decision.js";

interface RepoNotifyRow {
  settings?: { dark_factory?: DarkFactorySettings; slack_channel_id?: string };
}

interface RepoNotifySettings {
  darkFactory?: DarkFactorySettings;
  slackChannelId?: string;
}

function repoNotifySettings(
  row: RepoNotifyRow | undefined,
): RepoNotifySettings {
  const settings = row?.settings;

  return {
    darkFactory: settings?.dark_factory,
    slackChannelId: settings?.slack_channel_id,
  };
}

/** NotifyPort over Slack; posts to Slack when decision fires and token + channel present. */
export class NotifySlack implements NotifyPort {
  constructor(
    private readonly pool: PgPool,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async notify(
    repo: string,
    level: NotifyLevel,
    message: string,
    opts: NotifyOptions = {},
  ): Promise<NotifyResult> {
    const { rows } = await this.pool.query(
      "SELECT settings FROM lore.repos WHERE full_name = $1",
      [repo],
    );
    const row = rows[0] as RepoNotifyRow | undefined;
    const { darkFactory, slackChannelId } = repoNotifySettings(row);
    const channels = resolveDarkFactorySettings(darkFactory).notify;
    const decision = decideNotify(level, { channels });

    const token = this.env.LORE_SLACK_BOT_TOKEN;
    // The override picks the destination; `decision` already decided whether to post.
    const channel = opts.channel ?? slackChannelId;

    if (decision.fire && token && channel) {
      await this.post(token, channel, message);
    }

    return decision;
  }

  private async post(
    token: string,
    channel: string,
    text: string,
  ): Promise<void> {
    await fetch("https://slack.com/api/chat.postMessage", {
      signal: AbortSignal.timeout(10_000),
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ channel, text, unfurl_links: true }),
    });
  }
}
