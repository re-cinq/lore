import type { PgPool } from "../../memory-store.js";
import { resolveDarkFactorySettings, type DarkFactorySettings } from "../../dark-factory-settings.js";
import type { NotifyPort, NotifyLevel, NotifyResult } from "./notify-port.js";
import { decideNotify } from "./notify-decision.js";

interface RepoNotifyRow {
  settings?: { dark_factory?: DarkFactorySettings; slack_channel_id?: string };
}

/**
 * NotifyPort over Slack. Reads the repo's notify channels + slack_channel_id
 * from lore.repos.settings, applies the relocated decideNotify, and posts to
 * Slack via fetch when the decision fires and a token + channel are present.
 * The decision is always returned; the send is best-effort.
 */
export class NotifySlack implements NotifyPort {
  constructor(
    private readonly pool: PgPool,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async notify(repo: string, level: NotifyLevel, message: string): Promise<NotifyResult> {
    const { rows } = await this.pool.query("SELECT settings FROM lore.repos WHERE full_name = $1", [repo]);
    const row = rows[0] as RepoNotifyRow | undefined;
    const channels = resolveDarkFactorySettings(row?.settings?.dark_factory).notify;
    const decision = decideNotify(level, { channels });

    const token = this.env.LORE_SLACK_BOT_TOKEN;
    const channel = row?.settings?.slack_channel_id;
    if (decision.fire && token && channel) {
      await this.post(token, channel, message);
    }
    return decision;
  }

  private async post(token: string, channel: string, text: string): Promise<void> {
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ channel, text }),
    });
  }
}
