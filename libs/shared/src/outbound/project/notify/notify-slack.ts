import type { PgPool } from "../../memory-store.js";
import {
  resolveDarkFactorySettings,
  type DarkFactorySettings,
} from "../../../domain/dark-factory-settings.js";
import type {
  NotifyPort,
  NotifyLevel,
  NotifyResult,
  NotifyOptions,
} from "./notify-port.js";
import { decideNotify } from "./notify-decision.js";
import { SlackPosterHttp } from "./slack-poster-http.js";
import type { SlackPosterPort } from "./slack-poster-port.js";

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
    private readonly poster: SlackPosterPort = new SlackPosterHttp(env),
  ) {}

  async notify(
    repo: string,
    level: NotifyLevel,
    message: string,
    opts: NotifyOptions = {},
  ): Promise<NotifyResult> {
    const { darkFactory, slackChannelId } = await this.repoSettings(repo);
    const channels = resolveDarkFactorySettings(darkFactory).notify;
    const decision = decideNotify(level, { channels });

    const token = this.env.LORE_SLACK_BOT_TOKEN;
    // The override picks the destination; `decision` already decided whether to post.
    const channel = opts.channel ?? slackChannelId;

    // No token means no post and no error — a laptop Floor without Slack must still decide.
    if (decision.fire && token && channel) {
      await this.poster.post({ channel, text: message });
    }

    return decision;
  }

  /** The repo's dark-factory notify block and its default Slack destination. */
  private async repoSettings(repo: string): Promise<RepoNotifySettings> {
    const { rows } = await this.pool.query(
      "SELECT settings FROM lore.repos WHERE full_name = $1",
      [repo],
    );

    return repoNotifySettings(rows[0] as RepoNotifyRow | undefined);
  }
}
