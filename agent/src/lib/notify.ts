/**
 * Notification gating for dark-factory.
 *
 * Per FR3.5 + Q1 clarifications, three channels exist:
 *  - `escalation` — always fires when level=escalation, regardless of repo policy
 *  - `watched` — fires for completion/PR-open notifications when the
 *    task creator opted in via `notify_on_completion: true` at task
 *    creation time
 *  - `all` — fires unconditionally (legacy / opt-out repos)
 *
 * The repo's `dark_factory.notify` array filters which levels propagate.
 */

export type NotifyLevel = "escalation" | "watched" | "completion" | "pr_open";

export interface NotifySettings {
  /** From `lore.repos.settings.dark_factory.notify`. */
  channels: Array<"escalation" | "watched" | "all">;
}

export interface NotifyDecision {
  /** True if the message should be delivered. */
  fire: boolean;
  /** The channel(s) that authorized delivery. */
  matchedChannels: string[];
}

/**
 * Decide whether a notification at `level` should fire under the repo's
 * configured `channels`. Pure function — caller dispatches the actual
 * Slack/email send when `fire === true`.
 *
 * Rules:
 *   - `all` in the channels list → always fire (opt-out repo behavior).
 *   - `escalation` level → fires when the repo lists `escalation`,
 *     `all`, OR when the repo lists nothing at all (escalations are
 *     never silenced — they always reach a human).
 *   - `watched` and `completion` → fire only when the watched channel
 *     is explicitly listed.
 *   - `pr_open` → fires only when channels includes `all` (today's
 *     legacy behavior); dark-mode repos suppress per-PR Slack noise.
 */
export function decideNotify(
  level: NotifyLevel,
  settings: NotifySettings,
): NotifyDecision {
  const channels = settings.channels ?? [];
  const all = channels.includes("all");

  if (all) {
    return { fire: true, matchedChannels: ["all"] };
  }

  if (level === "escalation") {
    return { fire: true, matchedChannels: ["escalation"] };
  }

  if (level === "watched" || level === "completion") {
    if (channels.includes("watched")) {
      return { fire: true, matchedChannels: ["watched"] };
    }
    return { fire: false, matchedChannels: [] };
  }

  // pr_open: only `all` lets these through
  return { fire: false, matchedChannels: [] };
}
