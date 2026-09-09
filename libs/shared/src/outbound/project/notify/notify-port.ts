/** Notification port: channel filtering + Slack send dispatch. */

export type NotifyLevel = "escalation" | "watched" | "completion" | "pr_open";

export interface NotifyResult {
  fire: boolean;
  matchedChannels: string[];
}

export interface NotifyOptions {
  /** Post destination override (doesn't change permission rules). */
  channel?: string;
}

export interface NotifyPort {
  notify(
    repo: string,
    level: NotifyLevel,
    message: string,
    opts?: NotifyOptions,
  ): Promise<NotifyResult>;
}
