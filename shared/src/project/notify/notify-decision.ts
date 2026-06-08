import type { NotifyChannel } from "../../dark-factory-settings.js";
import type { NotifyLevel, NotifyResult } from "./notify-port.js";

/**
 * Channel-filtering decision, relocated verbatim from agent/src/lib/notify.ts
 * (decideNotify). Pure — the caller dispatches the actual Slack send when
 * fire === true. agent keeps a re-export during migration.
 */
export function decideNotify(level: NotifyLevel, channels: NotifyChannel[]): NotifyResult {
  if (channels.includes("all")) {
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
