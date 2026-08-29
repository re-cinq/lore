/**
 * Notification port. The adapter relocates the pure decideNotify channel
 * filtering (currently agent/src/lib/notify.ts) and dispatches the Slack send;
 * the facade just binds the repo. fire reports whether delivery happened.
 */

export type NotifyLevel = "escalation" | "watched" | "completion" | "pr_open";

export interface NotifyResult {
  fire: boolean;
  matchedChannels: string[];
}

export interface NotifyOptions {
  /**
   * Post here instead of the repo's configured channel.
   *
   * For a task that ARRIVED from Slack: it carries the channel someone typed
   * `/lore` in, and the answer belongs in that conversation rather than in the
   * repo's default one. The repo's channel list still decides WHETHER to post —
   * an override picks the destination, never the permission.
   */
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
