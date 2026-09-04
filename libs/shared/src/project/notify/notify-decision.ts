import type { NotifyChannel } from "../../dark-factory-settings.js";
import type { NotifyLevel, NotifyResult } from "./notify-port.js";

/** Channel-filtering decision (relocated from agent/src/lib/notify.ts). */
export interface NotifySettings {
  channels: NotifyChannel[];
}

function isWatchedLevel(level: NotifyLevel): boolean {
  return level === "watched" || level === "completion";
}

export function decideNotify(
  level: NotifyLevel,
  settings: NotifySettings,
): NotifyResult {
  const channels = settings.channels ?? [];

  if (channels.includes("all")) {
    return { fire: true, matchedChannels: ["all"] };
  }

  if (level === "escalation") {
    return { fire: true, matchedChannels: ["escalation"] };
  }

  if (isWatchedLevel(level) && channels.includes("watched")) {
    return { fire: true, matchedChannels: ["watched"] };
  }

  // pr_open, or watched/completion without the channel: only `all` lets these through
  return { fire: false, matchedChannels: [] };
}
