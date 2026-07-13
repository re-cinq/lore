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

export interface NotifyPort {
  notify(
    repo: string,
    level: NotifyLevel,
    message: string,
  ): Promise<NotifyResult>;
}
